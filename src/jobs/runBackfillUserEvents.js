// src/jobs/runBackfillUserEvents.js
//
// Backfill de eventos de Google Calendar para UN usuario: crea los eventos que le
// FALTAN (partidos relevantes sin fila en calendar_events), independiente de si el
// match cambió. Reusa el criterio per-usuario de calendarSyncService.js:38-46.
//
// A diferencia de POST /api/admin/resync-user:
//   - Target-only: NO toca a otros usuarios (usa primitivos por-usuario, no
//     syncMatchToCalendars que es multi-usuario).
//   - SALTA los existentes (no los re-actualiza) → solo N creates, no update masivo.
//   - Log por partido: created / skipped / error. NO aborta si un partido falla.
//
// Seguridad / operación:
//   - TARGET_USER (email) obligatorio. Sin él, aborta.
//   - Dry-run por defecto. Solo crea con CONFIRM=1.
//   - MAX (opcional): limita cuántos crear en esta corrida (para una prueba chica).
//   - DELAY_MS (opcional, default 150): pausa entre creates (rate-limit de Google).
//   - Corre en proceso aparte (no comparte el mutex del scheduler): córrelo en un
//     minuto != :00 y NO justo tras un deploy. Reporta duplicados al final.
//   - Ruta de DB desde src/db/database.js. NO llama initializeDatabase (no borra caches).
//
// Uso:
//   Dry-run:   TARGET_USER=tu@email node src/jobs/runBackfillUserEvents.js
//   Prueba:    TARGET_USER=tu@email CONFIRM=1 MAX=5 node src/jobs/runBackfillUserEvents.js
//   Full:      TARGET_USER=tu@email CONFIRM=1 node src/jobs/runBackfillUserEvents.js
//   Render:    añade NODE_ENV=production

require("dotenv").config();

const { getMatchesForUser } = require("../services/subscriptionMatchService");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const googleCalendarProvider = require("../services/googleCalendarProvider");
const { db } = require("../db/database");

const TARGET_EMAIL = process.env.TARGET_USER;
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const MAX = process.env.MAX ? parseInt(process.env.MAX, 10) : Infinity;
const DELAY_MS = process.env.DELAY_MS ? parseInt(process.env.DELAY_MS, 10) : 150;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isInvalidGrant(err) {
  const msg = String(err?.message || "").toLowerCase();
  const respErr = String(err?.response?.data?.error || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  return msg.includes("invalid_grant") || respErr === "invalid_grant" || code === "invalid_grant";
}

function isRateLimit(err) {
  const status = err?.code || err?.response?.status;
  const reason = String(err?.response?.data?.error?.errors?.[0]?.reason || "").toLowerCase();
  return status === 429 || reason.includes("ratelimit") || reason.includes("userratelimit") || reason.includes("quota");
}

async function main() {
  if (!TARGET_EMAIL) {
    console.error("[backfill] TARGET_USER (email) es obligatorio.");
    process.exit(1);
  }
  console.log(`[backfill] modo: ${APPLY ? "APLICAR (CONFIRM=1)" : "DRY-RUN (no crea nada)"}`);
  console.log(`[backfill] TARGET_USER=${TARGET_EMAIL}  MAX=${MAX === Infinity ? "sin límite" : MAX}  DELAY_MS=${DELAY_MS}`);

  // Resolver la cuenta por email (igual criterio que resync-user).
  const accounts = await googleAccountRepository.getAll();
  const acc = accounts.find((a) => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase());
  if (!acc) {
    console.error(`[backfill] No hay cuenta con googleEmail=${TARGET_EMAIL}. Aborta.`);
    process.exit(1);
  }
  const userId = acc.userId;
  console.log(`[backfill] userId=${userId}  fanschedule_calendar_id=${acc.fanschedule_calendar_id === null ? "NULL (se creará uno nuevo)" : acc.fanschedule_calendar_id}`);

  const relevant = await getMatchesForUser(userId);
  const existing = await calendarEventRepository.getByUserId(userId);
  const existingIds = new Set(existing.map((ce) => ce.providerMatchId));
  const missing = relevant.filter((m) => !existingIds.has(m.providerMatchId));

  console.log(`[backfill] relevantMatches=${relevant.length}  calendar_events actuales=${existing.length}  FALTANTES=${missing.length}`);

  if (!APPLY) {
    const by = {};
    for (const m of missing) { const k = `${m.sport}/${m.competitionKey}`; by[k] = (by[k] || 0) + 1; }
    console.log(`[backfill] DRY-RUN: crearía ${Math.min(missing.length, MAX)} eventos (de ${missing.length} faltantes) — por sport/liga: ${JSON.stringify(by)}`);
    console.log("[backfill] Nada se creó. Re-ejecuta con CONFIRM=1 para aplicar.");
    return;
  }

  let created = 0, skipped = 0, errors = 0;
  const toProcess = missing.slice(0, MAX);
  for (let i = 0; i < toProcess.length; i++) {
    const m = toProcess[i];
    const tag = `${m.providerMatchId} "${(m.eventName || (m.homeParticipantName ? m.homeParticipantName + " vs " + m.awayParticipantName : m.competitionName) || "").slice(0, 40)}"`;
    try {
      // Doble-chequeo per-usuario por si otra corrida/proceso ya lo creó (idempotencia).
      const already = await calendarEventRepository.getByUserIdAndProviderMatchId(userId, m.providerMatchId);
      if (already) { skipped++; console.log(`[backfill] skipped ${tag} (ya existe)`); continue; }

      const calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId });

      let createdEvent;
      try {
        createdEvent = await googleCalendarProvider.createEvent({ userId, calendarId, match: m });
      } catch (e) {
        if (isRateLimit(e)) {
          console.log(`[backfill] rate-limit en ${tag} — espero 2s y reintento`);
          await sleep(2000);
          createdEvent = await googleCalendarProvider.createEvent({ userId, calendarId, match: m });
        } else { throw e; }
      }

      await calendarEventRepository.create({
        userId,
        providerMatchId: m.providerMatchId,
        calendarProvider: "google",
        calendarEventId: createdEvent.calendarEventId,
      });
      created++;
      console.log(`[backfill] created ${tag}`);
    } catch (e) {
      errors++;
      console.error(`[backfill] error ${tag}: ${e.message}`);
      if (isInvalidGrant(e)) {
        console.error("[backfill] Token de Google inválido (invalid_grant). Reconecta la cuenta. Abortando.");
        break;
      }
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
    if ((i + 1) % 20 === 0) console.log(`[backfill] progreso ${i + 1}/${toProcess.length}  created=${created} skipped=${skipped} errors=${errors}`);
  }

  // Reporte final + chequeo de duplicados (para cazar una race con el scheduler).
  const finalLinks = await calendarEventRepository.getByUserId(userId);
  const counts = new Map();
  for (const ce of finalLinks) counts.set(ce.providerMatchId, (counts.get(ce.providerMatchId) || 0) + 1);
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([providerMatchId, count]) => ({ providerMatchId, count }));

  console.log("─".repeat(56));
  console.log(`[backfill] created=${created}  skipped=${skipped}  errors=${errors}`);
  console.log(`[backfill] filas calendar_events finales=${finalLinks.length}`);
  console.log(`[backfill] duplicados=${duplicates.length}${duplicates.length ? " " + JSON.stringify(duplicates) : ""}`);
  console.log("[backfill] Listo.");
}

main()
  .then(() => { db.close(); process.exit(0); })
  .catch((err) => { console.error("[backfill] FALLÓ:", err.message); db.close(); process.exit(1); });

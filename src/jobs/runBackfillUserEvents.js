// src/jobs/runBackfillUserEvents.js
//
// Backfill de eventos de Google Calendar para UN usuario: crea los eventos que le
// FALTAN (partidos relevantes EN VENTANA sin fila en calendar_events), independiente
// de si el match cambió. Delega TODA la lógica en userBackfillService (fuente única
// compartida con el scheduler): getMissingEventsForUser + backfillUserEvents.
//
//   - SALTA los existentes (no los re-actualiza).
//   - Reusa la sección crítica atómica bajo el mutex compartido (createCalendarEventIfMissing).
//   - Log por partido: created / skipped / error. NO aborta si un partido falla.
//
// Seguridad / operación:
//   - TARGET_USER (email) obligatorio. Sin él, aborta.
//   - Dry-run por defecto. Solo crea con CONFIRM=1.
//   - MAX (opcional): limita cuántos crear (prueba chica).
//   - DELAY_MS (opcional, default 150): pausa entre creates (rate-limit de Google).
//   - Corre en proceso APARTE del server: aunque la op atómica use el mutex compartido,
//     ese mutex es por-proceso, así que córrelo en un minuto != :00 y NO tras un deploy.
//     Reporta duplicados al final.
//   - Ruta de DB desde src/db/database.js. NO llama initializeDatabase (no borra caches).
//
// Uso:
//   Dry-run:   TARGET_USER=tu@email node src/jobs/runBackfillUserEvents.js
//   Prueba:    TARGET_USER=tu@email CONFIRM=1 MAX=5 node src/jobs/runBackfillUserEvents.js
//   Full:      TARGET_USER=tu@email CONFIRM=1 node src/jobs/runBackfillUserEvents.js
//   Render:    añade NODE_ENV=production

require("dotenv").config();

const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { getMissingEventsForUser, backfillUserEvents } = require("../services/userBackfillService");
const { db } = require("../db/database");

const TARGET_EMAIL = process.env.TARGET_USER;
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const MAX = process.env.MAX ? parseInt(process.env.MAX, 10) : Infinity;
const DELAY_MS = process.env.DELAY_MS ? parseInt(process.env.DELAY_MS, 10) : 150;

function tagOf(m) {
  const name = (m.eventName || (m.homeParticipantName ? m.homeParticipantName + " vs " + m.awayParticipantName : m.competitionName) || "").slice(0, 40);
  return `${m.providerMatchId} "${name}"`;
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

  // Cálculo de faltantes en ventana (mismo servicio que usa el scheduler).
  const info = await getMissingEventsForUser(userId);
  const discarded = info.missingAll.length - info.missing.length;
  console.log(`[backfill] ventana de sync: ${info.fromDate} .. ${info.toDate}`);
  console.log(`[backfill] relevantMatches=${info.relevant.length}  calendar_events actuales=${info.existing.length}`);
  console.log(`[backfill] faltantes(total)=${info.missingAll.length}  descartados fuera de ventana=${discarded} (pasados=${info.discardedPast}, futuros-lejanos=${info.discardedFuture}, sin-fecha=${info.discardedNoDate})  FALTANTES(en ventana)=${info.missing.length}`);

  if (!APPLY) {
    const by = {};
    for (const m of info.missing) { const k = `${m.sport}/${m.competitionKey}`; by[k] = (by[k] || 0) + 1; }
    console.log(`[backfill] DRY-RUN: crearía ${Math.min(info.missing.length, MAX)} eventos (de ${info.missing.length} faltantes) — por sport/liga: ${JSON.stringify(by)}`);
    console.log("[backfill] Nada se creó. Re-ejecuta con CONFIRM=1 para aplicar.");
    return;
  }

  // Aplicar: delega en el servicio compartido; el logging por partido se hace vía onLog.
  const total = Math.min(info.missing.length, MAX);
  let n = 0;
  const onLog = (kind, m, err) => {
    const tag = m ? tagOf(m) : "(calendario del usuario)";
    if (kind === "created")      { n++; console.log(`[backfill] created ${tag}`); }
    else if (kind === "skipped") { n++; console.log(`[backfill] skipped ${tag} (ya existe)`); }
    else if (kind === "error")   { n++; console.error(`[backfill] error ${tag}: ${err && err.message}`); }
    else if (kind === "ratelimit") { console.log(`[backfill] rate-limit en ${tag} — espero 2s y reintento`); return; }
    else if (kind === "abort")   { console.error("[backfill] Token de Google inválido (invalid_grant). Reconecta la cuenta. Abortando."); return; }
    if (n % 20 === 0) console.log(`[backfill] progreso ${n}/${total}`);
  };

  const r = await backfillUserEvents(userId, { max: MAX, delayMs: DELAY_MS, onLog });

  // Reporte final + chequeo de duplicados (para cazar una race con el scheduler).
  const finalLinks = await calendarEventRepository.getByUserId(userId);
  const counts = new Map();
  for (const ce of finalLinks) counts.set(ce.providerMatchId, (counts.get(ce.providerMatchId) || 0) + 1);
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([providerMatchId, count]) => ({ providerMatchId, count }));

  console.log("─".repeat(56));
  console.log(`[backfill] created=${r.created}  skipped=${r.skipped}  errors=${r.errors}`);
  console.log(`[backfill] filas calendar_events finales=${finalLinks.length}`);
  console.log(`[backfill] duplicados=${duplicates.length}${duplicates.length ? " " + JSON.stringify(duplicates) : ""}`);
  console.log("[backfill] Listo.");
}

main()
  .then(() => { db.close(); process.exit(0); })
  .catch((err) => { console.error("[backfill] FALLÓ:", err.message); db.close(); process.exit(1); });

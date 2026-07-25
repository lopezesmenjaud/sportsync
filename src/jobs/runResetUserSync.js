// src/jobs/runResetUserSync.js
//
// Resetea el vínculo de sincronización de UN usuario y RECREA sus eventos futuros
// en un calendario nuevo. Útil cuando el usuario borró su calendario "FanSchedule"
// a mano en Google y quedaron:
//   - google_accounts.fanschedule_calendar_id apuntando a un calendario inexistente
//   - filas "fantasma" en calendar_events que hacen que el sync salte eventos
//
// Qué hace (SOLO para TARGET_USER, al aplicar con CONFIRM=1):
//   1. RESET:
//      a. fanschedule_calendar_id = NULL en google_accounts → el próximo acceso
//         crea un calendario nuevo (getOrCreateFanscheduleCalendar maneja NULL).
//      b. DELETE de todas las filas de calendar_events de ese userId.
//   2. RECREACIÓN FORZADA:
//      Recorre TODOS los partidos futuros suscritos del usuario (getMatchesForUser,
//      no solo los que cambiaron) y crea el evento en Google reusando los primitivos
//      POR-USUARIO: getOrCreateFanscheduleCalendar({userId}) + createEvent({userId,...}).
//      NO usa syncMatchToCalendars (que es multi-usuario) → cero efecto en otros users.
//
// NO toca a ningún otro usuario. NO toca tokens, suscripciones ni matches.
//
// Seguridad:
//   - TARGET_USER obligatorio (no hardcodeado). Sin él, aborta.
//   - Dry-run por defecto. Solo escribe/llama a Google con CONFIRM=1.
//   - Ruta de DB desde src/db/database.js (local vs /var/data según NODE_ENV).
//
// Uso:
//   Dry-run local:   TARGET_USER=tu@email node src/jobs/runResetUserSync.js
//   Aplicar local:   TARGET_USER=tu@email CONFIRM=1 node src/jobs/runResetUserSync.js
//   Aplicar Render:  TARGET_USER=tu@email CONFIRM=1 NODE_ENV=production node src/jobs/runResetUserSync.js
//
// NOTA de concurrencia: corre en proceso aparte del server, así que no comparte el
// mutex en memoria del scheduler. Para evitar duplicados, córrelo cuando el scheduler
// no esté sincronizando a este usuario (o reinicia el servicio antes). El script
// igual reporta duplicados al final si los detecta.

require("dotenv").config();

const { db } = require("../db/database");

const TARGET_USER = process.env.TARGET_USER;
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // { changes, lastID }
    });
  });
}

// invalid_grant: refresh token expirado/revocado (mismo criterio que calendarSyncService).
function isInvalidGrant(err) {
  const msg     = String(err?.message || "").toLowerCase();
  const respErr = String(err?.response?.data?.error || "").toLowerCase();
  const code    = String(err?.code || "").toLowerCase();
  return msg.includes("invalid_grant") || respErr === "invalid_grant" || code === "invalid_grant";
}

async function main() {
  if (!TARGET_USER) {
    console.error("[reset] TARGET_USER es obligatorio. Ej: TARGET_USER=tu@email node src/jobs/runResetUserSync.js");
    process.exit(1);
  }

  console.log(`[reset] modo: ${APPLY ? "APLICAR (CONFIRM=1)" : "DRY-RUN (sin escribir ni llamar a Google)"}`);
  console.log(`[reset] TARGET_USER=${TARGET_USER}`);

  // Verificar que la cuenta exista (evita reset silencioso por typo en TARGET_USER).
  const account = await get(
    "SELECT userId, fanschedule_calendar_id FROM google_accounts WHERE userId = ?",
    [TARGET_USER]
  );
  if (!account) {
    console.error(`[reset] No existe google_accounts para userId=${TARGET_USER}. Aborta (¿typo en TARGET_USER?).`);
    process.exit(1);
  }

  const { n: eventCount } = await get(
    "SELECT COUNT(*) n FROM calendar_events WHERE userId = ?",
    [TARGET_USER]
  );

  // Partidos futuros suscritos (independiente de calendar_events; solo DB, no Google).
  const { getMatchesForUser } = require("../services/subscriptionMatchService");
  const nowIso = new Date().toISOString();
  const futureMatches = (await getMatchesForUser(TARGET_USER)).filter(
    (m) => (m.currentStartUtc || m.scheduledStartUtc || "") >= nowIso
  );

  console.log(`[reset] fanschedule_calendar_id actual: ${account.fanschedule_calendar_id || "(ya es NULL)"}`);
  console.log(`[reset] calendar_events de este usuario: ${eventCount}`);
  console.log(`[reset] partidos futuros suscritos a recrear: ${futureMatches.length}`);

  if (!APPLY) {
    console.log("─".repeat(56));
    console.log(`[reset] DRY-RUN: borraría ${eventCount} filas de calendar_events`);
    console.log(`[reset] DRY-RUN: pondría fanschedule_calendar_id = NULL`);
    console.log(`[reset] DRY-RUN: recrearía ${futureMatches.length} eventos en un calendario nuevo`);
    console.log("[reset] Nada se escribió ni se llamó a Google. Re-ejecuta con CONFIRM=1 para aplicar.");
    return;
  }

  // ── 1) RESET (SOLO este userId) ──
  const del = await run("DELETE FROM calendar_events WHERE userId = ?", [TARGET_USER]);
  const now = new Date().toISOString();
  await run(
    "UPDATE google_accounts SET fanschedule_calendar_id = NULL, updatedAtUtc = ? WHERE userId = ?",
    [now, TARGET_USER]
  );
  const afterReset = await get(
    "SELECT fanschedule_calendar_id FROM google_accounts WHERE userId = ?",
    [TARGET_USER]
  );
  console.log("─".repeat(56));
  console.log(`[reset] calendar_events borradas: ${del.changes}`);
  console.log(`[reset] fanschedule_calendar_id ahora: ${afterReset.fanschedule_calendar_id === null ? "NULL ✓" : afterReset.fanschedule_calendar_id}`);

  // ── 2) RECREACIÓN FORZADA (primitivos POR-USUARIO; no toca a otros users) ──
  const googleCalendarProvider = require("../services/googleCalendarProvider");
  const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");

  let recreated = 0;
  let skipped = 0;
  let errors = 0;
  for (let i = 0; i < futureMatches.length; i++) {
    const m = futureMatches[i];
    try {
      const calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId: TARGET_USER });
      // Idempotencia: si ya existe la fila (p.ej. corrida previa), no duplicar.
      const existing = await calendarEventRepository.getByUserIdAndProviderMatchId(TARGET_USER, m.providerMatchId);
      if (existing) { skipped++; continue; }

      const created = await googleCalendarProvider.createEvent({ userId: TARGET_USER, calendarId, match: m });
      await calendarEventRepository.create({
        userId: TARGET_USER,
        providerMatchId: m.providerMatchId,
        calendarProvider: "google",
        calendarEventId: created.calendarEventId,
      });
      recreated++;
    } catch (e) {
      errors++;
      console.error(`[reset] error recreando ${m.providerMatchId}: ${e.message}`);
      if (isInvalidGrant(e)) {
        console.error("[reset] Token de Google inválido (invalid_grant). Reconecta la cuenta y reintenta. Abortando recreación.");
        break;
      }
    }
    if ((i + 1) % 10 === 0 || i + 1 === futureMatches.length) {
      console.log(`[reset] progreso ${i + 1}/${futureMatches.length}  recreados=${recreated} saltados=${skipped} errores=${errors}`);
    }
  }

  // Reporte final + chequeo de duplicados.
  const finalLinks = await calendarEventRepository.getByUserId(TARGET_USER);
  const byMatchId = new Map();
  for (const ce of finalLinks) {
    byMatchId.set(ce.providerMatchId, (byMatchId.get(ce.providerMatchId) || 0) + 1);
  }
  const duplicates = [...byMatchId.entries()].filter(([, c]) => c > 1).map(([providerMatchId, count]) => ({ providerMatchId, count }));

  console.log("─".repeat(56));
  console.log(`[reset] eventos recreados: ${recreated}`);
  console.log(`[reset] saltados (ya existían): ${skipped}`);
  console.log(`[reset] errores: ${errors}`);
  console.log(`[reset] filas calendar_events finales: ${finalLinks.length}`);
  console.log(`[reset] duplicados detectados: ${duplicates.length}${duplicates.length ? " " + JSON.stringify(duplicates) : ""}`);
  console.log("[reset] Listo.");
}

main()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("[reset] FALLÓ:", err.message);
    db.close();
    process.exit(1);
  });

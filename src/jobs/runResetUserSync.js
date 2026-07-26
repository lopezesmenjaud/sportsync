// src/jobs/runResetUserSync.js
//
// Reset TOTAL del calendario de UN usuario: borra los calendarios "FanSchedule"
// que existan en su Google (incluido un huérfano de pruebas), limpia el vínculo en
// la DB y recrea sus eventos futuros en un calendario nuevo.
//
// Caso: el usuario tenía DOS calendarios "FanSchedule" (uno huérfano). Borró uno a
// mano; el fanschedule_calendar_id guardado apunta a uno inexistente, y hay un
// "FanSchedule" vivo que la app no conoce, con eventos viejos.
//
// Qué hace (SOLO para TARGET_USER, al aplicar con CONFIRM=1), EN ESTE ORDEN:
//   1. Lista los calendarios del usuario y encuentra TODOS los "FanSchedule".
//   2. BORRA de Google cada uno (calendar.calendars.delete) — IRREVERSIBLE.
//      Guarda triple: summary === "FanSchedule" && !primary && accessRole === "owner".
//   3. fanschedule_calendar_id = NULL en google_accounts.
//   4. DELETE de todas las filas de calendar_events del usuario.
//   5. Recrea: fuerza un calendario FanSchedule NUEVO y re-crea todos los partidos
//      futuros suscritos, reusando primitivos POR-USUARIO (getOrCreateFanscheduleCalendar
//      + createEvent). NO usa syncMatchToCalendars (multi-usuario) → cero efecto en otros.
//
// NO toca a ningún otro usuario. NO toca tokens (salvo refresh normal), suscripciones ni matches.
//
// Seguridad:
//   - TARGET_USER obligatorio (no hardcodeado). Sin él, aborta.
//   - Dry-run por defecto: solo LISTA qué calendarios borraría (summary+id) y cuántos
//     eventos recrearía. NO borra, no escribe, no crea. Solo lee (calendarList.list).
//   - Solo aplica con CONFIRM=1.
//   - Ruta de DB desde src/db/database.js (local vs /var/data según NODE_ENV).
//
// Uso:
//   Dry-run local:   TARGET_USER=tu@email node src/jobs/runResetUserSync.js
//   Aplicar local:   TARGET_USER=tu@email CONFIRM=1 node src/jobs/runResetUserSync.js
//   Aplicar Render:  TARGET_USER=tu@email CONFIRM=1 NODE_ENV=production node src/jobs/runResetUserSync.js
//
// NOTA de concurrencia: corre en proceso aparte del server (no comparte el mutex del
// scheduler). Córrelo cuando el scheduler no sincronice a este usuario, o reinicia el
// servicio antes. El script reporta duplicados al final si los detecta.

require("dotenv").config();

const { db } = require("../db/database");

const TARGET_USER = process.env.TARGET_USER;
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const FANSCHEDULE_SUMMARY = "FanSchedule";

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

function isInvalidGrant(err) {
  const msg     = String(err?.message || "").toLowerCase();
  const respErr = String(err?.response?.data?.error || "").toLowerCase();
  const code    = String(err?.code || "").toLowerCase();
  return msg.includes("invalid_grant") || respErr === "invalid_grant" || code === "invalid_grant";
}

// Solo borrables: se llaman exactamente "FanSchedule", NO son el primario, y el
// usuario es OWNER. Triple guarda para nunca tocar el calendario primario ni ajenos.
function isDeletableFanschedule(cal) {
  return (cal.summary || "") === FANSCHEDULE_SUMMARY && !cal.primary && cal.accessRole === "owner";
}

async function main() {
  if (!TARGET_USER) {
    console.error("[reset] TARGET_USER es obligatorio. Ej: TARGET_USER=tu@email node src/jobs/runResetUserSync.js");
    process.exit(1);
  }

  console.log(`[reset] modo: ${APPLY ? "APLICAR (CONFIRM=1)" : "DRY-RUN (solo lista; no borra, no escribe, no crea)"}`);
  console.log(`[reset] TARGET_USER=${TARGET_USER}`);

  const account = await get(
    "SELECT userId, fanschedule_calendar_id FROM google_accounts WHERE userId = ?",
    [TARGET_USER]
  );
  if (!account) {
    console.error(`[reset] No existe google_accounts para userId=${TARGET_USER}. Aborta (¿typo en TARGET_USER?).`);
    process.exit(1);
  }
  const savedId = account.fanschedule_calendar_id;

  const { n: eventCount } = await get(
    "SELECT COUNT(*) n FROM calendar_events WHERE userId = ?",
    [TARGET_USER]
  );

  const { getMatchesForUser, getUserSide } = require("../services/subscriptionMatchService");
  const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
  // Subs del TARGET_USER UNA sola vez (no por partido): se reusan para filtrar los partidos
  // y para calcular userSide en la recreación. Si la lectura falla, cae en [] y sigue SIN
  // prefijo (mismo criterio que getSubsForUser) — el reset nunca debe tronar por esto.
  let targetSubs = [];
  try {
    targetSubs = await subscriptionRepository.getByUserId(TARGET_USER);
  } catch (e) {
    console.error(`[reset] No se pudieron leer subs de ${TARGET_USER} (userSide→null, sin prefijo): ${e.message}`);
    targetSubs = [];
  }
  const nowIso = new Date().toISOString();
  const futureMatches = (await getMatchesForUser(TARGET_USER, targetSubs)).filter(
    (m) => (m.currentStartUtc || m.scheduledStartUtc || "") >= nowIso
  );

  // Listar calendarios reales en Google (lectura).
  const googleCalendarProvider = require("../services/googleCalendarProvider");
  const calendar = await googleCalendarProvider.getCalendarClientForUser(TARGET_USER);
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const items = list.data.items || [];
  const toDelete = items.filter(isDeletableFanschedule);
  const savedExists = savedId ? items.some((c) => c.id === savedId) : false;

  console.log(`[reset] fanschedule_calendar_id guardado: ${savedId || "(NULL)"} ${savedId ? (savedExists ? "(existe en Google)" : "(YA NO existe en Google)") : ""}`);
  console.log(`[reset] calendar_events de este usuario: ${eventCount}`);
  console.log(`[reset] partidos futuros suscritos a recrear: ${futureMatches.length}`);
  console.log(`[reset] calendarios "FanSchedule" borrables encontrados: ${toDelete.length}`);
  if (toDelete.length) {
    console.table(toDelete.map((c) => ({ summary: c.summary, id: c.id, accessRole: c.accessRole })));
  }

  if (!APPLY) {
    console.log("─".repeat(60));
    console.log("[reset] DRY-RUN. Al aplicar con CONFIRM=1 haría, en orden:");
    console.log(`[reset]   1. BORRAR de Google (IRREVERSIBLE) ${toDelete.length} calendario(s) "FanSchedule" listados arriba`);
    console.log(`[reset]   2. fanschedule_calendar_id = NULL`);
    console.log(`[reset]   3. borrar ${eventCount} filas de calendar_events`);
    console.log(`[reset]   4. recrear ${futureMatches.length} eventos en un calendario nuevo`);
    console.log("[reset] Revisa la lista de calendarios de arriba ANTES de aplicar. Nada se modificó.");
    return;
  }

  // ── 1) BORRAR calendarios FanSchedule de Google (IRREVERSIBLE) ──
  let deletedCals = 0;
  for (const c of toDelete) {
    try {
      await calendar.calendars.delete({ calendarId: c.id });
      deletedCals++;
      console.log(`[reset] calendario Google borrado: "${c.summary}" ${c.id}`);
    } catch (e) {
      console.error(`[reset] error borrando calendario ${c.id}: ${e.message}`);
    }
  }
  console.log(`[reset] calendarios "FanSchedule" borrados de Google: ${deletedCals}/${toDelete.length}`);

  // ── 2) NULL + 3) borrar calendar_events (SOLO este userId) ──
  const now = new Date().toISOString();
  await run(
    "UPDATE google_accounts SET fanschedule_calendar_id = NULL, updatedAtUtc = ? WHERE userId = ?",
    [now, TARGET_USER]
  );
  const del = await run("DELETE FROM calendar_events WHERE userId = ?", [TARGET_USER]);
  const afterReset = await get(
    "SELECT fanschedule_calendar_id FROM google_accounts WHERE userId = ?",
    [TARGET_USER]
  );
  console.log(`[reset] fanschedule_calendar_id ahora: ${afterReset.fanschedule_calendar_id === null ? "NULL ✓" : afterReset.fanschedule_calendar_id}`);
  console.log(`[reset] calendar_events borradas: ${del.changes}`);

  // Limpiar caché en memoria del calendarId por si acaso.
  googleCalendarProvider.invalidateFanscheduleCalendarCache(TARGET_USER);

  // ── 5) RECREACIÓN FORZADA (primitivos POR-USUARIO) ──
  const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
  let recreated = 0;
  let skipped = 0;
  let errors = 0;
  for (let i = 0; i < futureMatches.length; i++) {
    const m = futureMatches[i];
    try {
      const calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId: TARGET_USER });
      const existing = await calendarEventRepository.getByUserIdAndProviderMatchId(TARGET_USER, m.providerMatchId);
      if (existing) { skipped++; continue; }

      // Perspectiva Local/Visitante de ESTE usuario (subs cargadas una vez arriba).
      const userSide = getUserSide(m, targetSubs);
      const created = await googleCalendarProvider.createEvent({ userId: TARGET_USER, calendarId, match: m, userSide });
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

  console.log("─".repeat(60));
  console.log(`[reset] calendarios Google borrados: ${deletedCals}`);
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

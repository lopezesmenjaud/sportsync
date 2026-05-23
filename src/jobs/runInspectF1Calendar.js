require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { getCalendarClientForUser } = require("../services/googleCalendarProvider");

const TARGET_EMAIL = process.env.INSPECT_EMAIL || "lopezesmenjaud@gmail.com";

function fmtCDMX(iso) {
  if (!iso) return "(null)";
  const d = new Date(iso);
  if (isNaN(d)) return "(invalid)";
  return d.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchGoogleEvent(calendar, calendarIds, eventId) {
  for (const calId of calendarIds) {
    if (!calId) continue;
    try {
      const res = await calendar.events.get({ calendarId: calId, eventId });
      return { calendarId: calId, event: res.data };
    } catch (err) {
      const status = err?.code || err?.response?.status;
      if (status === 404 || status === 410) continue;
      return { calendarId: calId, error: `${status || ""} ${err.message || err}`.trim() };
    }
  }
  return { calendarId: null, error: "no encontrado en ningún calendario probado" };
}

async function run() {
  await initializeDatabase();

  console.log("=".repeat(110));
  console.log(`INSPECCIÓN F1 — usuario buscado: ${TARGET_EMAIL}`);
  console.log("Hora UTC ahora     :", new Date().toISOString());
  console.log("Hora CDMX ahora    :", fmtCDMX(new Date().toISOString()));
  console.log("=".repeat(110));

  // 1. Encontrar cuenta
  const allAccounts = await googleAccountRepository.getAll();
  console.log(`\nCuentas en BD: ${allAccounts.length}`);
  for (const a of allAccounts) {
    console.log(`  - userId=${a.userId}  email=${a.googleEmail}  fanschedule_calendar_id=${a.fanschedule_calendar_id || "(null)"}`);
  }

  const target = allAccounts.find(
    a => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!target) {
    console.error(`\n❌ No se encontró cuenta con email "${TARGET_EMAIL}".`);
    console.error(`   Tip: corre con INSPECT_EMAIL=otra@cuenta.com node src/jobs/runInspectF1Calendar.js`);
    process.exit(1);
  }
  console.log(`\n→ Cuenta seleccionada: userId=${target.userId}  email=${target.googleEmail}`);
  console.log(`  fanschedule_calendar_id=${target.fanschedule_calendar_id || "(null)"}`);

  // 2. Partidos de motorsport
  const motorMatches = await matchRepository.getBySport("motorsport");
  console.log(`\nPartidos motorsport en BD (total): ${motorMatches.length}`);

  // Filtrar a próximos / recientes (últimos 7 días, próximos 30) para que la salida sea legible
  const now = Date.now();
  const windowFrom = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const windowTo = new Date(now + 30 * 24 * 3600 * 1000).toISOString();
  const inWindow = motorMatches
    .filter(m => {
      const d = m.currentStartUtc || m.scheduledStartUtc;
      return d && d >= windowFrom && d <= windowTo;
    })
    .sort((a, b) => (a.currentStartUtc || "").localeCompare(b.currentStartUtc || ""));

  console.log(`Partidos motorsport en ventana [-7d, +30d]: ${inWindow.length}`);

  if (inWindow.length === 0) {
    console.log("  (no hay partidos motorsport en ventana — saliendo)");
    process.exit(0);
  }

  // 3. Calendar events del usuario
  const allCalEventsUser = await calendarEventRepository.getByUserId(target.userId);
  console.log(`\nCalendar events del usuario (total): ${allCalEventsUser.length}`);

  // Build calendar client + lista de calendarIds a probar
  let calendar;
  try {
    calendar = await getCalendarClientForUser(target.userId);
  } catch (err) {
    console.error(`❌ No se pudo construir el client de Calendar: ${err.message}`);
    process.exit(1);
  }
  const calendarIdsToTry = [target.fanschedule_calendar_id, "primary"];

  // 4. Por partido: enlaces + evento real en Google
  const summary = [];
  for (const m of inWindow) {
    const eventName = m.eventName || `${m.homeParticipantName || ""} vs ${m.awayParticipantName || ""}`.trim() || "(sin nombre)";
    console.log("\n" + "-".repeat(110));
    console.log(`▶  ${eventName}`);
    console.log(`    providerMatchId   : ${m.providerMatchId}`);
    console.log(`    competitionKey    : ${m.competitionKey}  (${m.competitionName})`);
    console.log(`    scheduledStartUtc : ${m.scheduledStartUtc}  → CDMX: ${fmtCDMX(m.scheduledStartUtc)}`);
    console.log(`    currentStartUtc   : ${m.currentStartUtc}  → CDMX: ${fmtCDMX(m.currentStartUtc)}`);

    const links = allCalEventsUser.filter(ce => ce.providerMatchId === m.providerMatchId);
    if (links.length === 0) {
      console.log(`    calendar_events   : (ninguno)`);
      summary.push({ event: eventName, db: m.currentStartUtc, google: "(no link)", calId: "—", match: "—" });
      continue;
    }

    if (links.length > 1) {
      console.log(`    ⚠️  ${links.length} registros para este partido (posible duplicación)`);
    }

    for (const link of links) {
      console.log(`    └ link id=${link.id}  calendarEventId=${link.calendarEventId}  provider=${link.calendarProvider}  created=${link.createdAtUtc}  updated=${link.updatedAtUtc}`);
      const got = await fetchGoogleEvent(calendar, calendarIdsToTry, link.calendarEventId);
      if (got.error) {
        console.log(`        Google         : ERROR — ${got.error}`);
        summary.push({ event: eventName, db: m.currentStartUtc, google: `ERROR ${got.error}`, calId: "—", match: "—" });
        continue;
      }
      const gStart = got.event.start || {};
      const gEnd = got.event.end || {};
      console.log(`        Google calId    : ${got.calendarId}`);
      console.log(`        Google summary  : ${got.event.summary}`);
      console.log(`        Google start    : dateTime=${gStart.dateTime || gStart.date}  timeZone=${gStart.timeZone}`);
      console.log(`        Google end      : dateTime=${gEnd.dateTime || gEnd.date}  timeZone=${gEnd.timeZone}`);
      console.log(`        Google start CDMX: ${fmtCDMX(gStart.dateTime || gStart.date)}`);

      const dbMs = new Date(m.currentStartUtc).getTime();
      const gMs = new Date(gStart.dateTime || gStart.date).getTime();
      const diffMin = isNaN(dbMs) || isNaN(gMs) ? null : Math.round((gMs - dbMs) / 60000);
      console.log(`        Δ (google − db) : ${diffMin === null ? "(N/A)" : diffMin + " min"}`);

      summary.push({
        event: eventName,
        db: m.currentStartUtc,
        google: gStart.dateTime || gStart.date,
        calId: got.calendarId,
        match: diffMin === 0 ? "OK ✓" : `${diffMin} min ✗`,
      });
    }
  }

  // 5. Tabla resumen
  console.log("\n" + "=".repeat(110));
  console.log("RESUMEN");
  console.log("=".repeat(110));
  const fmt = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  console.log(
    fmt("Evento", 42) +
    fmt("DB currentStartUtc", 26) +
    fmt("Google start (UTC)", 26) +
    fmt("CalId", 10) +
    "Δ"
  );
  console.log("-".repeat(110));
  for (const r of summary) {
    console.log(
      fmt(r.event, 42) +
      fmt(r.db, 26) +
      fmt(r.google, 26) +
      fmt(r.calId === "primary" ? "primary" : (r.calId || "—").slice(0, 9), 10) +
      r.match
    );
  }

  console.log("\nFIN.");
  process.exit(0);
}

run().catch(err => {
  console.error("DIAGNÓSTICO FALLÓ:", err);
  process.exit(1);
});

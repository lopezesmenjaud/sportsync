require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { getCalendarClientForUser } = require("../services/googleCalendarProvider");

const TARGET_EMAIL = process.env.TARGET_EMAIL || "lopezesmenjaud@gmail.com";
const CONFIRM = process.env.CONFIRM === "yes";

function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

// Solo lee el evento para reportar (summary + calendarId real). NO modifica nada.
async function locateEvent(calendar, calendarIds, eventId) {
  for (const calId of calendarIds) {
    if (!calId) continue;
    try {
      const res = await calendar.events.get({ calendarId: calId, eventId });
      return { calendarId: calId, event: res.data, gone: false };
    } catch (err) {
      if (isGoneStatus(err)) continue;
      return { calendarId: calId, event: null, gone: false, error: err };
    }
  }
  return { calendarId: null, event: null, gone: true };
}

async function run() {
  await initializeDatabase();

  console.log("=".repeat(110));
  console.log(`LIMPIEZA DE CALENDARIO POR USUARIO`);
  console.log(`Usuario buscado    : ${TARGET_EMAIL}`);
  console.log(`Modo               : ${CONFIRM ? "BORRADO (CONFIRM=yes)" : "REPORTE (sin borrar)"}`);
  console.log("Hora UTC ahora     :", new Date().toISOString());
  console.log("=".repeat(110));

  // 1. Encontrar cuenta
  const allAccounts = await googleAccountRepository.getAll();
  const target = allAccounts.find(
    a => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!target) {
    console.error(`\n❌ No se encontró cuenta con email "${TARGET_EMAIL}".`);
    console.error(`   Tip: corre con TARGET_EMAIL=otra@cuenta.com node src/jobs/runCleanupUserCalendar.js`);
    process.exit(1);
  }
  console.log(`\n→ Cuenta: userId=${target.userId}  email=${target.googleEmail}`);
  console.log(`  fanschedule_calendar_id=${target.fanschedule_calendar_id || "(null)"}`);

  // 2. Cargar TODOS los registros de calendar_events del usuario
  const links = await calendarEventRepository.getByUserId(target.userId);
  console.log(`\nRegistros en calendar_events para este usuario: ${links.length}`);

  if (links.length === 0) {
    console.log("\nNada que limpiar. FIN.");
    process.exit(0);
  }

  // 3. Cliente de Google Calendar
  let calendar;
  try {
    calendar = await getCalendarClientForUser(target.userId);
  } catch (err) {
    console.error(`❌ No se pudo construir el client de Calendar: ${err.message}`);
    process.exit(1);
  }
  const calendarIdsToTry = [target.fanschedule_calendar_id, "primary"];

  // ─────────────────────────────────────────────
  // FASE DE REPORTE (siempre corre)
  // ─────────────────────────────────────────────
  console.log("\n" + "-".repeat(110));
  console.log("REPORTE — registros que serán procesados:");
  console.log("-".repeat(110));

  const plan = [];
  for (const link of links) {
    const located = await locateEvent(calendar, calendarIdsToTry, link.calendarEventId);

    let eventName;
    if (located.event) {
      eventName = located.event.summary || "(sin summary)";
    } else {
      // Fallback: nombre desde matches
      const match = await matchRepository.getByProviderMatchId(link.providerMatchId);
      if (match) {
        const teams = `${match.homeParticipantName || ""} vs ${match.awayParticipantName || ""}`.trim();
        eventName = teams && teams !== "vs" ? teams : (match.eventName || "(sin nombre)");
      } else {
        eventName = "(partido no en BD)";
      }
      if (located.gone) eventName += " [evento ya no existe en Google]";
    }

    console.log(
      `  id=${link.id}  providerMatchId=${link.providerMatchId}  ` +
      `eventId=${link.calendarEventId}  ` +
      `calId=${located.calendarId || "(no encontrado)"}  ` +
      `evento="${eventName}"`
    );

    plan.push({ link, located, eventName });
  }

  console.log("\n" + "=".repeat(110));
  console.log(`Se borrarán ${plan.length} eventos de Google Calendar y ${plan.length} registros de la BD.`);
  console.log("=".repeat(110));

  if (!CONFIRM) {
    console.log("\nModo reporte. Para borrar, corre con CONFIRM=yes.");
    process.exit(0);
  }

  // ─────────────────────────────────────────────
  // FASE DE BORRADO (solo si CONFIRM=yes)
  // ─────────────────────────────────────────────
  console.log("\n" + "-".repeat(110));
  console.log("BORRADO — procediendo...");
  console.log("-".repeat(110));

  let okGoogle = 0;
  let goneGoogle = 0;
  let errGoogle = 0;
  let okDb = 0;
  let errDb = 0;
  let skippedDb = 0;

  for (let i = 0; i < plan.length; i++) {
    const { link, located, eventName } = plan[i];
    const tag = `[${i + 1}/${plan.length}]`;
    console.log(`\n${tag} providerMatchId=${link.providerMatchId}  eventId=${link.calendarEventId}  — "${eventName}"`);

    // Borrar evento en Google Calendar. Solo borramos POR eventId conocido,
    // que es el id que NOSOTROS guardamos al crear el evento — nunca tocamos
    // eventos personales del usuario.
    const targetCalendarId = located.calendarId || target.fanschedule_calendar_id || "primary";
    let shouldDeleteDbRow = false;
    try {
      await calendar.events.delete({ calendarId: targetCalendarId, eventId: link.calendarEventId });
      console.log(`${tag}   ✓ Google Calendar: evento borrado de ${targetCalendarId}`);
      okGoogle++;
      shouldDeleteDbRow = true;
    } catch (err) {
      if (isGoneStatus(err)) {
        console.log(`${tag}   ✓ Google Calendar: el evento ya no existía (404/410) — tratado como éxito`);
        goneGoogle++;
        shouldDeleteDbRow = true;
      } else {
        console.error(`${tag}   ✗ Google Calendar: ERROR — ${err.message}`);
        console.error(`${tag}   ⤷ Fila ${link.id} se MANTIENE en BD para evitar evento huérfano en Google. Reintentar cuando se resuelva el error.`);
        errGoogle++;
      }
    }

    // Solo borramos la fila si Google confirmó éxito o devolvió 404/410.
    // Si Google falló con otro código (403/429/500/red), DEJAMOS la fila intacta:
    // borrarla mientras el evento sigue en Google produciría un evento huérfano,
    // y la próxima sincronización crearía un duplicado encima.
    if (shouldDeleteDbRow) {
      try {
        await calendarEventRepository.deleteById(link.id);
        console.log(`${tag}   ✓ DB: fila ${link.id} eliminada de calendar_events`);
        okDb++;
      } catch (err) {
        console.error(`${tag}   ✗ DB: ERROR borrando fila ${link.id} — ${err.message}`);
        errDb++;
      }
    } else {
      skippedDb++;
    }
  }

  console.log("\n" + "=".repeat(110));
  console.log("RESUMEN");
  console.log("=".repeat(110));
  console.log(`Google Calendar : borrados=${okGoogle}  ya-no-existían=${goneGoogle}  errores=${errGoogle}`);
  console.log(`BD              : filas borradas=${okDb}  errores=${errDb}  mantenidas-por-error-en-google=${skippedDb}`);

  console.log("\nFIN.");
  process.exit(errGoogle + errDb > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("LIMPIEZA FALLÓ:", err);
  process.exit(1);
});

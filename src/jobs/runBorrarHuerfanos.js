// Borra los eventos HUÉRFANOS de un usuario: eventos vivos en su calendario de FanSchedule que
// NO tienen fila en calendar_events. Quedaron así en el episodio del 2026-08-01 (rate limit de
// Google + un catch que borraba la fila aunque el borrado fallara). Son invisibles para el
// sistema: nada los va a limpiar solo, y al re-suscribirse se crea un duplicado encima.
//
// ESTE JOB NO ESCRIBE EN LA BASE. Solo borra en Google.
// No es un descuido: un huérfano NO TIENE fila por definición, así que del lado nuestro no hay
// nada que borrar. La base se abre en readonly (viene así de runAuditoriaCalendario) y SQLite
// rechazaría cualquier escritura. Si algún día este job necesitara escribir, es señal de que
// dejó de estar borrando huérfanos y hay que repensarlo.
//
// El descubrimiento NO se duplica: se reusa auditAccount() de runAuditoriaCalendario.js, que ya
// lista el calendario y resta contra calendar_events.
//
// CUATRO SEÑALES INDEPENDIENTES, todas obligatorias, antes de borrar un evento:
//   1. Está en el calendario de google_accounts.fanschedule_calendar_id. Nunca "primary" ni otro.
//      Sin ese id, el job aborta — jamás crea calendarios.
//   2. NO tiene fila en calendar_events. Se RE-COMPRUEBA justo antes de cada borrado, no solo
//      al descubrirlo.
//   3. Su descripción trae la URL fanschedule.com/match/... que pone buildEventFromMatch
//      (googleCalendarProvider.js:104-113). Sin esa marca no es nuestro: puede ser algo que el
//      usuario creó a mano en ese calendario.
//   4. Su "created" de Google es de hace más de MIN_EDAD_MINUTOS. Cierra una carrera real:
//      createCalendarEventIfMissing crea el evento en Google y DESPUÉS inserta la fila
//      (calendarSyncService.js:55-62), así que un evento legítimo recién creado por el scheduler
//      se ve como huérfano durante unos milisegundos.
//
// Uso:
//   cd ~/project/src
//   node src/jobs/runBorrarHuerfanos.js                          ← ENSAYO (no borra nada)
//   CONFIRM=1 MAX=5 node src/jobs/runBorrarHuerfanos.js          ← borra 5, para verificar
//   CONFIRM=1 node src/jobs/runBorrarHuerfanos.js                ← borra el resto
//   TARGET_USER=otro@correo.com ... (default: lopezesmenjaud@gmail.com)

require("dotenv").config();

const { sleep, withRateLimitRetry } = require("../services/userBackfillService");
const {
  db,
  auditAccount,
  hasCalendarEventRow,
  competitionOf,
  matchIdOf,
  tally,
} = require("./runAuditoriaCalendario");

const TARGET_USER = process.env.TARGET_USER || "lopezesmenjaud@gmail.com";
const CONFIRM = process.env.CONFIRM === "1";
const MAX = process.env.MAX ? Number(process.env.MAX) : Infinity;
const PAUSE_MS = Number(process.env.PAUSE_MS || 150);
const MIN_EDAD_MINUTOS = Number(process.env.MIN_EDAD_MINUTOS || 60);
const MUESTRA = Number(process.env.MUESTRA || 10);

// 404/410 = el evento ya no está. Para un borrado eso es ÉXITO, no error. Mismo criterio que
// googleCalendarProvider.js:141-144 y runCleanupUserCalendar.js:12-15.
function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

const fechaDe = (ev) => ((ev.start && (ev.start.dateTime || ev.start.date)) || "").slice(0, 16);

async function run() {
  console.log("=".repeat(100));
  console.log("BORRADO DE EVENTOS HUÉRFANOS EN GOOGLE CALENDAR");
  console.log(`Usuario   : ${TARGET_USER}`);
  console.log(`Modo      : ${CONFIRM ? "BORRADO REAL (CONFIRM=1)" : "ENSAYO — no se borra nada"}`);
  console.log(`Límite    : ${MAX === Infinity ? "(sin límite)" : MAX}`);
  console.log(`Pausa     : ${PAUSE_MS} ms   Edad mínima: ${MIN_EDAD_MINUTOS} min`);
  console.log(`Hora UTC  : ${new Date().toISOString()}`);
  console.log("La base se abre en SOLO LECTURA: un huérfano no tiene fila, no hay nada que borrar aquí.");
  console.log("=".repeat(100));

  const account = db.prepare("SELECT * FROM google_accounts WHERE userId = ?").get(TARGET_USER);
  if (!account) {
    console.error(`\n❌ No hay cuenta de Google para userId="${TARGET_USER}".`);
    process.exit(1);
  }
  // SEÑAL 1 — sin calendario propio no se sigue. Este job NO crea calendarios ni toca "primary".
  if (!account.fanschedule_calendar_id) {
    console.error(`\n❌ ${TARGET_USER} no tiene fanschedule_calendar_id.`);
    console.error(`   Abortando: este job solo borra dentro del calendario de FanSchedule y NO lo crea.`);
    process.exit(1);
  }

  const { orphans, events, calendar, calendarId } = await auditAccount(account);
  console.log(`\nEventos en el calendario ${calendarId}: ${events.length}`);
  console.log(`Huérfanos detectados (sin fila en calendar_events): ${orphans.length}`);

  // ── Señales 3 y 4 ──
  const corteUtc = Date.now() - MIN_EDAD_MINUTOS * 60 * 1000;
  const sinMarca = [];
  const demasiadoNuevos = [];
  const candidatos = [];

  for (const ev of orphans) {
    if (!matchIdOf(ev)) { sinMarca.push(ev); continue; }          // SEÑAL 3
    const creado = Date.parse(ev.created || "");
    // Sin "created" legible se descarta: ante la duda, no se borra.
    if (!Number.isFinite(creado) || creado > corteUtc) { demasiadoNuevos.push(ev); continue; } // SEÑAL 4
    candidatos.push(ev);
  }

  console.log(`\nFiltros de seguridad sobre los ${orphans.length} huérfanos:`);
  console.log(`  descartados por NO traer la marca fanschedule.com/match/ : ${sinMarca.length}`);
  console.log(`  descartados por ser recientes (< ${MIN_EDAD_MINUTOS} min o sin fecha de creación): ${demasiadoNuevos.length}`);
  console.log(`  CANDIDATOS a borrar: ${candidatos.length}`);

  if (sinMarca.length) {
    console.log(`\n  Muestra de los descartados por falta de marca (NO son nuestros, no se tocan):`);
    console.table(sinMarca.slice(0, MUESTRA).map((e) => ({
      titulo: (e.summary || "").slice(0, 45), fecha: fechaDe(e), creado: (e.created || "?").slice(0, 16),
    })));
  }
  if (demasiadoNuevos.length) {
    console.log(`\n  Muestra de los descartados por recientes (posible carrera con el scheduler):`);
    console.table(demasiadoNuevos.slice(0, MUESTRA).map((e) => ({
      titulo: (e.summary || "").slice(0, 45), fecha: fechaDe(e), creado: (e.created || "?").slice(0, 16),
    })));
  }

  const aBorrar = candidatos.slice(0, MAX === Infinity ? undefined : MAX);

  console.log("\n" + "-".repeat(100));
  console.log(`SE VAN A BORRAR ${aBorrar.length} EVENTOS${MAX !== Infinity && candidatos.length > MAX ? ` (de ${candidatos.length} candidatos; MAX=${MAX})` : ""}`);
  console.log("-".repeat(100));
  if (aBorrar.length) {
    console.log("\nDesglose por competencia:");
    console.table(tally(aBorrar, competitionOf).map((r) => ({ competencia: r.competencia, aBorrar: r.n })));
    console.log(`\nMuestra de ${Math.min(MUESTRA, aBorrar.length)}:`);
    console.table(aBorrar.slice(0, MUESTRA).map((e) => ({
      titulo: (e.summary || "").slice(0, 45),
      fecha: fechaDe(e),
      competencia: competitionOf(e).slice(0, 18),
      partido: matchIdOf(e),
      creado: (e.created || "").slice(0, 16),
    })));
  }

  if (!CONFIRM) {
    console.log("\n" + "=".repeat(100));
    console.log("ENSAYO. No se borró nada. Para aplicar:  CONFIRM=1 MAX=5 node src/jobs/runBorrarHuerfanos.js");
    console.log("=".repeat(100));
    return;
  }
  if (aBorrar.length === 0) {
    console.log("\nNada que borrar. FIN.");
    return;
  }

  console.log("\n" + "-".repeat(100));
  console.log("BORRANDO...");
  console.log("-".repeat(100));

  let borrados = 0, yaNoEstaban = 0, errores = 0, abortadosPorFila = 0;

  for (let i = 0; i < aBorrar.length; i++) {
    const ev = aBorrar[i];
    const tag = `[${i + 1}/${aBorrar.length}]`;

    // SEÑAL 2, re-comprobada: entre el descubrimiento y este momento pudo aparecer la fila (el
    // scheduler corriendo en paralelo). Si apareció, el evento es legítimo y NO se toca.
    if (hasCalendarEventRow(TARGET_USER, ev.id)) {
      console.log(`${tag} ⏭  ${ev.id} YA tiene fila en calendar_events — dejó de ser huérfano, no se borra.`);
      abortadosPorFila++;
      continue;
    }

    try {
      await withRateLimitRetry(
        () => calendar.events.delete({ calendarId, eventId: ev.id }),
        "[huerfanos]"
      );
      borrados++;
      console.log(`${tag} ✓ borrado  "${(ev.summary || "").slice(0, 50)}"  (${fechaDe(ev)})`);
    } catch (err) {
      if (isGoneStatus(err)) {
        yaNoEstaban++;
        console.log(`${tag} ✓ ya no existía (404/410) — tratado como éxito`);
      } else {
        errores++;
        console.error(`${tag} ✗ ERROR al borrar ${ev.id}: ${err.message}`);
      }
    }

    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

  console.log("\n" + "=".repeat(100));
  console.log("RESUMEN");
  console.log("=".repeat(100));
  console.log(`Confirmados por Google : ${borrados} borrados + ${yaNoEstaban} que ya no existían = ${borrados + yaNoEstaban}`);
  console.log(`Fallos                 : ${errores}`);
  console.log(`Saltados por tener fila: ${abortadosPorFila}`);
  console.log(`Quedan por procesar    : ${Math.max(0, candidatos.length - aBorrar.length)} candidatos fuera de MAX`);
  console.log(`\nLa base no fue modificada (readonly).`);
  if (errores > 0) {
    console.log(`\n⚠  Hubo ${errores} fallos: esos eventos SIGUEN en Google. Vuelve a correr el job para reintentarlos.`);
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("BORRADO FALLÓ:", err.message);
      process.exit(1);
    });
}

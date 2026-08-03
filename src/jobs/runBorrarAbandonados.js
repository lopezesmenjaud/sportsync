// Borra los eventos ABANDONADOS FUTUROS de un usuario: los que tienen fila en calendar_events Y
// evento en Google, pero ninguna suscripción ACTUAL de esa persona los cubre.
//
// Quedaron varados porque el cleanup de DELETE /subscriptions/:id pregunta "¿ALGUIEN sigue esta
// liga?" en vez de "¿ESTE usuario todavía quiere este evento?" (usa subscriptionRepository
// .getAll()). Caso real: jcgviejo@gmail.com se dio de baja de la Champions y sus eventos siguen
// ahí porque otro usuario la sigue.
//
//   El calendario de un usuario depende ÚNICAMENTE de las suscripciones de ese usuario.
//
// DIFERENCIA CON runBorrarHuerfanos: allá la fila NO existe (por eso aquel job no escribe en la
// base). Aquí la fila SÍ existe, así que hay que borrar en LOS DOS LADOS: el evento en Google y
// la fila en calendar_events.
//
// El predicado NO se redefine: se reusa classifyUserEvents() de runAuditoriaCalendario.js, el
// mismo que produce la medición. Si el ensayo y el borrado calcularan distinto, el ensayo dejaría
// de significar algo.
//
// Uso:
//   cd ~/project/src
//   TARGET_USER=jcgviejo@gmail.com node src/jobs/runBorrarAbandonados.js                 ← ENSAYO
//   TARGET_USER=jcgviejo@gmail.com CONFIRM=1 MAX=5 node src/jobs/runBorrarAbandonados.js ← borra 5
//   TARGET_USER=jcgviejo@gmail.com CONFIRM=1 node src/jobs/runBorrarAbandonados.js       ← el resto

require("dotenv").config();

const Database = require("better-sqlite3");
const { sleep, withRateLimitRetry } = require("../services/userBackfillService");
const { db, classifyUserEvents, calendarClientFor, tally } = require("./runAuditoriaCalendario");

const TARGET_USER = process.env.TARGET_USER || "lopezesmenjaud@gmail.com";
const CONFIRM = process.env.CONFIRM === "1";
const MAX = process.env.MAX ? Number(process.env.MAX) : Infinity;
const PAUSE_MS = Number(process.env.PAUSE_MS || 150);
const MUESTRA = Number(process.env.MUESTRA || 10);

// 404/410 = el evento ya no está en Google. Para un borrado eso es ÉXITO. Mismo criterio que
// googleCalendarProvider.js:141-144 y runCleanupUserCalendar.js:12-15.
function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

const competenciaDe = (f) => f.competitionName || f.competitionKey || "(sin competencia)";

// Reconfirma el predicado para UN evento, volviendo a correr classifyUserEvents. Es una consulta
// acotada al usuario, así que repetirla por evento es barato — y garantiza que el borrado use
// EXACTAMENTE el mismo cálculo que la medición, sin una segunda implementación que se desvíe.
function sigueAbandonadoFuturo(userId, calendarEventId) {
  const c = classifyUserEvents(userId);
  return c.abandonadosFuturos.some((f) => f.calendarEventId === calendarEventId);
}

async function run() {
  console.log("=".repeat(100));
  console.log("BORRADO DE EVENTOS ABANDONADOS (futuros)");
  console.log(`Usuario   : ${TARGET_USER}`);
  console.log(`Modo      : ${CONFIRM ? "BORRADO REAL (CONFIRM=1)" : "ENSAYO — no se borra nada"}`);
  console.log(`Límite    : ${MAX === Infinity ? "(sin límite)" : MAX}`);
  console.log(`Pausa     : ${PAUSE_MS} ms`);
  console.log(`Hora UTC  : ${new Date().toISOString()}`);
  console.log("=".repeat(100));

  const account = db.prepare("SELECT * FROM google_accounts WHERE userId = ?").get(TARGET_USER);
  if (!account) {
    console.error(`\n❌ No hay cuenta de Google para userId="${TARGET_USER}".`);
    process.exit(1);
  }
  // El calendario sale SIEMPRE de fanschedule_calendar_id. Nunca "primary" ni ningún otro, por
  // ninguna ruta: sin ese id no hay dónde borrar y el job aborta en vez de adivinar.
  if (!account.fanschedule_calendar_id) {
    console.error(`\n❌ ${TARGET_USER} no tiene fanschedule_calendar_id. Abortando.`);
    console.error(`   Este job solo borra dentro del calendario de FanSchedule y NO lo crea.`);
    process.exit(1);
  }
  const calendarId = account.fanschedule_calendar_id;

  const c = classifyUserEvents(TARGET_USER);
  console.log(`\nSuscripciones actuales     : ${c.subs.length}`);
  console.log(`Filas en calendar_events   : ${c.filas.length}`);
  console.log(`  cubiertos                : ${c.cubiertos.length}   (no se tocan)`);
  console.log(`  ABANDONADOS futuros      : ${c.abandonadosFuturos.length}   ← objetivo de este job`);
  console.log(`  abandonados pasados      : ${c.abandonadosPasados.length}   (NUNCA se tocan: es el historial de esa persona)`);
  console.log(`  inevaluables             : ${c.inevaluables.length}   (sin fila en matches; no se pueden clasificar, no se tocan)`);

  const candidatos = c.abandonadosFuturos;
  const aBorrar = candidatos.slice(0, MAX === Infinity ? undefined : MAX);

  console.log("\n" + "-".repeat(100));
  console.log(`SE VAN A BORRAR ${aBorrar.length} EVENTOS${MAX !== Infinity && candidatos.length > MAX ? ` (de ${candidatos.length} candidatos; MAX=${MAX})` : ""}`);
  console.log("   en Google Y su fila en calendar_events");
  console.log("-".repeat(100));

  if (aBorrar.length) {
    console.log("\nDesglose por competencia:");
    console.table(tally(aBorrar, competenciaDe).map((r) => ({ competencia: r.competencia, aBorrar: r.n })));
    console.log(`\nMuestra de ${Math.min(MUESTRA, aBorrar.length)}:`);
    console.table(aBorrar.slice(0, MUESTRA).map((f) => ({
      partido: f.providerMatchId,
      titulo: `${f.homeParticipantName || ""} vs ${f.awayParticipantName || ""}`.slice(0, 42),
      fecha: (f.inicio || "").slice(0, 16),
      competencia: competenciaDe(f).slice(0, 18),
    })));
  }

  if (!CONFIRM) {
    console.log("\n" + "=".repeat(100));
    console.log("ENSAYO. No se borró nada. Para aplicar:");
    console.log(`  TARGET_USER=${TARGET_USER} CONFIRM=1 MAX=5 node src/jobs/runBorrarAbandonados.js`);
    console.log("=".repeat(100));
    return;
  }
  if (aBorrar.length === 0) {
    console.log("\nNada que borrar. FIN.");
    return;
  }

  // Conexión de ESCRITURA. La de runAuditoriaCalendario es readonly a propósito, así que hace
  // falta otra. Se abre sobre db.name —el archivo que esa conexión ya tiene abierto— para que sea
  // imposible escribir en una base distinta de la que se midió. Por eso tampoco se usa
  // calendarEventRepository: ese lee y escribe por la conexión de src/db/database, cuya ruta la
  // decide NODE_ENV y puede no ser la misma.
  const rw = new Database(db.name);
  const borrarFila = rw.prepare("DELETE FROM calendar_events WHERE id = ?");

  const calendar = calendarClientFor(account);

  console.log("\n" + "-".repeat(100));
  console.log(`BORRANDO... (base: ${db.name})`);
  console.log("-".repeat(100));

  let borrados = 0, yaNoEstaban = 0, errores = 0, filasConservadas = 0, saltados = 0;

  for (let i = 0; i < aBorrar.length; i++) {
    const f = aBorrar[i];
    const tag = `[${i + 1}/${aBorrar.length}]`;
    const etiqueta = `${f.homeParticipantName || ""} vs ${f.awayParticipantName || ""}`.slice(0, 40);

    // Reconfirmación: la persona pudo volver a suscribirse a media corrida. Si el evento dejó de
    // estar abandonado, ya no es nuestro problema y no se toca.
    if (!sigueAbandonadoFuturo(TARGET_USER, f.calendarEventId)) {
      console.log(`${tag} ⏭  "${etiqueta}" YA NO está abandonado (¿se volvió a suscribir?) — no se borra.`);
      saltados++;
      continue;
    }

    let confirmadoPorGoogle = false;
    try {
      await withRateLimitRetry(
        () => calendar.events.delete({ calendarId, eventId: f.calendarEventId }),
        "[abandonados]"
      );
      confirmadoPorGoogle = true;
      borrados++;
      console.log(`${tag} ✓ Google: borrado  "${etiqueta}"  (${(f.inicio || "").slice(0, 16)})`);
    } catch (err) {
      if (isGoneStatus(err)) {
        // DELIBERADO: si el evento ya no existe en Google Y además el usuario ya no sigue esa
        // liga, la fila sobra. Se borra. De paso esto limpia los que además eran FANTASMAS.
        confirmadoPorGoogle = true;
        yaNoEstaban++;
        console.log(`${tag} ✓ Google: ya no existía (404/410) — tratado como éxito, la fila sobra`);
      } else {
        errores++;
        console.error(`${tag} ✗ Google NO confirmó el borrado de ${f.calendarEventId}: ${err.message}`);
        console.error(`${tag}   ⤷ La fila ${f.id} se MANTIENE a propósito: mientras viva, el evento tiene puntero y`);
        console.error(`${tag}     esto es reintentable. Borrarla ahora lo convertiría en huérfano para siempre.`);
      }
    }

    if (confirmadoPorGoogle) {
      borrarFila.run(f.id);
    } else {
      filasConservadas++;
    }

    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

  rw.close();

  console.log("\n" + "=".repeat(100));
  console.log("RESUMEN");
  console.log("=".repeat(100));
  console.log(`Confirmados por Google : ${borrados} borrados + ${yaNoEstaban} que ya no existían = ${borrados + yaNoEstaban}`);
  console.log(`  (y sus ${borrados + yaNoEstaban} filas de calendar_events eliminadas)`);
  console.log(`Fallos                 : ${errores}`);
  console.log(`Filas conservadas a propósito porque Google no confirmó: ${filasConservadas}`);
  console.log(`Saltados por dejar de estar abandonados: ${saltados}`);
  console.log(`Quedan fuera de MAX    : ${Math.max(0, candidatos.length - aBorrar.length)} candidatos`);
  if (errores > 0) {
    console.log(`\n⚠  ${errores} evento(s) siguen en Google con su fila intacta. Vuelve a correr el job para reintentarlos.`);
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

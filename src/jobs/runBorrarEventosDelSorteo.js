require("dotenv").config();

// Borra los eventos que salieron del SORTEO DE CHAMPIONS sin calendario.
//
// TheSportsDB publicó los 126 emparejamientos del sorteo con una fecha de relleno
// (2026-09-08T19:00:00Z, intRound "0") y de ahí se escribieron 308 eventos en los calendarios
// de Google de 8 usuarios reales. El filtro de entrada ya está desplegado
// (theSportsDb.js, filtrarSorteosSinCalendario), así que no van a entrar más. Esto limpia lo
// que ya salió.
//
// ─────────────────────────────────────────────────────────────────────────────
// SIMULACRO POR OMISIÓN. Sin CONFIRM=1 no se borra NADA, ni en Google ni en la base.
// No hay bandera de "no escribas" que haya que acordarse de poner: escribir es lo que exige
// una decisión explícita.
// ─────────────────────────────────────────────────────────────────────────────
//
// Uso, en este orden:
//   cd ~/project/src
//   node src/jobs/runBorrarEventosDelSorteo.js                                   ← SIMULACRO
//   CONFIRM=1 TARGET_USER=<correo> MAX=5 node src/jobs/runBorrarEventosDelSorteo.js
//   CONFIRM=1 TARGET_USER=<correo> node src/jobs/runBorrarEventosDelSorteo.js
//   CONFIRM=1 node src/jobs/runBorrarEventosDelSorteo.js                         ← el resto
//
// Ojo con $USER en el Shell de Render: ya viene seteada. La variable de este job es
// TARGET_USER, nunca USER.
//
// LO QUE ESTE JOB NO HACE:
//   · NO borra los 126 renglones de la tabla `matches`. El cruce de abajo los NECESITA para
//     encontrar los eventos: si se borran primero, el conjunto a borrar queda vacío y los
//     eventos se vuelven invisibles. Eso va hasta el final, en su propia tarea.
//   · NO llama a initializeDatabase(): esa función limpia broadcasting_cache y tira
//     venue_cache. Un job de limpieza no tiene por qué tocar otras tablas.
//   · NO usa getOrCreateFanscheduleCalendar, que PUEDE CREAR un calendario. El id sale de
//     google_accounts.fanschedule_calendar_id y si falta, ese usuario se salta.

const { db } = require("../db/database");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { getCalendarClientForUser } = require("../services/googleCalendarProvider");
const { isInvalidGrant } = require("../services/calendarSyncService");
const { sleep, withRateLimitRetry } = require("../services/userBackfillService");

// ── El incidente, como constantes ──
// El conjunto se calcula SIEMPRE con este cruce, NUNCA con una lista de ids escrita a mano.
// Una lista pegada se desactualiza en cuanto alguien borra un evento a mano y no hay forma de
// notarlo; el cruce siempre describe la realidad de este momento.
const COMPETITION_KEY  = "4480";                  // UEFA Champions League
const INT_ROUND        = "0";                     // sin jornada asignada
const SCHEDULED_START  = "2026-09-08T19:00:00Z";  // la fecha de relleno del sorteo

// Reparto medido el 8 sep 2026. Sirve para DOS cosas: comparar contra lo que devuelva el cruce
// y, sobre todo, frenar si aparece alguien que no estaba. Se compara por la parte local del
// correo para no depender del dominio.
const ESPERADO = {
  "lopezesmenjaud":     126,
  "mj.lopezesmenjaud":  126,
  "crgp750501":          21,
  "agvdelvillar":         7,
  "antonioansedez":       7,
  "franciscorugeza":      7,
  "jcgviejo":             7,
  "juancarlosgl2008":     7,
};
const TOTAL_ESPERADO = Object.values(ESPERADO).reduce((a, b) => a + b, 0); // 308

const CONFIRM     = process.env.CONFIRM === "1";
const TARGET_USER = process.env.TARGET_USER || null;
const MAX         = process.env.MAX ? Number(process.env.MAX) : Infinity;
const PAUSE_MS    = Number(process.env.PAUSE_MS || 200);
const MUESTRA     = Number(process.env.MUESTRA || 10);

// 404/410 = el evento ya no está. Para un BORRADO eso es ÉXITO, no error. Mismo criterio que
// googleCalendarProvider.js y runBorrarHuerfanos.js.
function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

function parteLocal(userId) {
  return String(userId || "").split("@")[0].toLowerCase();
}

function linea(c = "─") {
  console.log(c.repeat(96));
}

function consultar(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

// EL CRUCE. Es la única definición del conjunto a borrar, en los dos modos.
function obtenerEventosDelSorteo() {
  return consultar(
    `
    SELECT ce.id            AS filaId,
           ce.userId        AS userId,
           ce.providerMatchId,
           ce.calendarEventId,
           m.competitionName,
           m.homeParticipantName,
           m.awayParticipantName,
           m.scheduledStartUtc
      FROM calendar_events ce
      JOIN matches m ON m.providerMatchId = ce.providerMatchId
     WHERE m.competitionKey    = ?
       AND m.intRound          = ?
       AND m.scheduledStartUtc = ?
       AND ce.calendarProvider = 'google'
     ORDER BY ce.userId, ce.providerMatchId
    `,
    [COMPETITION_KEY, INT_ROUND, SCHEDULED_START]
  );
}

function agrupar(filas, clave) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

async function main() {
  console.log("BORRADO DE LOS EVENTOS DEL SORTEO DE CHAMPIONS");
  console.log(`Cruce: competitionKey=${COMPETITION_KEY}  intRound=${INT_ROUND}  scheduledStartUtc=${SCHEDULED_START}`);
  console.log(`Modo: ${CONFIRM ? "⚠️  CONFIRM=1 — SE VA A BORRAR DE VERDAD" : "SIMULACRO (no se escribe nada)"}`);
  if (TARGET_USER) console.log(`TARGET_USER: ${TARGET_USER}`);
  if (MAX !== Infinity) console.log(`MAX: ${MAX} eventos en esta corrida`);
  linea();

  const todas = await obtenerEventosDelSorteo();

  if (todas.length === 0) {
    console.log("El cruce no devolvió ningún evento. No hay nada que borrar.");
    console.log("Si esperabas encontrar algo, revisa que los 126 renglones de `matches` sigan ahí:");
    console.log("el cruce los necesita, y borrarlos primero deja los eventos invisibles.");
    return;
  }

  // ── GUARDA: nadie fuera de los 8 conocidos ──
  // Va ANTES de cualquier otra cosa y aplica también en simulacro. Si el cruce alcanza a un
  // usuario que no estaba en la medición, algo cambió respecto de lo que creemos y no se toca
  // nada hasta entenderlo.
  const desconocidos = [...new Set(todas.map(f => f.userId))].filter(u => !(parteLocal(u) in ESPERADO));
  if (desconocidos.length > 0) {
    linea("=");
    console.error("✗ ALTO. El cruce alcanzó usuarios que NO estaban en el reparto medido:");
    for (const u of desconocidos) console.error(`    ${u}`);
    console.error("No se tocó nada. Hay que entender por qué antes de borrar.");
    linea("=");
    process.exitCode = 1;
    return;
  }

  // ── LECTURA: qué se borraría ──
  const porUsuario = agrupar(todas, f => f.userId);
  const partidos   = new Set(todas.map(f => f.providerMatchId));

  console.log(`Eventos encontrados por el cruce: ${todas.length}`);
  console.log(`Partidos distintos involucrados:  ${partidos.size}`);
  console.log("");
  console.log("Por usuario (encontrado vs. medido el 8 sep):");
  for (const [userId, n] of [...porUsuario.entries()].sort((a, b) => b[1] - a[1])) {
    const esperado = ESPERADO[parteLocal(userId)];
    const marca = n === esperado ? "ok " : "≠  ";
    console.log(`   ${marca} ${String(n).padStart(4)}  (medido ${String(esperado).padStart(4)})  ${userId}`);
  }

  console.log("");
  if (todas.length === TOTAL_ESPERADO) {
    console.log(`✓ El total coincide con lo medido: ${TOTAL_ESPERADO}.`);
  } else {
    console.log(`⚠️  El total NO coincide: el cruce da ${todas.length} y lo medido fue ${TOTAL_ESPERADO}.`);
    console.log("   Puede ser normal si ya se borró parte en una corrida anterior, o si alguien");
    console.log("   borró eventos a mano. Míralo antes de seguir.");
  }

  console.log("");
  console.log(`Muestra de ${Math.min(MUESTRA, todas.length)} eventos:`);
  for (const f of todas.slice(0, MUESTRA)) {
    const partido = `${f.homeParticipantName || "?"} vs ${f.awayParticipantName || "?"}`;
    console.log(`   ${f.userId.padEnd(28)} ${partido.slice(0, 40).padEnd(40)} ${f.providerMatchId}`);
  }

  // ── Recorte por TARGET_USER y MAX ──
  let objetivo = todas;
  if (TARGET_USER) {
    objetivo = objetivo.filter(f => f.userId === TARGET_USER || parteLocal(f.userId) === parteLocal(TARGET_USER));
    console.log("");
    console.log(`Tras filtrar por TARGET_USER: ${objetivo.length} eventos.`);
    if (objetivo.length === 0) {
      console.log("Ese usuario no tiene eventos en el cruce. Nada que hacer.");
      return;
    }
  }
  if (MAX !== Infinity && objetivo.length > MAX) {
    objetivo = objetivo.slice(0, MAX);
    console.log(`Tras aplicar MAX: ${objetivo.length} eventos en esta corrida.`);
  }

  if (!CONFIRM) {
    console.log("");
    linea("=");
    console.log(`SIMULACRO. No se borró nada: ni un evento de Google, ni un renglón de la base.`);
    console.log(`Se borrarían ${objetivo.length} eventos.`);
    console.log("");
    console.log("Para aplicar, de menos a más:");
    console.log("   CONFIRM=1 TARGET_USER=<correo> MAX=5 node src/jobs/runBorrarEventosDelSorteo.js");
    console.log("   CONFIRM=1 TARGET_USER=<correo> node src/jobs/runBorrarEventosDelSorteo.js");
    console.log("   CONFIRM=1 node src/jobs/runBorrarEventosDelSorteo.js");
    linea("=");
    return;
  }

  // ── BORRADO ──
  console.log("");
  linea();
  console.log(`BORRANDO ${objetivo.length} eventos...`);
  linea();

  // El calendario y el cliente se resuelven UNA vez por usuario, no por evento.
  const calendarioDe = new Map();  // userId → { calendar, calendarId }
  const usuariosCaidos = new Map(); // userId → motivo por el que se dejó de intentar

  let borrados = 0, yaNoEstaban = 0, fallidos = 0, saltados = 0;
  const motivos = [];

  for (let i = 0; i < objetivo.length; i++) {
    const f = objetivo[i];
    const tag = `[${i + 1}/${objetivo.length}]`;

    // A este usuario ya le falló la credencial: no se le insiste evento por evento, pero el
    // trabajo de los DEMÁS continúa. Morirse a la mitad dejaría el trabajo hecho por partes
    // sin saber cuál.
    if (usuariosCaidos.has(f.userId)) { saltados++; continue; }

    // Resolver calendario del usuario (una sola vez).
    if (!calendarioDe.has(f.userId)) {
      try {
        const cuenta = await googleAccountRepository.getByUserId(f.userId);
        const calendarId = cuenta?.fanschedule_calendar_id;
        if (!calendarId) {
          // Sin id guardado NO se adivina y NO se crea: se salta al usuario entero.
          usuariosCaidos.set(f.userId, "sin fanschedule_calendar_id en google_accounts");
          console.error(`${tag} ✗ ${f.userId}: no tiene fanschedule_calendar_id. Se salta ESE usuario.`);
          saltados++;
          continue;
        }
        const calendar = await getCalendarClientForUser(f.userId);
        calendarioDe.set(f.userId, { calendar, calendarId });
      } catch (err) {
        const motivo = isInvalidGrant(err) ? "invalid_grant (permiso vencido)" : err.message;
        usuariosCaidos.set(f.userId, motivo);
        console.error(`${tag} ✗ ${f.userId}: ${motivo}. Se salta ESE usuario, los demás siguen.`);
        saltados++;
        continue;
      }
    }

    const { calendar, calendarId } = calendarioDe.get(f.userId);
    const partido = `${f.homeParticipantName || "?"} vs ${f.awayParticipantName || "?"}`;

    // ORDEN: PRIMERO Google, y solo si eso salió bien se borra el renglón.
    //
    // Al revés sería el bug del 1 ago 2026: borrar la fila aunque Google fallara deja el evento
    // vivo en el calendario y sin rastro nuestro — un huérfano que nada vuelve a encontrar.
    let googleOk = false;
    try {
      await withRateLimitRetry(
        () => calendar.events.delete({ calendarId, eventId: f.calendarEventId }),
        "[sorteo]"
      );
      googleOk = true;
      borrados++;
      console.log(`${tag} ✓ borrado   ${f.userId.padEnd(28)} ${partido.slice(0, 36)}`);
    } catch (err) {
      if (isGoneStatus(err)) {
        // El evento ya no está en Google. Para un borrado eso es ÉXITO: igual hay que quitar
        // el renglón, que si no queda apuntando a un evento inexistente.
        googleOk = true;
        yaNoEstaban++;
        console.log(`${tag} ✓ ya no existía (404/410)  ${f.userId.padEnd(28)} ${partido.slice(0, 36)}`);
      } else if (isInvalidGrant(err)) {
        usuariosCaidos.set(f.userId, "invalid_grant (permiso vencido)");
        fallidos++;
        motivos.push(`${f.userId}: invalid_grant — hay que reconectar esa cuenta y volver a correr el job para ella`);
        console.error(`${tag} ✗ ${f.userId}: invalid_grant. Se salta ESE usuario, los demás siguen.`);
      } else {
        fallidos++;
        motivos.push(`${f.userId} / evento ${f.calendarEventId}: ${err.message}`);
        console.error(`${tag} ✗ ERROR ${f.userId}: ${err.message}`);
      }
    }

    if (googleOk) {
      try {
        await calendarEventRepository.deleteById(f.filaId);
      } catch (err) {
        // El evento YA no está en Google pero la fila sigue. No es catastrófico —la próxima
        // corrida lo verá como "ya no existía" y volverá a intentar borrar la fila— pero tiene
        // que verse.
        fallidos++;
        motivos.push(`${f.userId} / fila ${f.filaId}: evento borrado en Google pero la fila NO se pudo borrar: ${err.message}`);
        console.error(`${tag} ⚠️  evento borrado en Google, pero falló el borrado de la fila ${f.filaId}: ${err.message}`);
      }
    }

    // Pausa entre llamadas: de uno en uno, sin ráfagas contra la API de Google.
    if (i < objetivo.length - 1) await sleep(PAUSE_MS);
  }

  // ── Resumen ──
  console.log("");
  linea("=");
  console.log("RESUMEN");
  console.log(`   Borrados en Google:        ${borrados}`);
  console.log(`   Ya no existían (404/410):  ${yaNoEstaban}`);
  console.log(`   Fallidos:                  ${fallidos}`);
  console.log(`   Saltados:                  ${saltados}`);
  if (motivos.length > 0) {
    console.log("");
    console.log("   Motivos:");
    for (const m of motivos) console.log(`      · ${m}`);
  }
  if (usuariosCaidos.size > 0) {
    console.log("");
    console.log("   Usuarios que quedaron a medias (hay que volver a correr el job para ellos):");
    for (const [u, motivo] of usuariosCaidos) console.log(`      · ${u} — ${motivo}`);
  }
  console.log("");
  console.log("   Los 126 renglones de `matches` NO se tocaron, a propósito: el cruce los");
  console.log("   necesita. Se borran hasta el final, en su propia tarea.");
  linea("=");
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(err => {
    console.error("EL JOB FALLÓ:");
    console.error(err.stack || err.message);
    process.exit(1);
  });

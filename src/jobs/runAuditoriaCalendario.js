// Auditoría de consistencia entre calendar_events y los calendarios reales de Google.
//
// ESTE JOB NO ESCRIBE NADA. Ni en la base, ni en Google. Tres garantías explícitas:
//   1. La base se abre con { readonly: true } → SQLite rechaza cualquier escritura.
//      NO se llama initializeDatabase(), que sí escribe (vacía las tablas de caché al arrancar).
//   2. El cliente OAuth se arma aquí, SIN el listener on("tokens") que registra
//      getCalendarClientForUser (googleCalendarProvider.js:50-64) y que persiste el token
//      renovado con un upsert. Si el token se renueva, se queda en memoria.
//   3. NO se usa getOrCreateFanscheduleCalendar: crea un calendario en Google si no encuentra
//      el guardado (googleCalendarProvider.js:270). El id sale de la columna
//      fanschedule_calendar_id, y si no hay, se reporta y se salta.
//
// Mide las DOS direcciones, que son fallas distintas:
//   HUÉRFANO  — evento vivo en Google SIN fila en calendar_events. El sistema no sabe que existe:
//               al re-suscribirse crea un DUPLICADO encima.
//   FANTASMA  — fila en calendar_events cuyo evento YA NO está en Google. El sistema cree que ya
//               está agendado (calendarSyncService.js:48-49) y NUNCA lo vuelve a crear.
//
// Uso:
//   cd ~/project/src
//   node src/jobs/runAuditoriaCalendario.js
//   TARGET_USER=otro@correo.com node src/jobs/runAuditoriaCalendario.js
//   DB_PATH=./sportsync.db node src/jobs/runAuditoriaCalendario.js     (para correr en local)

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const Database = require("better-sqlite3");
const { decrypt } = require("../config/tokenCrypto");
const { sleep } = require("../services/userBackfillService");
const { matchAppliesToSubscription } = require("../services/subscriptionMatchService");

const DB_PATH = process.env.DB_PATH || "/var/data/sportsync.db";
const TARGET_USER = process.env.TARGET_USER || "lopezesmenjaud@gmail.com";
// Pausa entre llamadas a Google (entre páginas y entre usuarios). 291 huérfanos salieron de un
// episodio de rate limit; una auditoría no debe provocar otro.
const PAUSE_MS = Number(process.env.PAUSE_MS || 150);
const MUESTRA = Number(process.env.MUESTRA || 10);

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ No existe la base en "${DB_PATH}".`);
  console.error(`   En el Shell de Render suele ser /var/data/sportsync.db (el default).`);
  console.error(`   En local: DB_PATH=./sportsync.db node src/jobs/runAuditoriaCalendario.js`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// Credenciales: misma lógica que src/config/googleClient.js:7-17, con la ruta relativa a src/jobs.
let clientId, clientSecret, redirectUri;
const credentialsPath = path.join(__dirname, "../config/google-oauth.json");
if (fs.existsSync(credentialsPath)) {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  clientId = credentials.web.client_id;
  clientSecret = credentials.web.client_secret;
  redirectUri = credentials.web.redirect_uris[0];
} else {
  clientId = process.env.GOOGLE_CLIENT_ID;
  clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  redirectUri = process.env.GOOGLE_REDIRECT_URI;
}

// Cliente por usuario SIN listener de tokens → una renovación no toca la base.
function calendarClientFor(account) {
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({
    access_token: decrypt(account.accessToken),
    refresh_token: decrypt(account.refreshToken),
    scope: account.scope,
    expiry_date: account.expiryDate,
  });
  return google.calendar({ version: "v3", auth: client });
}

// events.list paginado. showDeleted:false → un evento cancelado no cuenta como vivo.
async function listAllEvents(calendar, calendarId) {
  const events = [];
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId, maxResults: 2500, showDeleted: false, singleEvents: false, pageToken,
    });
    events.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(PAUSE_MS);
  } while (pageToken);
  return events;
}

// La competencia de un evento sale de su descripción, que arma buildEventFromMatch
// (googleCalendarProvider.js:104-113). Si el formato no coincide, se reporta como tal en vez de
// meterlo callado en otra categoría.
function competitionOf(event) {
  const m = /Competición:\s*(.+)/.exec(event.description || "");
  return m ? m[1].trim() : "(sin competición en la descripción)";
}

function matchIdOf(event) {
  const text = `${event.description || ""} ${(event.source && event.source.url) || ""}`;
  const m = /fanschedule\.com\/match\/([^\s\n]+)/.exec(text);
  return m ? m[1] : null;
}

function tally(items, keyOf) {
  const counts = new Map();
  for (const it of items) {
    const k = keyOf(it);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([competencia, n]) => ({ competencia, n }))
    .sort((a, b) => b.n - a.n);
}

const findMatch = db.prepare(`
  SELECT competitionName, competitionKey, homeParticipantName, awayParticipantName,
         COALESCE(currentStartUtc, scheduledStartUtc) AS inicio
  FROM matches WHERE providerMatchId = ?`);

const rowsFor = (userId) =>
  db.prepare("SELECT id, calendarEventId, providerMatchId FROM calendar_events WHERE userId = ?").all(userId);

// Comprobación puntual de UN evento. La usa el job de borrado para re-verificar la condición de
// huérfano justo antes de borrar, y no solo en el momento del descubrimiento.
const hasCalendarEventRow = (userId, calendarEventId) =>
  !!db.prepare("SELECT 1 FROM calendar_events WHERE userId = ? AND calendarEventId = ? LIMIT 1")
    .get(userId, calendarEventId);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REGLA DE DISEÑO QUE ORDENA TODO ESTO:
//
//   El calendario de un usuario depende ÚNICAMENTE de las suscripciones de ese usuario.
//   Lo que hagan o dejen de hacer los demás no lo toca nunca.
//
// El cleanup de DELETE /subscriptions/:id (server.js) todavía viola esta regla: usa
// subscriptionRepository.getAll() y pregunta "¿ALGUIEN sigue esta liga?" en vez de "¿ESTE usuario
// todavía quiere este evento?". Por eso jcgviejo@gmail.com se dio de baja de la Champions y sus
// eventos siguen en su calendario: lopezesmenjaud la sigue, así que esos partidos nunca contaron
// como huérfanos. A escala, con alguien siguiendo cada liga popular, la limpieza al darse de baja
// deja de correr para nadie, nunca, y sin un solo error en ningún log.
//
// ABANDONADO es esa tercera categoría, distinta de huérfano y fantasma: la fila existe Y el evento
// existe en Google —perfectamente consistentes— pero ninguna suscripción ACTUAL de ese usuario lo
// reclama.
//
// El predicado vive aquí y se EXPORTA para que el job de borrado use exactamente el mismo. Si la
// medición y el borrado calcularan distinto, el ensayo dejaría de significar algo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Consulta ACOTADA: solo las filas de ESE usuario, con JOIN por providerMatchId (que es PRIMARY
// KEY de matches, así que va por índice). Nada de getAll(): el cleanup de hoy carga la tabla
// completa de partidos y todas las suscripciones de todos en cada baja.
//
// La decisión se toma en JS con matchAppliesToSubscription, ÚNICA fuente de verdad del predicado.
// Se puede expresar en SQL con un NOT EXISTS, pero normalizeSport() es lógica JS: traducirla
// crearía dos definiciones del mismo predicado que un día se separan en silencio.
function classifyUserEvents(userId) {
  // Las suscripciones se leen por ESTA conexión (readonly, abierta en DB_PATH) y no con
  // subscriptionRepository.getByUserId, que lee por la conexión de src/db/database — cuya ruta la
  // decide NODE_ENV. Si las dos no coinciden, estaríamos cruzando calendar_events de una base con
  // suscripciones de OTRA, y el resultado saldría mal sin avisar. Es la misma consulta, en la
  // conexión correcta.
  const subs = db.prepare("SELECT * FROM subscriptions WHERE userId = ?").all(userId);

  const filas = db.prepare(`
    SELECT ce.id, ce.calendarEventId, ce.providerMatchId,
           m.providerMatchId AS matchExiste,
           m.sport, m.competitionKey, m.competitionName,
           m.homeParticipantName, m.awayParticipantName,
           COALESCE(m.currentStartUtc, m.scheduledStartUtc) AS inicio
    FROM calendar_events ce
    LEFT JOIN matches m ON m.providerMatchId = ce.providerMatchId
    WHERE ce.userId = ?
  `).all(userId);

  const ahora = Date.now();
  const cubiertos = [], abandonadosFuturos = [], abandonadosPasados = [], inevaluables = [];

  for (const fila of filas) {
    // INEVALUABLE: el cleanup viejo ya borró el partido de matches, así que no hay sport ni
    // competitionKey ni equipos contra qué evaluar. NO va a abandonados ni a cubiertos: un número
    // falso es peor que un hueco declarado. Mismo criterio que el "no medible" de los usuarios.
    if (fila.matchExiste === null || fila.matchExiste === undefined) {
      inevaluables.push(fila);
      continue;
    }

    if (subs.some((sub) => matchAppliesToSubscription(fila, sub))) {
      cubiertos.push(fila);
      continue;
    }

    // Solo vamos a actuar sobre los FUTUROS: borrarle a alguien su historial sería una sorpresa
    // desagradable y no aporta nada. Un partido sin fecha legible cuenta como pasado a propósito,
    // que es el lado en el que nunca se toca.
    const inicio = Date.parse(fila.inicio || "");
    if (Number.isFinite(inicio) && inicio > ahora) abandonadosFuturos.push(fila);
    else abandonadosPasados.push(fila);
  }

  return { subs, filas, cubiertos, abandonadosFuturos, abandonadosPasados, inevaluables };
}

// LA MITAD DIFÍCIL, compartida: lista el calendario de FanSchedule de la cuenta y lo cruza contra
// calendar_events en las dos direcciones. Exportada para que runBorrarHuerfanos.js reuse el
// descubrimiento en vez de duplicarlo.
//   orphans → eventos vivos en Google SIN fila (invisibles para el sistema)
//   ghosts  → filas cuyo evento YA NO está en Google (el sistema los cree agendados)
// Solo lee. El calendarId sale de fanschedule_calendar_id; nunca "primary".
async function auditAccount(account) {
  if (!account.fanschedule_calendar_id) {
    throw new Error(`${account.userId} no tiene fanschedule_calendar_id`);
  }
  const calendar = calendarClientFor(account);
  const events = await listAllEvents(calendar, account.fanschedule_calendar_id);
  const rows = rowsFor(account.userId);
  const idsInDb = new Set(rows.map((r) => r.calendarEventId));
  const idsInGoogle = new Set(events.map((e) => e.id));
  return {
    calendar,
    calendarId: account.fanschedule_calendar_id,
    events,
    rows,
    orphans: events.filter((e) => !idsInDb.has(e.id)),
    ghosts: rows.filter((r) => !idsInGoogle.has(r.calendarEventId)),
  };
}

async function run() {
  console.log("=".repeat(100));
  console.log("AUDITORÍA DE CALENDARIO — SOLO LECTURA (no escribe en la base ni en Google)");
  console.log(`Base            : ${DB_PATH}`);
  console.log(`Usuario objetivo: ${TARGET_USER}`);
  console.log(`Pausa           : ${PAUSE_MS} ms entre llamadas a Google`);
  console.log(`Hora UTC        : ${new Date().toISOString()}`);
  console.log("=".repeat(100));

  const accounts = db.prepare("SELECT * FROM google_accounts").all();
  // Convención del proyecto: se compara contra userId, no contra googleEmail.
  const target = accounts.find((a) => a.userId === TARGET_USER);

  // ── 1. Filas en calendar_events ──
  console.log("\n===== 1. Filas en calendar_events =====");
  const targetRows = rowsFor(TARGET_USER);
  console.log(`TOTAL de filas: ${targetRows.length}`);
  console.table(db.prepare(`
    SELECT COALESCE(m.competitionName, m.competitionKey, '(el partido ya no está en matches)') AS competencia,
           COUNT(*) AS filas
    FROM calendar_events ce
    LEFT JOIN matches m ON m.providerMatchId = ce.providerMatchId
    WHERE ce.userId = ?
    GROUP BY 1 ORDER BY filas DESC`).all(TARGET_USER));

  // El detalle del usuario objetivo (2, 3a, 3b) puede fallar —calendario borrado, token muerto—
  // y eso NO debe tumbar la auditoría: el punto 4, que es el panorama de todos, se reporta igual.
  // Un diagnóstico que se cae ante el primer problema es inútil justo cuando hay problemas.
  if (!target) {
    console.error(`\n⚠  No hay cuenta de Google para userId="${TARGET_USER}" — se omiten los puntos 2, 3a y 3b.`);
    console.error(`   Usuarios con cuenta: ${accounts.map((a) => a.userId).join(", ") || "(ninguno)"}`);
  } else if (!target.fanschedule_calendar_id) {
    console.error(`\n⚠  ${TARGET_USER} no tiene fanschedule_calendar_id guardado — se omiten los puntos 2, 3a y 3b.`);
    console.error(`   Este job NO crea calendarios a propósito, así que no hay contra qué comparar.`);
  } else {
    try {
      // ── 2. Eventos reales en Google ──
      console.log("\n===== 2. Eventos REALES en Google =====");
      console.log(`Calendario: ${target.fanschedule_calendar_id}`);
      const audit = await auditAccount(target);
      const events = audit.events;
      console.log(`TOTAL en Google: ${events.length}`);
      console.table(tally(events, competitionOf).map((r) => ({ competencia: r.competencia, eventos: r.n })));

      // ── 3a. Huérfanos ──
      console.log("\n===== 3a. HUÉRFANOS: vivos en Google, SIN fila en calendar_events =====");
      console.log("    (invisibles para el sistema; al re-suscribirse se crea un DUPLICADO encima)");
      const orphans = audit.orphans;
      console.log(`HUÉRFANOS: ${orphans.length} de ${events.length} eventos en Google`);
      if (orphans.length) {
        console.table(tally(orphans, competitionOf).map((r) => ({ competencia: r.competencia, huérfanos: r.n })));
        console.log(`muestra de ${Math.min(MUESTRA, orphans.length)}:`);
        console.table(orphans.slice(0, MUESTRA).map((e) => ({
          titulo: (e.summary || "").slice(0, 42),
          fecha: ((e.start && (e.start.dateTime || e.start.date)) || "").slice(0, 16),
          competencia: competitionOf(e).slice(0, 18),
          partido: matchIdOf(e),
        })));
      }

      // ── 3b. Fantasmas ──
      console.log("\n===== 3b. FANTASMAS: fila en calendar_events, evento YA NO en Google =====");
      console.log("    (el sistema cree que ya está agendado y NUNCA lo vuelve a crear)");
      // La clasificación NO puede salir del evento (ya no existe): sale del partido en matches.
      // Si el partido tampoco está, se reporta aparte en vez de contarlo como "otra competencia".
      const ghosts = audit.ghosts.map((r) => ({ row: r, match: findMatch.get(r.providerMatchId) || null }));
      console.log(`FANTASMAS: ${ghosts.length} de ${targetRows.length} filas en la base`);
      if (ghosts.length) {
        console.table(tally(ghosts, (g) => (g.match ? (g.match.competitionName || g.match.competitionKey) : "(el partido ya no está en matches)"))
          .map((r) => ({ competencia: r.competencia, fantasmas: r.n })));
        console.log(`muestra de ${Math.min(MUESTRA, ghosts.length)}:`);
        console.table(ghosts.slice(0, MUESTRA).map((g) => ({
          partido: g.row.providerMatchId,
          titulo: g.match
            ? `${g.match.homeParticipantName || ""} vs ${g.match.awayParticipantName || ""}`.slice(0, 42)
            : "(el partido ya no está en matches)",
          fecha: ((g.match && g.match.inicio) || "").slice(0, 16),
          competencia: ((g.match && g.match.competitionName) || "?").slice(0, 18),
        })));
      }
    } catch (err) {
      console.error(`\n⚠  No se pudo leer el calendario de ${TARGET_USER}: ${err.message}`);
      console.error(`   Se omiten los puntos 2, 3a y 3b. El punto 4 sigue abajo.`);
      console.error(`   (Un "Not Found" aquí suele ser un fanschedule_calendar_id que apunta a un calendario que ya no existe.)`);
    }
  }

  // ── 3c. Abandonados del usuario objetivo ──
  // FUERA del try de arriba a propósito: esto NO consulta Google, sale solo de la base. Aunque el
  // calendario del usuario sea ilegible, esta medición se puede dar igual.
  console.log("\n===== 3c. ABANDONADOS: con fila Y en Google, pero ninguna suscripción actual los cubre =====");
  console.log("    (el cleanup de la baja no los borró porque pregunta si ALGUIEN sigue la liga)");
  const clas = classifyUserEvents(TARGET_USER);
  console.log(`Suscripciones actuales de ${TARGET_USER}: ${clas.subs.length}`);
  console.log(`  cubiertos por alguna suscripción suya : ${clas.cubiertos.length}`);
  console.log(`  ABANDONADOS futuros (accionables)     : ${clas.abandonadosFuturos.length}`);
  console.log(`  abandonados pasados (NO se tocan)     : ${clas.abandonadosPasados.length}`);
  console.log(`  inevaluables (el partido ya no está en matches): ${clas.inevaluables.length}`);

  if (clas.abandonadosFuturos.length) {
    console.log("\nAbandonados FUTUROS por competencia:");
    console.table(tally(clas.abandonadosFuturos, (f) => f.competitionName || f.competitionKey || "(sin competencia)")
      .map((r) => ({ competencia: r.competencia, abandonados: r.n })));
    console.log(`muestra de ${Math.min(MUESTRA, clas.abandonadosFuturos.length)}:`);
    console.table(clas.abandonadosFuturos.slice(0, MUESTRA).map((f) => ({
      partido: f.providerMatchId,
      titulo: `${f.homeParticipantName || ""} vs ${f.awayParticipantName || ""}`.slice(0, 42),
      fecha: (f.inicio || "").slice(0, 16),
      competencia: (f.competitionName || "?").slice(0, 18),
    })));
  }
  if (clas.abandonadosPasados.length) {
    console.log("\nAbandonados PASADOS por competencia (solo informativo, no se actúa sobre ellos):");
    console.table(tally(clas.abandonadosPasados, (f) => f.competitionName || f.competitionKey || "(sin competencia)")
      .map((r) => ({ competencia: r.competencia, abandonados: r.n })));
  }

  // ── 4. Todos los usuarios ──
  // Se recorre la UNIÓN de google_accounts y de los userId que tienen filas en calendar_events:
  // alguien puede tener eventos y no tener cuenta de Google utilizable, y su cifra de abandonados
  // se puede medir igual porque no depende de la API.
  console.log("\n===== 4. Todos los usuarios: las tres categorías =====");
  console.log("    'no medible' NO significa sano: significa que no se pudo comprobar.");
  console.log("    Los abandonados SÍ se miden siempre: salen de la base, no de Google.");
  const userIds = db.prepare(`
    SELECT userId FROM google_accounts
    UNION
    SELECT DISTINCT userId FROM calendar_events
    ORDER BY userId
  `).all().map((r) => r.userId);

  const summary = [];
  for (const userId of userIds) {
    const account = accounts.find((a) => a.userId === userId) || null;
    const rows = rowsFor(userId);
    const c = classifyUserEvents(userId);
    const base = {
      usuario: userId,
      enBase: rows.length,
      abandFuturos: c.abandonadosFuturos.length,
      abandPasados: c.abandonadosPasados.length,
      inevaluables: c.inevaluables.length,
    };

    if (!account) {
      summary.push({ ...base, enGoogle: "—", huérfanos: "—", fantasmas: "—", estado: "no medible: sin cuenta de Google" });
      continue;
    }
    if (!account.fanschedule_calendar_id) {
      summary.push({ ...base, enGoogle: "—", huérfanos: "—", fantasmas: "—", estado: "no medible: sin calendario" });
      continue;
    }
    if (account.needsReauth) {
      summary.push({ ...base, enGoogle: "—", huérfanos: "—", fantasmas: "—", estado: "no medible: needsReauth" });
      continue;
    }

    await sleep(PAUSE_MS);
    try {
      const a = await auditAccount(account);
      summary.push({
        ...base,
        enGoogle: a.events.length,
        huérfanos: a.orphans.length,
        fantasmas: a.ghosts.length,
        estado: "medido",
      });
    } catch (err) {
      summary.push({ ...base, enGoogle: "—", huérfanos: "—", fantasmas: "—", estado: `no medible: ${String(err.message).slice(0, 40)}` });
    }
  }
  console.table(summary);

  const medidos = summary.filter((s) => s.estado === "medido");
  const noMedibles = summary.filter((s) => s.estado !== "medido");
  const totalHuerfanos = medidos.reduce((a, s) => a + s.huérfanos, 0);
  const totalFantasmas = medidos.reduce((a, s) => a + s.fantasmas, 0);
  // Los abandonados se suman sobre TODOS, medibles o no: no dependen de Google.
  const totalAbandFuturos = summary.reduce((a, s) => a + s.abandFuturos, 0);
  const totalAbandPasados = summary.reduce((a, s) => a + s.abandPasados, 0);
  const totalInevaluables = summary.reduce((a, s) => a + s.inevaluables, 0);

  console.log("\n" + "=".repeat(100));
  console.log("RESUMEN");
  console.log("=".repeat(100));
  console.log(`Usuarios                        : ${summary.length} (${medidos.length} medibles contra Google)`);
  console.log(`Huérfanos (total)               : ${totalHuerfanos}   ← solo de los medibles`);
  console.log(`Fantasmas (total)               : ${totalFantasmas}   ← solo de los medibles`);
  console.log(`ABANDONADOS futuros (total)     : ${totalAbandFuturos}   ← de TODOS, no depende de Google`);
  console.log(`Abandonados pasados (total)     : ${totalAbandPasados}   ← informativo, no se actúa`);
  console.log(`Inevaluables (sin fila en matches): ${totalInevaluables}`);
  if (noMedibles.length) {
    console.log(`\n⚠  ${noMedibles.length} usuario(s) NO se pudieron medir contra Google — huérfanos y fantasmas los EXCLUYEN:`);
    for (const s of noMedibles) console.log(`   - ${s.usuario}: ${s.estado}`);
  }
  if (totalInevaluables > 0) {
    console.log(`\n⚠  ${totalInevaluables} fila(s) sin partido en la tabla matches: no se pueden clasificar como`);
    console.log(`   abandonadas ni como cubiertas. Es rastro del cleanup viejo, que borraba de matches.`);
  }
  console.log("\nFIN. Nada fue modificado.");
}

// Solo audita cuando se invoca como script. Al importarlo (lo hace runBorrarHuerfanos.js para
// reusar auditAccount) NO debe correr nada.
if (require.main === module) {
  run().catch((err) => {
    console.error("AUDITORÍA FALLÓ:", err.message);
    process.exit(1);
  });
}

module.exports = {
  db,
  auditAccount,
  classifyUserEvents,
  hasCalendarEventRow,
  calendarClientFor,
  listAllEvents,
  competitionOf,
  matchIdOf,
  rowsFor,
  tally,
};

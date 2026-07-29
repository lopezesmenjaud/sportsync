// src/jobs/runBackfillEventReminders.js
//
// Pone el recordatorio (popup DEFAULT_REMINDER_MINUTES) a los eventos FUTUROS que YA existen en el
// calendario FanSchedule de los usuarios y hoy NO tienen aviso. Continuación del commit 8a60b2d
// (que hace que los eventos NUEVOS nazcan con recordatorio).
//
// CÓMO: events.patch enviando ÚNICAMENTE el campo `reminders` (vía
// googleCalendarProvider.patchEventReminders). Al ser un patch, summary/start/end/description/
// location NO viajan en la petición, así que es IMPOSIBLE que cambien. Por eso NO se usa
// updateEvent ni buildEventFromMatch (que reconstruyen el evento desde el match y arrastrarían
// cambios de título, como comprobamos en el dry-run de la fase 2B).
//
// A QUIÉN LE FALTA: una llamada events.list por usuario (paginada, timeMin=ahora) pidiendo el campo
// `reminders`. Un evento NECESITA parche si no tiene un override EFECTIVO: useDefault:true, o
// overrides vacío/ausente. El calendario secundario nace SIN defaultReminders, así que
// useDefault:true significa "sin aviso".
//
// RESPETO AL USUARIO: si un evento ya trae un override PROPIO (aunque sea con minutos distintos a
// los nuestros) NO se toca; se cuenta y reporta aparte. Igual criterio que los eventos borrados a
// mano en la fase 2B: si la persona lo puso a propósito, no lo pisamos.
//
// ALCANCE: solo eventos FUTUROS (timeMin=ahora). Los pasados no se tocan.
//
// SEGURIDAD (barandillas copiadas de runRelabelUserSideEvents.js, fase 2B):
//   - DRY-RUN por defecto. Sin CONFIRM=1 no escribe NADA.
//   - TARGET_USER restringe la corrida a un usuario; un CONFIRM a TODOS exige ALL_USERS=1.
//   - MAX=N presupuesto GLOBAL de parches (para probar con pocos).
//   - Pausa entre escrituras + reintento en rateLimitExceeded (reusa isRateLimit del backfill).
//   - shouldSkipUser (reusado) salta a quien no tenga scope de Calendar / needsReauth.
//   - Si un usuario truena a media pasada, se reporta y se sigue con el siguiente.
//   - IDEMPOTENTE: re-correrlo no reescribe nada (los ya parchados salen como "ya tenían el nuestro").
//
// Secuencia segura:
//   1) Dry-run de todos:  node src/jobs/runBackfillEventReminders.js
//   2) 5 a un usuario:     CONFIRM=1 TARGET_USER=<email> MAX=5 node src/jobs/runBackfillEventReminders.js
//   3) Todo ese usuario:   CONFIRM=1 TARGET_USER=<email> node src/jobs/runBackfillEventReminders.js
//   4) El resto:           CONFIRM=1 ALL_USERS=1 node src/jobs/runBackfillEventReminders.js
//   (En Render prod añade NODE_ENV=production)

require("dotenv").config();

const { db } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const googleCalendarProvider = require("../services/googleCalendarProvider");
const { DEFAULT_REMINDER_MINUTES } = require("../services/googleCalendarProvider"); // fuente única
const { isInvalidGrant } = require("../services/calendarSyncService");
const { shouldSkipUser } = require("../services/scheduler");        // reusado, no duplicado
const { isRateLimit } = require("../services/userBackfillService"); // reusado, no duplicado

const CONFIRM = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const ALL_USERS = process.env.ALL_USERS === "1" || process.env.ALL_USERS === "true";
const TARGET_USER = process.env.TARGET_USER || null; // userId o googleEmail (NO se llama USER: $USER es del shell)
const MAX = process.env.MAX ? parseInt(process.env.MAX, 10) : Infinity;
const PAUSE_MS = 250; // pausa entre escrituras para no golpear el rate limit de Google

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Clasifica el estado de `reminders` de un evento de events.list:
//   "needs"  -> sin override efectivo (useDefault:true, o overrides vacío/ausente) => hay que parchar
//   "ours"   -> exactamente NUESTRO override (popup, DEFAULT_REMINDER_MINUTES) => idempotente, saltar
//   "custom" -> tiene override(s) propios distintos => respetar, saltar
function classifyReminders(ev) {
  const r = ev.reminders || {};
  const overrides = Array.isArray(r.overrides) ? r.overrides : [];
  const hasEffectiveOverride = r.useDefault === false && overrides.length > 0;
  if (!hasEffectiveOverride) return "needs";
  const isOurs = overrides.length === 1 &&
                 overrides[0].method === "popup" &&
                 overrides[0].minutes === DEFAULT_REMINDER_MINUTES;
  return isOurs ? "ours" : "custom";
}

// Eventos FUTUROS del usuario en su calendario FanSchedule, pidiendo solo id/summary/reminders.
// UNA (o pocas) llamada events.list por usuario, paginada.
async function listFutureEvents(userId, calendarId, nowIso) {
  const calendar = await googleCalendarProvider.getCalendarClientForUser(userId);
  const items = [];
  let pageToken;
  do {
    const resp = await calendar.events.list({
      calendarId,
      timeMin: nowIso,
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      fields: "nextPageToken,items(id,summary,reminders)",
      pageToken,
    });
    for (const ev of (resp.data.items || [])) items.push(ev);
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return items;
}

// Ejecuta fn; si Google responde rateLimitExceeded, espera 2s y reintenta UNA vez (reusa isRateLimit).
async function withRateLimitRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isRateLimit(e)) {
      console.log("  [ratelimit] esperando 2s y reintentando…");
      await sleep(2000);
      return await fn();
    }
    throw e;
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  let accounts = await googleAccountRepository.getAll();

  if (TARGET_USER) {
    accounts = accounts.filter((a) => a.userId === TARGET_USER || a.googleEmail === TARGET_USER);
    if (accounts.length === 0) {
      console.log(`[reminders] No se encontró cuenta para TARGET_USER=${TARGET_USER}. Nada que hacer.`);
      return;
    }
  }

  // La PRIMERA escritura al calendario de un tercero no puede pasar por accidente: un CONFIRM sin
  // TARGET_USER escribiría en TODOS. Exigir ALL_USERS=1 explícito. (El dry-run de todos es lectura.)
  if (CONFIRM && !TARGET_USER && !ALL_USERS) {
    console.log("[reminders] CONFIRM sin TARGET_USER escribiría en el calendario de TODOS los usuarios.");
    console.log("[reminders] Si es intencional, repite con ALL_USERS=1. Para un solo usuario: TARGET_USER=<email|userId>.");
    return;
  }

  const scope = TARGET_USER ? `TARGET_USER=${TARGET_USER}` : (CONFIRM ? "TODOS (ALL_USERS=1)" : "TODOS");
  console.log(`[reminders] modo: ${CONFIRM ? "APLICAR (CONFIRM=1)" : "DRY-RUN (no escribe nada)"}  MAX=${MAX === Infinity ? "(sin límite)" : MAX}  recordatorio: popup ${DEFAULT_REMINDER_MINUTES}min  alcance: ${scope}`);
  if (CONFIRM) {
    console.log(`[reminders] se ESCRIBIRÁ en el calendario de: ${accounts.map((a) => a.googleEmail).join(", ")}`);
  }

  let budget = MAX; // presupuesto GLOBAL de parches (writes en CONFIRM / previstos en dry-run)
  const processedUsers = []; // emails de usuarios sobre los que SÍ se corrió (no saltados sin permiso)
  const totals = { users: 0, future: 0, needs: 0, patched: 0, ours: 0, custom: 0, pendingMax: 0, noPermission: 0, errors: 0 };

  for (const acc of accounts) {
    const userId = acc.userId;

    const skipReason = shouldSkipUser(acc, new Set());
    if (skipReason) {
      totals.noPermission++;
      console.log(`\n[usuario ${userId}] (${acc.googleEmail}) SALTADO sin permiso: ${skipReason}`);
      continue;
    }
    totals.users++;
    processedUsers.push(acc.googleEmail || acc.userId);

    try {
      const calendarId = acc.fanschedule_calendar_id;
      if (!calendarId) {
        console.log(`\n[usuario ${userId}] (${acc.googleEmail}) sin calendario FanSchedule → 0 eventos`);
        continue;
      }

      const events = await listFutureEvents(userId, calendarId, nowIso);

      let uPatched = 0, uOurs = 0, uCustom = 0, uNeeds = 0, uPending = 0, uErrors = 0;
      const samples = [];

      for (const ev of events) {
        const cls = classifyReminders(ev);
        if (cls === "ours")   { uOurs++;   totals.ours++;   continue; }
        if (cls === "custom") { uCustom++; totals.custom++; continue; }

        // cls === "needs": sin aviso efectivo → hay que parchar.
        uNeeds++; totals.needs++;
        if (budget <= 0) { uPending++; totals.pendingMax++; continue; }

        if (samples.length < 5) samples.push(ev.summary || "(sin título)");

        if (CONFIRM) {
          try {
            await withRateLimitRetry(() =>
              googleCalendarProvider.patchEventReminders({ userId, calendarId, calendarEventId: ev.id })
            );
            uPatched++; totals.patched++; budget--;
            await sleep(PAUSE_MS);
          } catch (e) {
            uErrors++; totals.errors++;
            if (isInvalidGrant(e)) {
              console.error(`  [invalid_grant] token inválido para ${userId}: se aborta este usuario y se sigue con el siguiente.`);
              break;
            }
            console.error(`  [error] evento ${ev.id}: ${e.message}`);
          }
        } else {
          uPatched++; totals.patched++; budget--; // dry-run: "se parcharía"
        }
      }

      totals.future += events.length;
      console.log(`\n[usuario ${userId}] (${acc.googleEmail})`);
      console.log(`  eventos futuros: ${events.length}`);
      console.log(`  necesitan recordatorio: ${uNeeds}`);
      console.log(`  ${CONFIRM ? "parchados" : "se parcharían"}: ${uPatched}`);
      console.log(`  ya tenían el nuestro (saltados): ${uOurs}`);
      console.log(`  tenían uno propio (respetado): ${uCustom}`);
      if (uPending) console.log(`  pendientes por MAX: ${uPending}`);
      if (uErrors) console.log(`  errores: ${uErrors}`);
      if (samples.length) {
        console.log(`  muestra a parchar (sin aviso → popup ${DEFAULT_REMINDER_MINUTES}min):`);
        for (const s of samples) console.log(`    "${s}"`);
      }
    } catch (e) {
      totals.errors++;
      console.error(`\n[usuario ${userId}] (${acc.googleEmail}) FALLÓ (se continúa con el siguiente): ${e.message}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`[reminders] RESUMEN (${CONFIRM ? "APLICADO" : "DRY-RUN — nada escrito"})`);
  console.log(`  corrió sobre: ${processedUsers.length ? processedUsers.join(", ") : "(ningún usuario)"}`);
  console.log(`  usuarios con permiso: ${totals.users}   saltados sin permiso: ${totals.noPermission}`);
  console.log(`  eventos futuros totales: ${totals.future}`);
  console.log(`  necesitan recordatorio: ${totals.needs}`);
  console.log(`  ${CONFIRM ? "parchados" : "se parcharían"}: ${totals.patched}`);
  console.log(`  ya tenían el nuestro: ${totals.ours}`);
  console.log(`  tenían uno propio (respetado): ${totals.custom}`);
  if (totals.pendingMax) console.log(`  pendientes por MAX: ${totals.pendingMax}`);
  console.log(`  errores: ${totals.errors}`);
  console.log("=".repeat(64));
}

main()
  .then(() => { db.close(); process.exit(0); })
  .catch((err) => { console.error("[reminders] FALLÓ:", err.message); db.close(); process.exit(1); });

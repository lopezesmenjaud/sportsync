// src/jobs/runRelabelUserSideEvents.js
//
// FASE 2B — Etiqueta con el prefijo Local/Visitante los eventos FUTUROS que YA EXISTEN en el
// Google Calendar de los usuarios. Continuación del commit 5e533c5 (fase 2A, que ya prefija los
// eventos NUEVOS vía buildEventFromMatch). El título nuevo se construye llamando a updateEvent,
// que reconstruye el evento COMPLETO desde el match y aplica el prefijo (fase 2A). NUNCA se lee
// el título de Google para manipularlo como texto: se rearma desde el match, así el emoji ✈️/🏠
// sale siempre con nuestra codificación y no hay riesgo de duplicar el prefijo.
//
// ALCANCE:
//   - SOLO eventos FUTUROS (match.start >= ahora). Los partidos ya jugados NO se tocan.
//   - Todos los usuarios con scope de Calendar. Los que no lo tengan o tengan needsReauth se
//     saltan limpio y se reportan (reusa shouldSkipUser de scheduler.js, sin duplicar).
//
// SEGURIDAD:
//   - DRY-RUN por defecto. Sin CONFIRM=1 no escribe NADA, ni en Google ni en la DB.
//   - TARGET_USER restringe la corrida a un usuario; un CONFIRM a TODOS exige ALL_USERS=1, para
//     que la primera escritura al calendario de un tercero no pueda pasar por accidente.
//   - MAX=N limita cuántos eventos se relabelan en TODA la corrida (para probar con pocos).
//   - Pausa entre escrituras + reintento en rateLimitExceeded (reusa isRateLimit del backfill).
//   - Si un usuario truena a media pasada, se reporta y se sigue con el siguiente.
//   - Eventos que están en la DB pero ya no en Google (borrados a mano) se SALTAN, no se recrean.
//
// Variables:
//   CONFIRM=1        aplica los cambios (sin ella, dry-run: no escribe nada)
//   TARGET_USER=...  restringe TODA la corrida a un userId o googleEmail (dry-run y CONFIRM).
//                    Se llama TARGET_USER y NO USER a propósito: $USER es una variable estándar
//                    del shell (en Render viene seteada) y filtraría cada corrida en silencio.
//   MAX=N            límite GLOBAL de eventos a reetiquetar (para probar con pocos)
//   ALL_USERS=1      requerido para un CONFIRM sin TARGET_USER (escribir a TODOS)
//
// Secuencia segura:
//   1) Dry-run de todos (solo lectura):  node src/jobs/runRelabelUserSideEvents.js
//   2) Aplicar 5 a un usuario:           CONFIRM=1 TARGET_USER=<email> MAX=5 node src/jobs/runRelabelUserSideEvents.js
//   3) Aplicar todo a ese usuario:       CONFIRM=1 TARGET_USER=<email> node src/jobs/runRelabelUserSideEvents.js
//   4) El resto (escribe a TODOS):       CONFIRM=1 ALL_USERS=1 node src/jobs/runRelabelUserSideEvents.js
//   (En Render prod añade NODE_ENV=production)

require("dotenv").config();

const { db } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const googleCalendarProvider = require("../services/googleCalendarProvider");
const { getUserSide } = require("../services/subscriptionMatchService");
const { isInvalidGrant } = require("../services/calendarSyncService");
const { shouldSkipUser } = require("../services/scheduler");   // reusado, no duplicado
const { isRateLimit } = require("../services/userBackfillService"); // reusado, no duplicado
const { BLOCKED_SPORTS, BLOCKED_COMPETITIONS } = require("../services/roundLabelService"); // fuente única, no duplicado

const CONFIRM = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";
const ALL_USERS = process.env.ALL_USERS === "1" || process.env.ALL_USERS === "true";
// TARGET_USER acepta userId o googleEmail. Ver nota en la cabecera sobre por qué NO se llama USER.
const TARGET_USER = process.env.TARGET_USER || null;
const MAX = process.env.MAX ? parseInt(process.env.MAX, 10) : Infinity;
const PAUSE_MS = 250; // pausa entre escrituras para no golpear el rate limit de Google

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Normalización SOLO para comparar (no para construir el título que se escribe): NFC + quita
// los selectores de variación del emoji (U+FE0E/U+FE0F), que algunos clientes de calendario
// añaden o quitan. Así "ya correcto" no se marca como cambio por una diferencia de encoding.
const normForCompare = (s) => (s || "").normalize("NFC").replace(/[\uFE0E\uFE0F]/g, "");

// El titulo ya empieza con un prefijo conocido de Local/Visitante? Comparacion por startsWith
// (no se manipula el texto para reconstruirlo). Reusa la constante de googleCalendarProvider.
const hasKnownPrefix = (title) => googleCalendarProvider.USER_SIDE_PREFIXES.some((p) => (title || "").startsWith(p));

// ¿Existe ya una fila en round_labels para (competitionKey, intRound)? (lectura pura)
function roundLabelRowExists(competitionKey, intRound) {
  return new Promise((resolve) => {
    db.get(
      "SELECT 1 AS x FROM round_labels WHERE competitionKey = ? AND intRound = ?",
      [competitionKey, String(intRound)],
      (err, row) => resolve(!err && !!row)
    );
  });
}

// Título que quedaría (lo mismo que escribirá updateEvent) = buildEventFromMatch(match, userSide).
// En dry-run garantizamos lectura pura: buildEventFromMatch->getRoundLabel SOLO escribe round_labels
// para un (competitionKey,intRound) nunca visto y de deporte NO bloqueado. Si el round no está
// resuelto todavía, devolvemos null en dry-run (no arriesgamos una escritura) y ese evento se cuenta
// como "cambio" con el título por resolver. En CONFIRM (allowWrite) sí se construye siempre.
async function computeDesiredSummary(match, userSide, allowWrite) {
  if (!allowWrite) {
    const ck = match.competitionKey;
    const ir = match.intRound;
    const readOnly = !ck || !ir || BLOCKED_SPORTS.has(match.sport) || BLOCKED_COMPETITIONS.has(String(ck)) || await roundLabelRowExists(ck, ir);
    if (!readOnly) return null;
  }
  const body = await googleCalendarProvider.buildEventFromMatch(match, userSide);
  return body.summary;
}

// Títulos ACTUALES de los eventos futuros del usuario en su calendario FanSchedule.
// UNA (o pocas) llamada events.list por usuario — NO un GET por evento.
async function listFutureEventSummaries(userId, calendarId, nowIso) {
  const calendar = await googleCalendarProvider.getCalendarClientForUser(userId);
  const map = new Map(); // calendarEventId -> summary actual
  let pageToken;
  do {
    const resp = await calendar.events.list({
      calendarId,
      timeMin: nowIso,
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      pageToken,
    });
    for (const ev of (resp.data.items || [])) map.set(ev.id, ev.summary || "");
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return map;
}

// Ejecuta fn; si Google responde rateLimitExceeded, espera 2s y reintenta UNA vez (igual criterio
// que el backfill). El isRateLimit se reusa de userBackfillService.
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

  // Filtro por usuario (dry-run y CONFIRM). TARGET_USER matchea userId o googleEmail.
  if (TARGET_USER) {
    accounts = accounts.filter((a) => a.userId === TARGET_USER || a.googleEmail === TARGET_USER);
    if (accounts.length === 0) {
      console.log(`[relabel] No se encontró cuenta para TARGET_USER=${TARGET_USER}. Nada que hacer.`);
      return;
    }
  }

  // La PRIMERA escritura al calendario de un tercero no puede pasar por accidente: un CONFIRM sin
  // TARGET_USER escribiría en TODOS. Exigir ALL_USERS=1 explícito. (El dry-run de todos NO lo
  // requiere: es solo lectura.)
  if (CONFIRM && !TARGET_USER && !ALL_USERS) {
    console.log("[relabel] CONFIRM sin TARGET_USER escribiría en el calendario de TODOS los usuarios.");
    console.log("[relabel] Si es intencional, repite con ALL_USERS=1. Para un solo usuario: TARGET_USER=<email|userId>.");
    return;
  }

  const scope = TARGET_USER ? `TARGET_USER=${TARGET_USER}` : (CONFIRM ? "TODOS (ALL_USERS=1)" : "TODOS");
  console.log(`[relabel] modo: ${CONFIRM ? "APLICAR (CONFIRM=1)" : "DRY-RUN (no escribe nada)"}  MAX=${MAX === Infinity ? "(sin límite)" : MAX}  alcance: ${scope}`);
  if (CONFIRM) {
    console.log(`[relabel] se ESCRIBIRÁ en el calendario de: ${accounts.map((a) => a.googleEmail).join(", ")}`);
  }

  const allMatches = await matchRepository.getAll();
  const matchById = new Map(allMatches.map((m) => [m.providerMatchId, m]));

  let budget = MAX; // presupuesto GLOBAL de relabels (writes en CONFIRM / previstos en dry-run)
  const processedUsers = []; // emails de usuarios sobre los que SÍ se corrió (no saltados sin permiso)
  const totals = { users: 0, future: 0, correct: 0, changed: 0, outOfScope: 0, pendingMax: 0, noPermission: 0, missingInGoogle: 0, errors: 0 };

  for (const acc of accounts) {
    const userId = acc.userId;

    // Set vacío: no venimos de una corrida de sync, no hay usuarios ya marcados en memoria.
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

      // Suscripciones UNA sola vez por usuario (no por evento).
      const subs = await subscriptionRepository.getByUserId(userId);

      // Eventos FUTUROS del usuario: filas de calendar_events cuyo match empieza en el futuro.
      const rows = await calendarEventRepository.getByUserId(userId);
      const futureRows = rows.filter((r) => {
        const m = matchById.get(r.providerMatchId);
        if (!m) return false;
        const start = m.currentStartUtc || m.scheduledStartUtc || "";
        return start && start >= nowIso;
      });

      // Títulos actuales (una llamada events.list, paginada).
      const currentTitles = await listFutureEventSummaries(userId, calendarId, nowIso);

      let uCorrect = 0, uChanged = 0, uOutOfScope = 0, uPending = 0, uMissing = 0, uErrors = 0;
      const samples = [];

      for (const r of futureRows) {
        const m = matchById.get(r.providerMatchId);
        const userSide = getUserSide(m, subs);
        const current = currentTitles.get(r.calendarEventId); // undefined si no está en Google

        // Está en nuestra DB pero ya NO en Google: el usuario lo borró a mano. NO se recrea (el
        // job solo REETIQUETA lo que existe). Se cuenta aparte y se reporta, pero no se toca.
        if (current === undefined) { uMissing++; totals.missingInGoogle++; continue; }

        // ACOTAMIENTO al nombre del job: SOLO reetiquetar Local/Visitante. Se toca el evento solo
        // si el prefijo es relevante: (a) el usuario sigue a uno de los dos equipos (userSide !=
        // null), o (b) el titulo ya trae un prefijo conocido (para poder quitarlo si dejo de
        // seguirlo). Si no, se salta -> asi NO arrastramos backfill de otras funciones (etiquetas
        // de fase, etc.), que es una decision aparte que no se ha tomado.
        if (userSide === null && !hasKnownPrefix(current)) { uOutOfScope++; totals.outOfScope++; continue; }

        const desired = await computeDesiredSummary(m, userSide, CONFIRM);
        const needsChange = desired === null ? true : normForCompare(desired) !== normForCompare(current);
        if (!needsChange) { uCorrect++; totals.correct++; continue; }

        // Necesita cambio. Respetar el presupuesto MAX global.
        if (budget <= 0) { uPending++; totals.pendingMax++; continue; }

        if (samples.length < 5) {
          samples.push({ antes: current, despues: desired === null ? "(se resuelve al aplicar)" : desired });
        }

        if (CONFIRM) {
          try {
            const updated = await withRateLimitRetry(() =>
              googleCalendarProvider.updateEvent({ userId, calendarId, calendarEventId: r.calendarEventId, match: m, userSide })
            );
            // Si updateEvent cayó al fallback de insert (evento gone), el id cambió → persistir.
            if (updated.calendarEventId !== r.calendarEventId) {
              await calendarEventRepository.updateCalendarEventId(r.id, updated.calendarEventId);
            }
            uChanged++; totals.changed++; budget--;
            await sleep(PAUSE_MS);
          } catch (e) {
            uErrors++; totals.errors++;
            if (isInvalidGrant(e)) {
              console.error(`  [invalid_grant] token inválido para ${userId}: se aborta este usuario y se sigue con el siguiente.`);
              break;
            }
            console.error(`  [error] evento ${r.calendarEventId} (match ${r.providerMatchId}): ${e.message}`);
          }
        } else {
          uChanged++; totals.changed++; budget--; // dry-run: "se actualizaría"
        }
      }

      totals.future += futureRows.length;
      console.log(`\n[usuario ${userId}] (${acc.googleEmail})`);
      console.log(`  eventos futuros: ${futureRows.length}`);
      console.log(`  ${CONFIRM ? "actualizados" : "se actualizarían"}: ${uChanged}`);
      console.log(`  ya correctos (saltados): ${uCorrect}`);
      if (uOutOfScope) console.log(`  sin cambio de Local/Visitante (saltados): ${uOutOfScope}`);
      if (uPending) console.log(`  pendientes por MAX: ${uPending}`);
      if (uMissing) console.log(`  en DB pero ya no en Google (saltados, no recreados): ${uMissing}`);
      if (uErrors) console.log(`  errores: ${uErrors}`);
      if (samples.length) {
        console.log(`  muestra (ANTES → DESPUÉS):`);
        for (const s of samples) console.log(`    "${s.antes}"  →  "${s.despues}"`);
      }
    } catch (e) {
      totals.errors++;
      console.error(`\n[usuario ${userId}] (${acc.googleEmail}) FALLÓ (se continúa con el siguiente): ${e.message}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`[relabel] RESUMEN (${CONFIRM ? "APLICADO" : "DRY-RUN — nada escrito"})`);
  console.log(`  corrió sobre: ${processedUsers.length ? processedUsers.join(", ") : "(ningún usuario)"}`);
  console.log(`  usuarios con permiso: ${totals.users}   saltados sin permiso: ${totals.noPermission}`);
  console.log(`  eventos futuros totales: ${totals.future}`);
  console.log(`  ${CONFIRM ? "actualizados" : "se actualizarían"}: ${totals.changed}`);
  console.log(`  ya correctos: ${totals.correct}`);
  if (totals.outOfScope) console.log(`  sin cambio de Local/Visitante (saltados): ${totals.outOfScope}`);
  if (totals.pendingMax) console.log(`  pendientes por MAX: ${totals.pendingMax}`);
  if (totals.missingInGoogle) console.log(`  en DB pero ya no en Google (saltados, no recreados): ${totals.missingInGoogle}`);
  console.log(`  errores: ${totals.errors}`);
  console.log("=".repeat(64));
}

main()
  .then(() => { db.close(); process.exit(0); })
  .catch((err) => { console.error("[relabel] FALLÓ:", err.message); db.close(); process.exit(1); });

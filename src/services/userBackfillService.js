// src/services/userBackfillService.js
//
// Lógica per-usuario compartida de backfill de eventos de Calendar: crea los eventos
// que le FALTAN a un usuario (partidos relevantes EN VENTANA sin fila en calendar_events),
// reusando la sección crítica atómica bajo el mutex compartido (createCalendarEventIfMissing).
// La usan el script manual (runBackfillUserEvents.js) y el scheduler → una sola fuente de verdad.
// SALTA los existentes (no los actualiza).

const { getMatchesForUser, getUserSide } = require("./subscriptionMatchService");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const googleCalendarProvider = require("./googleCalendarProvider");
const { getSyncDateRange } = require("./syncService");
const { createCalendarEventIfMissing, isInvalidGrant } = require("./calendarSyncService");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isRateLimit(err) {
  const status = err?.code || err?.response?.status;
  const reason = String(err?.response?.data?.error?.errors?.[0]?.reason || "").toLowerCase();
  return status === 429 || reason.includes("ratelimit") || reason.includes("userratelimit") || reason.includes("quota");
}

// SOLO LECTURA: calcula los faltantes EN VENTANA para un usuario (sin Google, sin escribir).
// Misma ventana que el flujo normal (syncLeague): [fromDate, toDate] = hoy .. hoy+30d, comparando
// la FECHA (YYYY-MM-DD) de currentStartUtc (canónico; fallback scheduledStartUtc).
async function getMissingEventsForUser(userId) {
  // Subs UNA sola vez por usuario: se reusan para filtrar los partidos relevantes Y para
  // calcular el userSide en backfillUserEvents (se devuelven abajo). No se leen dos veces.
  const subscriptions = await subscriptionRepository.getByUserId(userId);
  const relevant = await getMatchesForUser(userId, subscriptions);
  const existing = await calendarEventRepository.getByUserId(userId);
  const existingIds = new Set(existing.map((ce) => ce.providerMatchId));
  const missingAll = relevant.filter((m) => !existingIds.has(m.providerMatchId));

  const { fromDate, toDate } = getSyncDateRange();
  const matchDate = (m) => (m.currentStartUtc || m.scheduledStartUtc || "").slice(0, 10);
  const missing = missingAll.filter((m) => { const d = matchDate(m); return d && d >= fromDate && d <= toDate; });
  const discardedPast   = missingAll.filter((m) => { const d = matchDate(m); return d && d < fromDate; }).length;
  const discardedFuture = missingAll.filter((m) => { const d = matchDate(m); return d && d > toDate;  }).length;
  const discardedNoDate = missingAll.filter((m) => !matchDate(m)).length;

  return { subscriptions, relevant, existing, missingAll, missing, fromDate, toDate, discardedPast, discardedFuture, discardedNoDate };
}

// Crea los faltantes EN VENTANA para un usuario. SALTA existentes (no actualiza).
// Reusa createCalendarEventIfMissing (mutex compartido con syncMatchToCalendars). El retry por
// rate-limit se hace FUERA del mutex (re-llama la op atómica tras un sleep).
// opts: { max = Infinity, delayMs = 0, onLog = (kind, match, err) => {} }
//   onLog kinds: "created" | "skipped" | "error" | "ratelimit" | "abort"
// Devuelve { created, skipped, errors, attempted, missingTotal }.
async function backfillUserEvents(userId, opts = {}) {
  const { max = Infinity, delayMs = 0, onLog = () => {} } = opts;
  const { missing, subscriptions } = await getMissingEventsForUser(userId);
  const toProcess = missing.slice(0, max);

  // Sin faltantes: no crear calendario ni tocar Google (evita calendarios vacíos
  // huérfanos, clave cuando el scheduler recorre TODOS los usuarios).
  if (toProcess.length === 0) {
    return { created: 0, skipped: 0, errors: 0, attempted: 0, missingTotal: 0 };
  }

  // Resolver el calendario UNA sola vez por usuario (NO por partido). Si falla (p.ej.
  // scope insuficiente / invalid_grant), no hay nada que crear → reportar una vez y salir
  // sin reventar al caller (no spamear ni cortar el loop del scheduler).
  let calendarId;
  try {
    calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId });
  } catch (e) {
    onLog("error", null, e);
    return { created: 0, skipped: 0, errors: 1, attempted: 0, missingTotal: missing.length };
  }

  let created = 0, skipped = 0, errors = 0;
  for (const m of toProcess) {
    try {
      // Perspectiva Local/Visitante de este usuario para este partido (subs ya cargadas arriba).
      const userSide = getUserSide(m, subscriptions);
      let res;
      try {
        res = await createCalendarEventIfMissing({ userId, calendarId, match: m, userSide });
      } catch (e) {
        if (isRateLimit(e)) {
          onLog("ratelimit", m, e);
          await sleep(2000); // espera FUERA del mutex
          res = await createCalendarEventIfMissing({ userId, calendarId, match: m, userSide });
        } else { throw e; }
      }

      if (res.kind === "created") { created++; onLog("created", m); }
      else { skipped++; onLog("skipped", m); }
    } catch (e) {
      errors++;
      onLog("error", m, e);
      if (isInvalidGrant(e)) { onLog("abort", m, e); break; }
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return { created, skipped, errors, attempted: toProcess.length, missingTotal: missing.length };
}

module.exports = { getMissingEventsForUser, backfillUserEvents, isRateLimit };

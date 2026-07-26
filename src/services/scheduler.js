const cron = require("node-cron");
const { syncMatches, syncSport } = require("./syncService");
const { syncMatchToCalendars } = require("./calendarSyncService");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { backfillUserEvents } = require("./userBackfillService");

// ─────────────────────────────────────────────
// Intervalos de sincronización por deporte
//
// Tenis:                     cada 1 hora
// Baseball:                  cada 6 horas
// Fútbol, Basketball, NFL:   cada 12 horas
// F1, Combate, Rugby,
// Hockey, Voleibol:          cada 24 horas
// ─────────────────────────────────────────────

const SPORT_SCHEDULES = [
  {
    name:    "Tenis",
    sports:  ["tennis"],
    cron:    "0 * * * *",        // cada hora en punto
    label:   "cada 1 hora"
  },
  {
    name:    "Baseball",
    sports:  ["baseball"],
    cron:    "0 */6 * * *",      // cada 6 horas
    label:   "cada 6 horas"
  },
  {
    name:    "Fútbol, Basketball, Americano",
    sports:  ["football", "basketball", "american football"],
    cron:    "0 */12 * * *",     // cada 12 horas
    label:   "cada 12 horas"
  },
  {
    name:    "F1, Combate, Rugby, Hockey, Voleibol, Golf, Ciclismo",
    sports:  ["motorsport", "fighting", "rugby", "ice hockey", "volleyball", "golf", "cycling"],
    cron:    "0 0 * * *",        // una vez al día a medianoche
    label:   "cada 24 horas"
  }
];

// Scope requerido para crear/gestionar el calendario del usuario.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Salta usuarios que no pueden recibir eventos (evita fallos y spam de logs cada ciclo).
function shouldSkipUser(acc, skipUserIds) {
  if (skipUserIds.has(acc.userId)) return "needsReauth (marcado en esta corrida)";
  if (acc.needsReauth === 1) return "needsReauth";
  if (!(acc.scope || "").includes(CALENDAR_SCOPE)) return "sin scope de Calendar";
  return null;
}

// Backfill PER-USUARIO: por cada usuario, crea los eventos que le FALTAN (en ventana),
// reusando backfillUserEvents (mismo mutex compartido + skip existentes). Ya NO deduplica
// por providerMatchId GLOBAL — esa era la raíz del bug "orden de llegada" (un match que
// otro usuario ya tenía se saltaba para TODOS).
async function backfillMissingCalendarEvents(skipUserIds = new Set()) {
  const accounts = await googleAccountRepository.getAll();

  let totalCreated = 0;
  const skipped = [];
  for (const acc of accounts) {
    const reason = shouldSkipUser(acc, skipUserIds);
    if (reason) { skipped.push(`${acc.googleEmail} (${reason})`); continue; }
    try {
      const r = await backfillUserEvents(acc.userId); // sin onLog → silencioso (sin logs por partido)
      totalCreated += r.created;
    } catch (e) {
      console.error(`[scheduler] Backfill error para ${acc.googleEmail}: ${e.message}`);
    }
  }

  if (totalCreated > 0) console.log(`[scheduler] Backfill per-usuario: +${totalCreated} eventos creados`);
  if (skipped.length > 0) console.log(`[scheduler] Backfill: ${skipped.length} usuarios saltados: ${skipped.join(", ")}`);
  return totalCreated;
}

function startScheduler() {
  console.log("[scheduler] Starting automatic sync scheduler...");

  // Job de sincronización completa al arrancar el servidor
  setTimeout(async () => {
    console.log("[scheduler] Running initial sync on startup...");
    try {
      const skipUserIds = new Set();
      const results = await syncMatches();
      for (const result of results) {
        try {
          await syncMatchToCalendars(result.newMatch, skipUserIds);
        } catch (e) {
          console.error(`[scheduler] Calendar sync error for ${result.matchId}:`, e.message);
        }
      }
      await backfillMissingCalendarEvents(skipUserIds);
    } catch (e) {
      console.error("[scheduler] Initial sync error:", e.message);
    }
  }, 5000); // espera 5 segundos para que el servidor esté listo

  // Jobs por deporte según su intervalo
  for (const schedule of SPORT_SCHEDULES) {
    cron.schedule(schedule.cron, async () => {
      console.log(`[scheduler] Running sync for: ${schedule.name} (${schedule.label})`);
      const skipUserIds = new Set();
      for (const sport of schedule.sports) {
        try {
          const results = await syncSport(sport);
          for (const result of results) {
            try {
              await syncMatchToCalendars(result.newMatch, skipUserIds);
            } catch (e) {
              console.error(`[scheduler] Calendar sync error for ${result.matchId}:`, e.message);
            }
          }
        } catch (e) {
          console.error(`[scheduler] Error syncing ${sport}:`, e.message);
        }
      }
      try {
        await backfillMissingCalendarEvents(skipUserIds);
      } catch (e) {
        console.error(`[scheduler] Backfill error after ${schedule.name} sync:`, e.message);
      }
    });
    console.log(`[scheduler] Scheduled ${schedule.name} — ${schedule.label}`);
  }

  console.log("[scheduler] All jobs scheduled. Sync running automatically.");
}

module.exports = { startScheduler };
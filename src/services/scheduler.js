const cron = require("node-cron");
const { syncMatches, syncSport } = require("./syncService");
const { syncMatchToCalendars } = require("./calendarSyncService");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");

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
    name:    "F1, Combate, Rugby, Hockey, Voleibol, Golf",
    sports:  ["motorsport", "fighting", "rugby", "ice hockey", "volleyball", "golf"],
    cron:    "0 0 * * *",        // una vez al día a medianoche
    label:   "cada 24 horas"
  }
];

async function backfillMissingCalendarEvents(skipUserIds = new Set()) {
  const allMatches = await matchRepository.getAll();
  const allCalendarEvents = await calendarEventRepository.getAll();
  const syncedMatchIds = new Set(allCalendarEvents.map(ce => ce.providerMatchId));

  let backfillCount = 0;
  for (const match of allMatches) {
    if (!syncedMatchIds.has(match.providerMatchId)) {
      try {
        const backfillResults = await syncMatchToCalendars(match, skipUserIds);
        backfillCount += backfillResults.length;
      } catch (e) {
        console.error(`[scheduler] Backfill error for ${match.providerMatchId}:`, e.message);
      }
    }
  }
  if (backfillCount > 0) console.log(`[scheduler] Backfilled ${backfillCount} calendar events`);
  return backfillCount;
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
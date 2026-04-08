const cron = require("node-cron");
const { syncMatches, syncSport } = require("./syncService");

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

function startScheduler() {
  console.log("[scheduler] Starting automatic sync scheduler...");

  // Job de sincronización completa al arrancar el servidor
  setTimeout(async () => {
    console.log("[scheduler] Running initial sync on startup...");
    try {
      await syncMatches();
    } catch (e) {
      console.error("[scheduler] Initial sync error:", e.message);
    }
  }, 5000); // espera 5 segundos para que el servidor esté listo

  // Jobs por deporte según su intervalo
  for (const schedule of SPORT_SCHEDULES) {
    cron.schedule(schedule.cron, async () => {
      console.log(`[scheduler] Running sync for: ${schedule.name} (${schedule.label})`);
      for (const sport of schedule.sports) {
        try {
          await syncSport(sport);
        } catch (e) {
          console.error(`[scheduler] Error syncing ${sport}:`, e.message);
        }
      }
    });
    console.log(`[scheduler] Scheduled ${schedule.name} — ${schedule.label}`);
  }

  console.log("[scheduler] All jobs scheduled. Sync running automatically.");
}

module.exports = { startScheduler };
require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { syncMatches } = require("../services/syncService");
const { syncMatchToCalendars } = require("../services/calendarSyncService");

async function run() {
  try {
    await initializeDatabase();

    console.log("STARTING PRODUCTION SYNC...");

    const syncResults = await syncMatches();

    console.log(`MATCHES WITH CHANGES: ${syncResults.length}`);

    const calendarResults = [];

    for (const result of syncResults) {
      const { newMatch } = result;

      if (!newMatch) {
        continue;
      }

      const calendarSyncResult = await syncMatchToCalendars(newMatch);

      calendarResults.push({
        matchId: result.matchId,
        homeParticipantName: result.homeParticipantName,
        awayParticipantName: result.awayParticipantName,
        changes: result.changes,
        calendarActions: calendarSyncResult
      });
    }

    console.log("\nPRODUCTION SYNC RESULTS:");
    console.log(JSON.stringify(calendarResults, null, 2));
  } catch (error) {
    console.error("PRODUCTION SYNC FAILED:");
    console.error(error.message);
  }
}

run();
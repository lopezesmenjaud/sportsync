require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { syncMatchToCalendars } = require("../services/calendarSyncService");

async function run() {
  try {
    await initializeDatabase();

    await subscriptionRepository.clear();
    await calendarEventRepository.clear();
    await matchRepository.clear();

    await subscriptionRepository.create({
      userId: "user_1",
      sport: "football",
      competitionKey: "4335"
    });

    const match = {
      internalMatchId: "the_sports_db_2279690",
      provider: "the_sports_db",
      providerMatchId: "2279690",
      sport: "football",
      competitionKey: "4335",
      competitionName: "Spanish La Liga",
      homeParticipantName: "Rayo Vallecano",
      awayParticipantName: "Elche",
      scheduledStartUtc: "2026-04-03T19:00:00Z",
      currentStartUtc: "2026-04-03T19:00:00Z",
      status: "scheduled",
      rawStatus: "Not Started",
      venueName: "Estadio de Vallecas",
      lastProviderUpdateUtc: new Date().toISOString()
    };

    await matchRepository.save(match);

    console.log("FIRST REAL CALENDAR SYNC:");
    const firstResults = await syncMatchToCalendars(match);
    console.log(JSON.stringify(firstResults, null, 2));

    const updatedMatch = {
      ...match,
      currentStartUtc: "2026-04-03T19:30:00Z",
      status: "delayed",
      lastProviderUpdateUtc: new Date().toISOString()
    };

    await matchRepository.save(updatedMatch);

    console.log("\nSECOND REAL CALENDAR SYNC:");
    const secondResults = await syncMatchToCalendars(updatedMatch);
    console.log(JSON.stringify(secondResults, null, 2));

    const allCalendarEvents = await calendarEventRepository.getAll();
    console.log("\nALL CALENDAR EVENT LINKS:");
    console.log(JSON.stringify(allCalendarEvents, null, 2));
  } catch (error) {
    console.error("REAL CALENDAR SYNC TEST FAILED:");
    console.error(error.message);
  }
}

run();
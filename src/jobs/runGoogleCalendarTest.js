require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const googleCalendarProvider = require("../services/googleCalendarProvider");

async function run() {
  try {
    await initializeDatabase();

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

    console.log("CREATING REAL GOOGLE EVENT...");
    const created = await googleCalendarProvider.createEvent({ userId: "user_1", match });
    console.log(JSON.stringify(created, null, 2));

    const updatedMatch = {
      ...match,
      currentStartUtc: "2026-04-03T19:30:00Z",
      status: "delayed"
    };

    console.log("\nUPDATING REAL GOOGLE EVENT...");
    const updated = await googleCalendarProvider.updateEvent({
      userId: "user_1",
      calendarEventId: created.calendarEventId,
      match: updatedMatch
    });
    console.log(JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error("GOOGLE CALENDAR REAL TEST FAILED:");
    console.error(error.message);
  }
}

run();
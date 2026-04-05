require("dotenv").config();

const { TheSportsDbProvider } = require("../providers/theSportsDb");

async function run() {
  try {
    console.log("TEST STARTED");

    const provider = new TheSportsDbProvider();

    const leagueId = "4335";
    const season = "2025-2026";

    const rawEvents = await provider.getEventsByLeagueAndSeason({
      leagueId,
      season
    });

    console.log(`RAW EVENTS FOUND: ${rawEvents.length}`);

    const normalized = rawEvents.slice(0, 5).map(event =>
      provider.normalizeMatch(event)
    );

    console.log("FIRST 5 NORMALIZED MATCHES:");
    console.log(JSON.stringify(normalized, null, 2));
  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error.response?.data || error.message);
  }
}

run();
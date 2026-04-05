require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { matchRepository } = require("../repositories/matchRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    const footballMatches = await matchRepository.getBySport("football");
    const laligaMatches = await matchRepository.getByCompetitionKey("4335");
    const scheduledMatches = await matchRepository.getByStatus("scheduled");

    console.log("FOOTBALL MATCHES:");
    console.log(JSON.stringify(footballMatches, null, 2));

    console.log("\nLALIGA MATCHES:");
    console.log(JSON.stringify(laligaMatches, null, 2));

    console.log("\nSCHEDULED MATCHES:");
    console.log(JSON.stringify(scheduledMatches, null, 2));
  } catch (error) {
    console.error("QUERY FAILED:");
    console.error(error.message);
  }
}

run();
require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { syncMatches } = require("../services/syncService");
const { matchRepository } = require("../repositories/matchRepositorySqlite");

async function run() {
  await initializeDatabase();

  console.log("FIRST SYNC:");
  const firstResults = await syncMatches();
  console.log(JSON.stringify(firstResults, null, 2));

  const existingMatch = await matchRepository.getByProviderMatchId("2279690");

  if (existingMatch) {
    await matchRepository.save({
      ...existingMatch,
      currentStartUtc: "2026-04-03T18:30:00Z",
      status: "delayed"
    });
  }

  console.log("\nSECOND SYNC (AFTER FORCED CHANGE IN REPOSITORY):");
  const secondResults = await syncMatches();
  console.log(JSON.stringify(secondResults, null, 2));
}

run().catch((error) => {
  console.error("RUN SYNC FAILED:");
  console.error(error.message);
});
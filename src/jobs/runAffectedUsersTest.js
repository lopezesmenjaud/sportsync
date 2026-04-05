require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { getAffectedUserIdsForMatch } = require("../services/affectedUsersService");

async function run() {
  try {
    await initializeDatabase();

    const match = await matchRepository.getByProviderMatchId("2279690");

    if (!match) {
      console.log("NO MATCH FOUND FOR 2279690");
      return;
    }

    console.log("MATCH:");
    console.log(JSON.stringify(match, null, 2));

    const affectedUserIds = await getAffectedUserIdsForMatch(match);

    console.log("\nAFFECTED USER IDS:");
    console.log(JSON.stringify(affectedUserIds, null, 2));
  } catch (error) {
    console.error("AFFECTED USERS TEST FAILED:");
    console.error(error.message);
  }
}

run();
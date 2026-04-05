require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { matchRepository } = require("../repositories/matchRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    const matches = await matchRepository.getAll();

    console.log(`MATCHES IN SQLITE: ${matches.length}`);
    console.log(JSON.stringify(matches.slice(0, 3), null, 2));
  } catch (error) {
    console.error("INSPECT FAILED:");
    console.error(error.message);
  }
}

run();
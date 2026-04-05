require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    const allAccounts = await googleAccountRepository.getAll();

    console.log("ALL GOOGLE ACCOUNTS:");
    const safeAccounts = allAccounts.map(acc => ({
  ...acc,
  accessToken: acc.accessToken ? "[REDACTED]" : null,
  refreshToken: acc.refreshToken ? "[REDACTED]" : null
}));

console.log(JSON.stringify(safeAccounts, null, 2));
  } catch (error) {
    console.error("INSPECT GOOGLE ACCOUNTS FAILED:");
    console.error(error.message);
  }
}

run();
require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    await googleAccountRepository.clear();

    const account1 = await googleAccountRepository.upsert({
      userId: "user_1",
      googleEmail: "user1@gmail.com",
      accessToken: "access_token_1",
      refreshToken: "refresh_token_1",
      scope: "https://www.googleapis.com/auth/calendar",
      expiryDate: Date.now() + 3600_000
    });

    const account2 = await googleAccountRepository.upsert({
      userId: "user_2",
      googleEmail: "user2@gmail.com",
      accessToken: "access_token_2",
      refreshToken: "refresh_token_2",
      scope: "https://www.googleapis.com/auth/calendar",
      expiryDate: Date.now() + 3600_000
    });

    const account1Updated = await googleAccountRepository.upsert({
      userId: "user_1",
      googleEmail: "user1@gmail.com",
      accessToken: "access_token_1_updated",
      refreshToken: null,
      scope: "https://www.googleapis.com/auth/calendar",
      expiryDate: Date.now() + 7200_000
    });

    console.log("CREATED/UPDATED ACCOUNTS:");
    console.log(JSON.stringify([account1, account2, account1Updated], null, 2));

    const user1 = await googleAccountRepository.getByUserId("user_1");
    console.log("\nUSER_1 GOOGLE ACCOUNT:");
    console.log(JSON.stringify(user1, null, 2));

    const allAccounts = await googleAccountRepository.getAll();
    console.log("\nALL GOOGLE ACCOUNTS:");
    console.log(JSON.stringify(allAccounts, null, 2));
  } catch (error) {
    console.error("GOOGLE ACCOUNT TEST FAILED:");
    console.error(error.message);
  }
}

run();
require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    await subscriptionRepository.clear();

    const sub1 = await subscriptionRepository.create({
      userId: "user_1",
      sport: "football",
      competitionKey: "4335"
    });

    const sub2 = await subscriptionRepository.create({
      userId: "user_1",
      sport: "football",
      teamName: "Barcelona"
    });

    const sub3 = await subscriptionRepository.create({
      userId: "user_2",
      sport: "motorsport"
    });

    console.log("CREATED SUBSCRIPTIONS:");
    console.log(JSON.stringify([sub1, sub2, sub3], null, 2));

    const allSubscriptions = await subscriptionRepository.getAll();
    console.log("\nALL SUBSCRIPTIONS:");
    console.log(JSON.stringify(allSubscriptions, null, 2));

    const user1Subscriptions = await subscriptionRepository.getByUserId("user_1");
    console.log("\nUSER_1 SUBSCRIPTIONS:");
    console.log(JSON.stringify(user1Subscriptions, null, 2));
  } catch (error) {
    console.error("SUBSCRIPTION TEST FAILED:");
    console.error(error.message);
  }
}

run();
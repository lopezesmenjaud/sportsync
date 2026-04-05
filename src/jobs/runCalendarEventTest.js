require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");

async function run() {
  try {
    await initializeDatabase();

    await calendarEventRepository.clear();

    const event1 = await calendarEventRepository.create({
      userId: "user_1",
      providerMatchId: "2279690",
      calendarProvider: "google",
      calendarEventId: "google_event_abc123"
    });

    const event2 = await calendarEventRepository.create({
      userId: "user_1",
      providerMatchId: "2279700",
      calendarProvider: "google",
      calendarEventId: "google_event_xyz999"
    });

    const event3 = await calendarEventRepository.create({
      userId: "user_2",
      providerMatchId: "3000001",
      calendarProvider: "google",
      calendarEventId: "google_event_user2_1"
    });

    console.log("CREATED CALENDAR EVENTS:");
    console.log(JSON.stringify([event1, event2, event3], null, 2));

    const allEvents = await calendarEventRepository.getAll();
    console.log("\nALL CALENDAR EVENTS:");
    console.log(JSON.stringify(allEvents, null, 2));

    const user1Events = await calendarEventRepository.getByUserId("user_1");
    console.log("\nUSER_1 CALENDAR EVENTS:");
    console.log(JSON.stringify(user1Events, null, 2));

    const matchEvents = await calendarEventRepository.getByProviderMatchId("2279690");
    console.log("\nEVENTS FOR MATCH 2279690:");
    console.log(JSON.stringify(matchEvents, null, 2));

    const singleLink = await calendarEventRepository.getByUserIdAndProviderMatchId(
      "user_1",
      "2279690"
    );
    console.log("\nUSER_1 + MATCH 2279690:");
    console.log(JSON.stringify(singleLink, null, 2));
  } catch (error) {
    console.error("CALENDAR EVENT TEST FAILED:");
    console.error(error.message);
  }
}

run();
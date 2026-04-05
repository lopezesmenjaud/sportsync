require("dotenv").config();

const { initializeDatabase, db } = require("../db/database");

async function run() {
  try {
    await initializeDatabase();

    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM google_accounts WHERE userId = ?`,
        ["user_2"],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    console.log("✅ Fake google account removed: user_2");
  } catch (error) {
    console.error("CLEANUP GOOGLE ACCOUNTS FAILED:");
    console.error(error.message);
  }
}

run();
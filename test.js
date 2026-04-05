const { db, initializeDatabase } = require('./src/db/database');
initializeDatabase().then(() => {
  const from = '2026-04-01T00:00:00.000Z';
  const to   = '2026-04-05T23:59:59.000Z';
  db.all(
    "SELECT providerMatchId, country, currentStartUtc FROM matches WHERE LOWER(country) = LOWER('Spain') AND currentStartUtc >= ? AND currentStartUtc <= ?",
    [from, to],
    (e, r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit();
    }
  );
});
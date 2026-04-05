const Database = require("better-sqlite3");
const path = require("path");
const dbPath = path.resolve(__dirname, "../../sportsync.db");
const betterDb = new Database(dbPath);

// Enable WAL mode for better concurrent performance
betterDb.pragma("journal_mode = WAL");

// Compatibility layer: emulate sqlite3's callback API so repositories & server.js work unchanged
const db = {
  run(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    try {
      const stmt = betterDb.prepare(sql);
      const result = stmt.run(...(Array.isArray(params) ? params : []));
      if (callback) callback.call({ lastID: result.lastInsertRowid, changes: result.changes }, null);
    } catch (err) {
      if (callback) callback.call({}, err);
      else throw err;
    }
  },

  get(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    try {
      const stmt = betterDb.prepare(sql);
      const row = stmt.get(...(Array.isArray(params) ? params : []));
      if (callback) callback(null, row || undefined);
    } catch (err) {
      if (callback) callback(err);
      else throw err;
    }
  },

  all(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    try {
      const stmt = betterDb.prepare(sql);
      const rows = stmt.all(...(Array.isArray(params) ? params : []));
      if (callback) callback(null, rows);
    } catch (err) {
      if (callback) callback(err);
      else throw err;
    }
  },

  close() {
    betterDb.close();
  }
};

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function addColumnIfNotExists(table, column, definition) {
  try {
    const rows = betterDb.prepare(`PRAGMA table_info(${table})`).all();
    const exists = rows.some(r => r.name === column);
    if (!exists) {
      betterDb.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  } catch (err) {
    // ignore errors silently
  }
}

let initializationPromise = null;

async function initializeDatabase() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    console.log("✅ Connected to SQLite database (better-sqlite3)");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS matches (
        providerMatchId TEXT PRIMARY KEY,
        provider TEXT,
        sport TEXT,
        competitionKey TEXT,
        competitionName TEXT,
        homeParticipantName TEXT,
        awayParticipantName TEXT,
        scheduledStartUtc TEXT,
        currentStartUtc TEXT,
        status TEXT,
        rawStatus TEXT,
        venueName TEXT,
        city TEXT,
        country TEXT,
        lastProviderUpdateUtc TEXT,
        data TEXT,
        ai_summary TEXT,
        summary_generated_at TEXT
      )
    `);

    await addColumnIfNotExists("matches", "ai_summary", "TEXT");
    await addColumnIfNotExists("matches", "summary_generated_at", "TEXT");
    await addColumnIfNotExists("matches", "city", "TEXT");
    await addColumnIfNotExists("matches", "country", "TEXT");

    console.log("✅ Matches table ready");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        sport TEXT,
        competitionKey TEXT,
        competitionName TEXT,
        teamName TEXT,
        createdAtUtc TEXT NOT NULL
      )
    `);
    await addColumnIfNotExists("subscriptions", "competitionName", "TEXT");
    await runAsync(`
      UPDATE subscriptions
      SET competitionName = CASE competitionKey
        WHEN '4335' THEN 'La Liga'
        WHEN '4387' THEN 'NBA'
        WHEN '4480' THEN 'Champions League'
        WHEN '4328' THEN 'Premier League'
        WHEN '4331' THEN 'Ligue 1'
        WHEN '4332' THEN 'Bundesliga'
        WHEN '4334' THEN 'Serie A'
        WHEN '4346' THEN 'NFL'
        WHEN '4424' THEN 'MLB'
        WHEN '4391' THEN 'NHL'
        WHEN '4443' THEN 'Formula 1'
        ELSE competitionName
      END
      WHERE competitionName IS NULL AND competitionKey IS NOT NULL
    `);
    console.log("✅ Subscriptions table ready");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        providerMatchId TEXT NOT NULL,
        calendarProvider TEXT NOT NULL,
        calendarEventId TEXT NOT NULL,
        createdAtUtc TEXT NOT NULL,
        updatedAtUtc TEXT NOT NULL
      )
    `);
    console.log("✅ Calendar events table ready");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS google_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL UNIQUE,
        googleEmail TEXT,
        accessToken TEXT,
        refreshToken TEXT,
        scope TEXT,
        expiryDate INTEGER,
        createdAtUtc TEXT NOT NULL,
        updatedAtUtc TEXT NOT NULL
      )
    `);
    console.log("✅ Google accounts table ready");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS broadcasting_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competitionKey TEXT NOT NULL,
        competitionName TEXT NOT NULL,
        country TEXT NOT NULL,
        data TEXT NOT NULL,
        createdAtUtc TEXT NOT NULL,
        UNIQUE(competitionKey, country)
      )
    `);
    console.log("✅ Broadcasting cache table ready");

    await runAsync(`DROP TABLE IF EXISTS venue_cache`);
    await runAsync(`
      CREATE TABLE IF NOT EXISTS venue_city_cache (
        venue TEXT NOT NULL,
        targetCity TEXT NOT NULL,
        city TEXT,
        inTargetCity INTEGER NOT NULL DEFAULT 0,
        cachedAt TEXT,
        PRIMARY KEY (venue, targetCity)
      )
    `);
    await runAsync(`DELETE FROM venue_city_cache`);
    console.log("✅ Venue city cache table ready (cleared)");

    await runAsync(`
      CREATE TABLE IF NOT EXISTS league_country_cache (
        country TEXT NOT NULL,
        sport TEXT NOT NULL,
        data TEXT NOT NULL,
        cachedAt TEXT NOT NULL,
        PRIMARY KEY (country, sport)
      )
    `);
    console.log("✅ League country cache table ready");

  })();

  return initializationPromise;
}

module.exports = { db, initializeDatabase };

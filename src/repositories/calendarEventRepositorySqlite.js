const { db } = require("../db/database");

class CalendarEventRepositorySqlite {
  create({ userId, providerMatchId, calendarProvider, calendarEventId }) {
    return new Promise((resolve, reject) => {
      const createdAtUtc = new Date().toISOString();
      const updatedAtUtc = createdAtUtc;

      db.run(
        `
        INSERT INTO calendar_events (
          userId,
          providerMatchId,
          calendarProvider,
          calendarEventId,
          createdAtUtc,
          updatedAtUtc
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          providerMatchId,
          calendarProvider,
          calendarEventId,
          createdAtUtc,
          updatedAtUtc
        ],
        function (err) {
          if (err) return reject(err);

          resolve({
            id: this.lastID,
            userId,
            providerMatchId,
            calendarProvider,
            calendarEventId,
            createdAtUtc,
            updatedAtUtc
          });
        }
      );
    });
  }

  getAll() {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT *
        FROM calendar_events
        ORDER BY id ASC
        `,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  getByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT *
        FROM calendar_events
        WHERE userId = ?
        ORDER BY id ASC
        `,
        [userId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  getByProviderMatchId(providerMatchId) {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT *
        FROM calendar_events
        WHERE providerMatchId = ?
        ORDER BY id ASC
        `,
        [providerMatchId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  getByUserIdAndProviderMatchId(userId, providerMatchId) {
    return new Promise((resolve, reject) => {
      db.get(
        `
        SELECT *
        FROM calendar_events
        WHERE userId = ? AND providerMatchId = ?
        LIMIT 1
        `,
        [userId, providerMatchId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }

  updateCalendarEventId(id, calendarEventId) {
    return new Promise((resolve, reject) => {
      const updatedAtUtc = new Date().toISOString();

      db.run(
        `
        UPDATE calendar_events
        SET calendarEventId = ?, updatedAtUtc = ?
        WHERE id = ?
        `,
        [calendarEventId, updatedAtUtc, id],
        (err) => {
          if (err) return reject(err);
          resolve({
            id,
            calendarEventId,
            updatedAtUtc
          });
        }
      );
    });
  }

  getByUserIdAndMatchIds(userId, providerMatchIds) {
    if (!providerMatchIds.length) return Promise.resolve([]);
    const placeholders = providerMatchIds.map(() => "?").join(",");
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM calendar_events WHERE userId = ? AND providerMatchId IN (${placeholders})`,
        [userId, ...providerMatchIds],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  deleteById(id) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM calendar_events WHERE id = ?`, [id], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM calendar_events`, [], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

const calendarEventRepository = new CalendarEventRepositorySqlite();

module.exports = { calendarEventRepository };
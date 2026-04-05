const { db } = require("../db/database");

class SubscriptionRepositorySqlite {
  create({ userId, sport = null, competitionKey = null, competitionName = null, teamName = null }) {
    return new Promise((resolve, reject) => {
      const createdAtUtc = new Date().toISOString();

      db.run(
        `
        INSERT INTO subscriptions (
          userId,
          sport,
          competitionKey,
          competitionName,
          teamName,
          createdAtUtc
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [userId, sport, competitionKey, competitionName, teamName, createdAtUtc],
        function (err) {
          if (err) return reject(err);

          resolve({
            id: this.lastID,
            userId,
            sport,
            competitionKey,
            competitionName,
            teamName,
            createdAtUtc
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
        FROM subscriptions
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
        FROM subscriptions
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

  getDistinctUserIds() {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT DISTINCT userId
        FROM subscriptions
        ORDER BY userId ASC
        `,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map((row) => row.userId));
        }
      );
    });
  }

  deleteById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM subscriptions WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        db.run(`DELETE FROM subscriptions WHERE id = ?`, [id], function (err2) {
          if (err2) return reject(err2);
          resolve(row);
        });
      });
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM subscriptions`, [], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

const subscriptionRepository = new SubscriptionRepositorySqlite();

module.exports = { subscriptionRepository };
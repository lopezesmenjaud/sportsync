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

  // Borra SOLO si la suscripción es del usuario. El id es INTEGER AUTOINCREMENT (secuencial y
  // adivinable), así que sin esta comprobación cualquiera borra las de todos.
  //
  // Las dos condiciones van también en el DELETE, no solo en el SELECT: así no hay ventana entre
  // comprobar y borrar. Devuelve null tanto si no existe como si no es de ese usuario — el
  // endpoint responde 404 en ambos casos y no revela cuál de los dos fue.
  deleteByIdForUser(id, userId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM subscriptions WHERE id = ? AND userId = ?`, [id, userId], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        db.run(`DELETE FROM subscriptions WHERE id = ? AND userId = ?`, [id, userId], function (err2) {
          if (err2) return reject(err2);
          resolve(this.changes === 1 ? row : null);
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
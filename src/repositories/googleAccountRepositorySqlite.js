const { db } = require("../db/database");
const { encrypt, decrypt } = require("../config/tokenCrypto");

class GoogleAccountRepositorySqlite {
  upsert({
    userId,
    googleEmail = null,
    accessToken = null,
    refreshToken = null,
    scope = null,
    expiryDate = null
  }) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();

      // Cifrar tokens ANTES de persistir. encrypt(null) devuelve null, así que
      // el refreshToken null sigue disparando el CASE que conserva el valor previo.
      const accessTokenEnc = encrypt(accessToken);
      const refreshTokenEnc = encrypt(refreshToken);

      db.run(
        `
        INSERT INTO google_accounts (
          userId,
          googleEmail,
          accessToken,
          refreshToken,
          scope,
          expiryDate,
          createdAtUtc,
          updatedAtUtc
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
          googleEmail = excluded.googleEmail,
          accessToken = excluded.accessToken,
          refreshToken = CASE
            WHEN excluded.refreshToken IS NOT NULL THEN excluded.refreshToken
            ELSE google_accounts.refreshToken
          END,
          scope = excluded.scope,
          expiryDate = excluded.expiryDate,
          updatedAtUtc = excluded.updatedAtUtc
        `,
        [
          userId,
          googleEmail,
          accessTokenEnc,
          refreshTokenEnc,
          scope,
          expiryDate,
          now,
          now
        ],
        (err) => {
          if (err) return reject(err);

          // El objeto devuelto conserva los tokens en claro (los consumidores
          // esperan texto plano); en la DB quedan cifrados.
          resolve({
            userId,
            googleEmail,
            accessToken,
            refreshToken,
            scope,
            expiryDate,
            updatedAtUtc: now
          });
        }
      );
    });
  }

  getByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `
        SELECT *
        FROM google_accounts
        WHERE userId = ?
        LIMIT 1
        `,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          if (row) {
            row.accessToken = decrypt(row.accessToken);
            row.refreshToken = decrypt(row.refreshToken);
          }
          resolve(row || null);
        }
      );
    });
  }

  getAll() {
    return new Promise((resolve, reject) => {
      db.all(
        `
        SELECT *
        FROM google_accounts
        ORDER BY id ASC
        `,
        [],
        (err, rows) => {
          if (err) return reject(err);
          for (const row of rows) {
            row.accessToken = decrypt(row.accessToken);
            row.refreshToken = decrypt(row.refreshToken);
          }
          resolve(rows);
        }
      );
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM google_accounts`, [], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  markNeedsReauth(userId) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      db.run(
        `UPDATE google_accounts SET needsReauth = 1, updatedAtUtc = ? WHERE userId = ?`,
        [now, userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  clearNeedsReauth(userId) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      db.run(
        `UPDATE google_accounts SET needsReauth = 0, updatedAtUtc = ? WHERE userId = ?`,
        [now, userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  setFanscheduleCalendarId(userId, calendarId) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      db.run(
        `
        UPDATE google_accounts
        SET fanschedule_calendar_id = ?, updatedAtUtc = ?
        WHERE userId = ?
        `,
        [calendarId, now, userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }
}

const googleAccountRepository = new GoogleAccountRepositorySqlite();

module.exports = { googleAccountRepository };
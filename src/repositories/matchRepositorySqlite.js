const { db } = require("../db/database");

class MatchRepositorySqlite {
  getByProviderMatchId(providerMatchId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT data, ai_summary, summary_generated_at FROM matches WHERE providerMatchId = ?`,
        [providerMatchId],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          const match = JSON.parse(row.data);
          match.ai_summary = row.ai_summary || null;
          match.summary_generated_at = row.summary_generated_at || null;
          resolve(match);
        }
      );
    });
  }

  getAll() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT data FROM matches`, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => JSON.parse(r.data)));
      });
    });
  }

  getBySport(sport) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT data FROM matches WHERE sport = ?`, [sport], (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => JSON.parse(r.data)));
      });
    });
  }

  getByCompetitionKey(competitionKey) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT data FROM matches WHERE competitionKey = ?`, [competitionKey], (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => JSON.parse(r.data)));
      });
    });
  }

  getByStatus(status) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT data FROM matches WHERE status = ?`, [status], (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => JSON.parse(r.data)));
      });
    });
  }

  // ── Nuevo: buscar partidos por país y rango de fechas ──
  getByCountryAndDates(country, dateFrom, dateTo) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT data FROM matches
         WHERE LOWER(country) = LOWER(?)
         AND currentStartUtc >= ?
         AND currentStartUtc <= ?
         ORDER BY currentStartUtc ASC`,
        [country, dateFrom, dateTo],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows.map(r => JSON.parse(r.data)));
        }
      );
    });
  }

  save(match) {
    return new Promise((resolve, reject) => {
      // UPSERT real (no INSERT OR REPLACE, que recrearía la fila y borraría createdAt /
      // ai_summary). En INSERT: createdAt y lastSyncedAt = ahora. En conflicto: se
      // actualizan los campos del proveedor + lastSyncedAt, pero createdAt se preserva.
      db.run(
        `INSERT INTO matches (
          providerMatchId,
          provider,
          sport,
          competitionKey,
          competitionName,
          eventName,
          homeParticipantName,
          awayParticipantName,
          scheduledStartUtc,
          currentStartUtc,
          status,
          rawStatus,
          venueName,
          city,
          country,
          lastProviderUpdateUtc,
          data,
          createdAt,
          lastSyncedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        ON CONFLICT(providerMatchId) DO UPDATE SET
          provider              = excluded.provider,
          sport                 = excluded.sport,
          competitionKey        = excluded.competitionKey,
          competitionName       = excluded.competitionName,
          eventName             = excluded.eventName,
          homeParticipantName   = excluded.homeParticipantName,
          awayParticipantName   = excluded.awayParticipantName,
          scheduledStartUtc     = excluded.scheduledStartUtc,
          currentStartUtc       = excluded.currentStartUtc,
          status                = excluded.status,
          rawStatus             = excluded.rawStatus,
          venueName             = excluded.venueName,
          city                  = excluded.city,
          country               = excluded.country,
          lastProviderUpdateUtc = excluded.lastProviderUpdateUtc,
          data                  = excluded.data,
          lastSyncedAt          = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        [
          match.providerMatchId,
          match.provider,
          match.sport,
          match.competitionKey,
          match.competitionName,
          match.eventName || null,
          match.homeParticipantName,
          match.awayParticipantName,
          match.scheduledStartUtc,
          match.currentStartUtc,
          match.status,
          match.rawStatus,
          match.venueName,
          match.city    || null,
          match.country || null,
          match.lastProviderUpdateUtc,
          JSON.stringify(match)
        ],
        (err) => {
          if (err) return reject(err);
          resolve(match);
        }
      );
    });
  }

  saveAll(matches) {
    return Promise.all(matches.map(m => this.save(m)));
  }

  deleteByProviderMatchId(providerMatchId) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM matches WHERE providerMatchId = ?`, [providerMatchId], function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });
  }

  deleteByCompetitionKey(competitionKey) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM matches WHERE competitionKey = ?`, [competitionKey], function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM matches`, [], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

const matchRepository = new MatchRepositorySqlite();
module.exports = { matchRepository };
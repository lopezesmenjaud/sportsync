const crypto = require("crypto");
const { db } = require("../db/database");

// Vida de la sesión y umbral de extensión perezosa. La ventana es DESLIZANTE: cada uso válido
// puede empujar expiresAtUtc otros 90 días, pero solo se ESCRIBE si la sesión no se ha tocado
// en las últimas 24 h (ver touchIfStale). El efecto para el usuario es idéntico —un usuario
// activo nunca ve la pantalla de reconectar— y el costo baja de 1 write por petición a 1 write
// por usuario por día.
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// En la base vive el SHA-256 del token, NUNCA el token. Si se filtra el .db no se puede
// suplantar a nadie: el token en claro solo existe en el navegador del usuario.
function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

class SessionRepositorySqlite {
  // Genera el token opaco (crypto.randomBytes, NUNCA Math.random) y guarda su hash.
  // Devuelve el token en claro: es la única vez que sale del servidor.
  create({ userId, userAgent = null }) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(32).toString("hex");
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const expiresAtUtc = new Date(now + SESSION_TTL_MS).toISOString();

      db.run(
        `
        INSERT INTO sessions (
          tokenHash, userId, createdAtUtc, expiresAtUtc, lastSeenUtc, userAgent, revokedAtUtc
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        [hashToken(token), userId, nowIso, expiresAtUtc, nowIso, userAgent],
        (err) => {
          if (err) return reject(err);
          resolve({ token, userId, expiresAtUtc });
        }
      );
    });
  }

  // Devuelve la fila SOLO si la sesión sirve: existe, no está revocada y no está vencida.
  // Cualquier otro caso → null (el llamador responde 401 sin distinguir el motivo).
  findValid(token) {
    return new Promise((resolve, reject) => {
      if (!token) return resolve(null);

      db.get(`SELECT * FROM sessions WHERE tokenHash = ?`, [hashToken(token)], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        if (row.revokedAtUtc) return resolve(null);
        if (Date.parse(row.expiresAtUtc) <= Date.now()) return resolve(null);
        resolve(row);
      });
    });
  }

  // Extensión perezosa. No escribe nada si la sesión ya se tocó hace menos de TOUCH_INTERVAL_MS.
  // Devuelve true solo si hubo escritura (útil para verificar el comportamiento sin adivinar).
  touchIfStale(row) {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const lastSeen = Date.parse(row.lastSeenUtc);
      // lastSeenUtc ilegible → se reescribe una vez y queda en ISO válido.
      if (Number.isFinite(lastSeen) && now - lastSeen < TOUCH_INTERVAL_MS) return resolve(false);

      const nowIso = new Date(now).toISOString();
      const expiresAtUtc = new Date(now + SESSION_TTL_MS).toISOString();
      db.run(
        `UPDATE sessions SET lastSeenUtc = ?, expiresAtUtc = ? WHERE tokenHash = ?`,
        [nowIso, expiresAtUtc, row.tokenHash],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  // Revocación del lado del servidor: la razón por la que el token es opaco y vive en la base.
  // Operable desde el Shell de Render si hay que sacar a alguien de inmediato.
  revokeAllForUser(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE sessions SET revokedAtUtc = ? WHERE userId = ? AND revokedAtUtc IS NULL`,
        [new Date().toISOString(), userId],
        function (err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });
  }

  countActiveByUser(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS n FROM sessions
         WHERE userId = ? AND revokedAtUtc IS NULL AND expiresAtUtc > ?`,
        [userId, new Date().toISOString()],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.n : 0);
        }
      );
    });
  }
}

const sessionRepository = new SessionRepositorySqlite();

module.exports = { sessionRepository, SESSION_TTL_MS, TOUCH_INTERVAL_MS };

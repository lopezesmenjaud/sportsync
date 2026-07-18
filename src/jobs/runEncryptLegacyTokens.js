// src/jobs/runEncryptLegacyTokens.js
//
// Migración: cifra los tokens de google_accounts que quedaron en texto plano
// (legacy, guardados antes de activar AES-256-GCM) y los reescribe cifrados.
//
// - Idempotente: solo toca valores que NO empiezan con "enc:v1:". Si se corre
//   dos veces, la segunda no encuentra nada que migrar (no doble-cifra).
// - La ruta de la DB viene de src/db/database.js (local vs /var/data según
//   NODE_ENV), NO está hardcodeada.
// - Seguridad: por defecto corre en DRY-RUN (solo reporta). Para escribir de
//   verdad hay que pasar CONFIRM=1.
//
// Uso:
//   Local  (dry-run):  node src/jobs/runEncryptLegacyTokens.js
//   Local  (aplicar):  CONFIRM=1 node src/jobs/runEncryptLegacyTokens.js
//   Render (aplicar):  CONFIRM=1 NODE_ENV=production node src/jobs/runEncryptLegacyTokens.js
//
// Requiere TOKEN_ENCRYPTION_KEY definida (si no, encrypt() lanza y aborta).

require("dotenv").config();

const { db } = require("../db/database");
const { encrypt } = require("../config/tokenCrypto");

const PREFIX = "enc:v1:";
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";

// ¿Es un valor de token en texto plano que hay que cifrar?
// null/undefined → no. Ya cifrado (prefijo enc:v1:) → no. Cualquier otra cosa → sí.
function needsEncryption(value) {
  return value != null && !String(value).startsWith(PREFIX);
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // { changes, lastID }
    });
  });
}

async function migrate() {
  console.log(`[encrypt-legacy] modo: ${APPLY ? "APLICAR (CONFIRM=1)" : "DRY-RUN (sin escribir)"}`);

  // Leemos los valores CRUDOS directamente de la DB (no vía el repositorio,
  // que descifraría). Así distinguimos legacy de ya-cifrado.
  const rows = await all(
    "SELECT id, userId, accessToken, refreshToken FROM google_accounts ORDER BY id ASC"
  );

  if (rows.length === 0) {
    console.log("[encrypt-legacy] tabla google_accounts vacía — nada que hacer.");
    return;
  }

  let alreadyEncrypted = 0; // filas con ambos tokens ya cifrados (o null)
  let migrated = 0;         // filas que se re-cifraron (o se re-cifrarían en dry-run)
  const now = new Date().toISOString();

  for (const row of rows) {
    const accessLegacy = needsEncryption(row.accessToken);
    const refreshLegacy = needsEncryption(row.refreshToken);

    if (!accessLegacy && !refreshLegacy) {
      alreadyEncrypted++;
      continue;
    }

    // Cifrar solo las columnas legacy; las ya cifradas o null se dejan intactas.
    const newAccess = accessLegacy ? encrypt(row.accessToken) : row.accessToken;
    const newRefresh = refreshLegacy ? encrypt(row.refreshToken) : row.refreshToken;

    const cols = [];
    if (accessLegacy) cols.push("accessToken");
    if (refreshLegacy) cols.push("refreshToken");
    console.log(`[encrypt-legacy] ${APPLY ? "migrando" : "migraría"} userId=${row.userId} (columnas: ${cols.join(", ")})`);

    if (APPLY) {
      await run(
        "UPDATE google_accounts SET accessToken = ?, refreshToken = ?, updatedAtUtc = ? WHERE id = ?",
        [newAccess, newRefresh, now, row.id]
      );
    }
    migrated++;
  }

  console.log("─".repeat(50));
  console.log(`[encrypt-legacy] total filas:        ${rows.length}`);
  console.log(`[encrypt-legacy] ya cifradas:        ${alreadyEncrypted}`);
  console.log(`[encrypt-legacy] ${APPLY ? "migradas:           " : "por migrar (dry-run):"} ${migrated}`);
  if (!APPLY && migrated > 0) {
    console.log("[encrypt-legacy] DRY-RUN: no se escribió nada. Re-ejecuta con CONFIRM=1 para aplicar.");
  }
}

migrate()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("[encrypt-legacy] FALLÓ:", err.message);
    db.close();
    process.exit(1);
  });

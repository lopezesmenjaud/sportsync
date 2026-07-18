// src/config/tokenCrypto.js
const crypto = require("crypto");

// AES-256-GCM: cifrado autenticado (confidencialidad + integridad).
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;          // nonce de 96 bits, recomendado para GCM
const PREFIX = "enc:v1:";      // marca los valores ya cifrados (versión del formato)

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY no está definida. Genérala con:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres hexadecimales)."
    );
  }
  return key;
}

// Devuelve un string "enc:v1:<iv>:<tag>:<ciphertext>" (todo en hex).
// Passthrough de null/undefined para no romper la lógica de upsert (refreshToken puede ser null).
function encrypt(text) {
  if (text == null) return text;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

// Retrocompatibilidad: si el valor NO tiene el prefijo "enc:v1:", es texto plano legacy
// (guardado antes de activar el cifrado) → se devuelve tal cual, sin romper.
// En el próximo login/refresh ese usuario se re-guardará ya cifrado.
function decrypt(payload) {
  if (payload == null) return payload;
  if (typeof payload !== "string" || !payload.startsWith(PREFIX)) {
    return payload; // texto plano legacy o valor no reconocido
  }
  const parts = payload.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return payload; // formato inesperado → no romper
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };

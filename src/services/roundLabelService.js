// src/services/roundLabelService.js
//
// Resuelve la etiqueta de fase (ej. "Cuartos", "Final") para un (competitionKey, intRound).
// Orden: blocklist → cache en memoria → tabla round_labels → IA (una vez) → null.
// NUNCA inventa: si la IA falla o no está segura, guarda label NULL y devuelve null.
const { db } = require("../db/database");

// Formato regular sin fases eliminatorias:
//  - Por DEPORTE (escala solo): motor y combate nunca tienen octavos/cuartos.
//  - Por LIGA: temporadas regulares donde intRound = semana/jornada.
// Para estas, getRoundLabel devuelve null sin llamar a la IA ni escribir en round_labels.
const BLOCKED_SPORTS = new Set(["motorsport", "fighting"]);
const BLOCKED_COMPETITIONS = new Set(["4424" /* MLB */]);

const memCache = new Map(); // `${competitionKey}::${intRound}` -> (string|null)
const key = (ck, r) => `${ck}::${r}`;

function getRow(competitionKey, intRound) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT label, source FROM round_labels WHERE competitionKey = ? AND intRound = ?`,
      [competitionKey, intRound],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function saveLabel(competitionKey, intRound, label, source) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO round_labels (competitionKey, intRound, label, source, createdAtUtc)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(competitionKey, intRound) DO UPDATE SET
         label = excluded.label, source = excluded.source`,
      [competitionKey, intRound, label, source, now],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// Contexto para el prompt: nº de partidos, rango de fechas y hasta 3 ejemplos de equipos.
function gatherContext(competitionKey, intRound) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) n, MIN(currentStartUtc) minD, MAX(currentStartUtc) maxD
       FROM matches WHERE competitionKey = ? AND intRound = ?`,
      [competitionKey, intRound],
      (err, agg) => {
        if (err) return reject(err);
        db.all(
          `SELECT homeParticipantName, awayParticipantName
           FROM matches WHERE competitionKey = ? AND intRound = ? LIMIT 3`,
          [competitionKey, intRound],
          (err2, rows) => {
            if (err2) return reject(err2);
            resolve({
              count: agg?.n || 0,
              minDate: agg?.minD || null,
              maxDate: agg?.maxD || null,
              examples: (rows || []).map((r) => `${r.homeParticipantName} vs ${r.awayParticipantName}`),
            });
          }
        );
      }
    );
  });
}

// Etiquetas que se tratan como null: dígitos o palabras de jornada/regular (ES+EN).
const REJECT_WORDS = /\b(jornada|semana|fecha|ronda|round|week|matchday|gameweek|gp|d[ií]a|day)\b/i;

function sanitizeLabel(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/```/g, "").replace(/^["'\s]+|["'.\s]+$/g, "").trim();
  if (!s) return null;
  if (/^null$/i.test(s)) return null;
  if (/\d/.test(s)) return null;          // contiene dígitos → null
  if (REJECT_WORDS.test(s)) return null;  // "jornada"/"semana"/"round"/... → null
  if (s.length > 20) return null;
  if (s.split(/\s+/).length > 2) return null;
  return s;
}

async function askAi(competitionName, sport, intRound, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const prompt = `Deporte: ${sport}
Competición: ${competitionName}
Código de ronda (intRound): ${intRound}
Partidos con ese código: ${ctx.count}
Rango de fechas: ${ctx.minDate || "?"} a ${ctx.maxDate || "?"}
Ejemplos: ${ctx.examples.join("; ") || "(sin ejemplos)"}

Devuelve SOLO una etiqueta corta en español (máximo 2 palabras) que nombre la fase de esta ronda
(ej. "Clasificatorio", "Octavos", "Cuartos", "Semifinal", "Final"), o exactamente la palabra NULL
si es una jornada regular sin fase distintiva. Sin números, sin explicación, sin comillas.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  return sanitizeLabel(data.content?.[0]?.text);
}

async function getRoundLabel(competitionKey, competitionName, intRound, sport) {
  if (!competitionKey || !intRound) return null;
  // Blocklist: formato regular → null inmediato, sin IA ni escritura.
  if (sport && BLOCKED_SPORTS.has(sport)) return null;
  if (BLOCKED_COMPETITIONS.has(String(competitionKey))) return null;

  const k = key(competitionKey, intRound);
  if (memCache.has(k)) return memCache.get(k);

  const row = await getRow(competitionKey, intRound);
  if (row) { memCache.set(k, row.label); return row.label; } // incluye label NULL: no llama IA

  let label = null;
  try {
    const ctx = await gatherContext(competitionKey, intRound);
    label = await askAi(competitionName, sport, intRound, ctx);
  } catch (err) {
    console.error(`[roundLabel] IA falló para ${k}: ${err.message}`);
    label = null;
  }
  try { await saveLabel(competitionKey, intRound, label, "ai"); } catch (e) { /* no romper el sync */ }
  memCache.set(k, label);
  return label;
}

function invalidate(competitionKey, intRound) {
  memCache.delete(key(competitionKey, intRound));
}

module.exports = { getRoundLabel, invalidate };

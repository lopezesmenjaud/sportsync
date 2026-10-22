const { db } = require("../db/database");

// Resúmenes con IA de la pantalla de partido de la app (tabla match_summary_cache, creada en
// initializeDatabase). Los escribe SOLO el job runGenerarResumenesPartidos; el endpoint solo lee.
// Reemplaza a matches.ai_summary, que llenaba getSmartSummary en cada petición.

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

class MatchSummaryCacheRepositorySqlite {
  // { providerMatchId, summary, firma, generatedAt } o null si no hay fila.
  async get(providerMatchId) {
    const fila = await get(
      `SELECT providerMatchId, summary, firma, generatedAt FROM match_summary_cache WHERE providerMatchId = ?`,
      [String(providerMatchId)]
    );
    if (!fila || !String(fila.summary || "").trim()) return null;
    return fila;
  }

  // NUNCA guarda un resumen vacío. Un texto de error tampoco llega aquí: el job solo llama a set
  // con lo que el modelo contestó bien (ver resumenEquipo.generarResumen).
  async set({ providerMatchId, summary, firma }) {
    const texto = String(summary || "").trim();
    if (!providerMatchId || !texto) return false;
    await run(
      `INSERT INTO match_summary_cache (providerMatchId, summary, firma, generatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(providerMatchId) DO UPDATE SET summary = excluded.summary,
         firma = excluded.firma, generatedAt = excluded.generatedAt`,
      [String(providerMatchId), texto, String(firma || ""), new Date().toISOString()]
    );
    return true;
  }
}

const matchSummaryCacheRepository = new MatchSummaryCacheRepositorySqlite();

module.exports = { matchSummaryCacheRepository };

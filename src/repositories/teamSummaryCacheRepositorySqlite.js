const { db } = require("../db/database");

// Resúmenes con IA de las páginas públicas de equipo (tabla team_summary_cache, creada en
// initializeDatabase). Los escribe SOLO el job runGenerarResumenesEquipos; la página solo lee.

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

class TeamSummaryCacheRepositorySqlite {
  // { slug, teamName, summary, firma, generatedAt } o null si no hay fila.
  async get(slug) {
    const fila = await get(
      `SELECT slug, teamName, summary, firma, generatedAt FROM team_summary_cache WHERE slug = ?`,
      [String(slug)]
    );
    if (!fila || !String(fila.summary || "").trim()) return null;
    return fila;
  }

  // NUNCA guarda un resumen vacío. Un texto de error tampoco llega aquí: el job solo llama a
  // set con lo que el modelo contestó bien (ver resumenEquipo.generarResumen).
  async set({ slug, teamName, summary, firma }) {
    const texto = String(summary || "").trim();
    if (!slug || !texto) return false;
    await run(
      `INSERT INTO team_summary_cache (slug, teamName, summary, firma, generatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET teamName = excluded.teamName, summary = excluded.summary,
         firma = excluded.firma, generatedAt = excluded.generatedAt`,
      [String(slug), String(teamName || ""), texto, String(firma || ""), new Date().toISOString()]
    );
    return true;
  }
}

const teamSummaryCacheRepository = new TeamSummaryCacheRepositorySqlite();

module.exports = { teamSummaryCacheRepository };

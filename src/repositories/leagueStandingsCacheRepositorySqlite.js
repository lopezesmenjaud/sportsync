const { db } = require("../db/database");

// Caché de la tabla de posiciones por liga (tabla league_standings_cache, creada en
// initializeDatabase). Mismo patrón que leagueSeasonsCacheRepositorySqlite. La usa
// src/services/tablaPosiciones.js. Si esta tabla falla, quien llama sigue sin tabla.

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

class LeagueStandingsCacheRepositorySqlite {
  // { season, standings: [...], cachedAt } o null si no hay fila.
  async get(leagueId) {
    const fila = await get(
      `SELECT season, standings, cachedAt FROM league_standings_cache WHERE leagueId = ?`,
      [String(leagueId)]
    );
    if (!fila) return null;
    const standings = JSON.parse(fila.standings);
    if (!Array.isArray(standings) || standings.length === 0) return null;
    return { season: fila.season, standings, cachedAt: fila.cachedAt };
  }

  // NUNCA guarda una tabla vacía: "hay fila" significa "hay posiciones utilizables". Una
  // respuesta vacía del proveedor no pisa una tabla buena que ya estuviera guardada.
  async set(leagueId, season, standings) {
    if (!Array.isArray(standings) || standings.length === 0) return false;
    await run(
      `INSERT INTO league_standings_cache (leagueId, season, standings, cachedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(leagueId) DO UPDATE SET season = excluded.season, standings = excluded.standings, cachedAt = excluded.cachedAt`,
      [String(leagueId), String(season || ""), JSON.stringify(standings), new Date().toISOString()]
    );
    return true;
  }
}

const leagueStandingsCacheRepository = new LeagueStandingsCacheRepositorySqlite();

module.exports = { leagueStandingsCacheRepository };

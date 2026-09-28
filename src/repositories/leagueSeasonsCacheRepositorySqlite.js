const { db } = require("../db/database");

// Caché de temporadas por liga (tabla league_seasons_cache, creada en initializeDatabase).
// Solo la usa syncLeague. Si esta tabla falla por lo que sea, syncLeague sigue: pide la lista al
// proveedor o, si eso también falla, adivina como antes.

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

class LeagueSeasonsCacheRepositorySqlite {
  // { seasons: [...], cachedAt } o null si no hay fila.
  async get(leagueId) {
    const fila = await get(
      `SELECT seasons, cachedAt FROM league_seasons_cache WHERE leagueId = ?`,
      [String(leagueId)]
    );
    if (!fila) return null;
    const seasons = JSON.parse(fila.seasons);
    if (!Array.isArray(seasons) || seasons.length === 0) return null;
    return { seasons, cachedAt: fila.cachedAt };
  }

  // NUNCA guarda una lista vacía: "hay fila" significa "hay temporadas utilizables". Una
  // respuesta vacía del proveedor no pisa una lista buena que ya estuviera guardada.
  async set(leagueId, seasons) {
    if (!Array.isArray(seasons) || seasons.length === 0) return false;
    await run(
      `INSERT INTO league_seasons_cache (leagueId, seasons, cachedAt) VALUES (?, ?, ?)
       ON CONFLICT(leagueId) DO UPDATE SET seasons = excluded.seasons, cachedAt = excluded.cachedAt`,
      [String(leagueId), JSON.stringify(seasons), new Date().toISOString()]
    );
    return true;
  }
}

const leagueSeasonsCacheRepository = new LeagueSeasonsCacheRepositorySqlite();

module.exports = { leagueSeasonsCacheRepository };

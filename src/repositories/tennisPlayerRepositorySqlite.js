const { db } = require("../db/database");

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

class TennisPlayerRepositorySqlite {
  /**
   * Guarda los jugadores vistos en un barrido.
   *
   * Solo INSERT y UPDATE, NUNCA DELETE: un barrido fallido o vacío no puede vaciar la lista.
   *
   * Los campos se refrescan con COALESCE para no PERDER lo que ya sabíamos: si este barrido
   * trae el tour en null pero en uno anterior sí lo dedujimos, se conserva el de antes. El
   * conocimiento sobre un jugador solo se acumula.
   *
   * Devuelve { guardados, renombrados: [{ playerId, antes, ahora }] }.
   * `renombrados` es lo importante: es la única forma de enterarnos de que el proveedor
   * cambió la escritura de un nombre. Ver el aviso en tennisSyncService.
   */
  async upsertMany(jugadores) {
    if (!Array.isArray(jugadores) || jugadores.length === 0) {
      return { guardados: 0, renombrados: [] };
    }

    // Nombres actuales, para comparar ANTES de pisarlos.
    const previos = new Map();
    const ids = jugadores.map((j) => String(j.playerId));
    const TANDA = 400; // tope de parámetros por consulta
    for (let i = 0; i < ids.length; i += TANDA) {
      const lote = ids.slice(i, i + TANDA);
      const marcas = lote.map(() => "?").join(",");
      const filas = await all(
        `SELECT playerId, name FROM tennis_players WHERE playerId IN (${marcas})`,
        lote
      );
      for (const f of filas) previos.set(String(f.playerId), f.name);
    }

    const renombrados = [];
    const ahora = new Date().toISOString();
    let guardados = 0;

    for (const j of jugadores) {
      const playerId = String(j.playerId);
      const anterior = previos.get(playerId);
      if (anterior !== undefined && anterior !== j.name) {
        renombrados.push({ playerId, antes: anterior, ahora: j.name });
      }

      await run(
        `INSERT INTO tennis_players (playerId, name, tour, country, ranking, firstSeenUtc, lastSeenUtc)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(playerId) DO UPDATE SET
           name        = excluded.name,
           tour        = COALESCE(excluded.tour,    tennis_players.tour),
           country     = COALESCE(excluded.country, tennis_players.country),
           ranking     = COALESCE(excluded.ranking, tennis_players.ranking),
           lastSeenUtc = excluded.lastSeenUtc`,
        [playerId, j.name, j.tour || null, j.country || null,
         j.ranking != null ? Number(j.ranking) : null, ahora, ahora]
      );
      guardados++;
    }

    return { guardados, renombrados };
  }

  /**
   * Jugadores de un circuito, ORDENADOS POR RANKING.
   *
   * El orden es lo que hace usable una lista de cientos: arriba quedan los que la gente
   * reconoce (de 484 jugadores medidos, 474 traen ranking, de 1 a 2069) y al final los de
   * ITF. Los que no tienen ranking van hasta abajo, no al principio: `ranking IS NULL` primero
   * en el ORDER BY los manda al fondo, porque en SQLite los NULL ordenan antes por defecto.
   */
  getByTour(tour) {
    return all(
      `SELECT playerId, name, tour, country, ranking
         FROM tennis_players
        WHERE tour = ?
        ORDER BY (ranking IS NULL), ranking ASC, name ASC`,
      [tour]
    );
  }

  /**
   * Jugadores sin circuito deducido. Van al FINAL de las dos listas a propósito: es preferible
   * que alguien salga en un circuito de más a que no salga en ninguno. Son los casos donde ni
   * el jugador, ni su rival, ni el evento dijeron atp/wta — típicamente Challenger e ITF.
   */
  getSinTour() {
    return all(
      `SELECT playerId, name, tour, country, ranking
         FROM tennis_players
        WHERE tour IS NULL
        ORDER BY (ranking IS NULL), ranking ASC, name ASC`
    );
  }

  /** ¿Ya corrió algún barrido? Distingue "todavía no cargamos" de "no hay". */
  async countAll() {
    const filas = await all(`SELECT COUNT(*) AS n FROM tennis_players`);
    return filas[0]?.n || 0;
  }
}

const tennisPlayerRepository = new TennisPlayerRepositorySqlite();

module.exports = { tennisPlayerRepository };

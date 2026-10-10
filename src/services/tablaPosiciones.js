// src/services/tablaPosiciones.js
//
// Tabla de posiciones de una liga, de la caché (league_standings_cache) si tiene menos de 12 h; si
// no, del proveedor (lookupleague.php para la temporada actual + lookuptable.php).
//
// SOLO para las ligas donde el proveedor SÍ tiene tabla. Comprobado en producción (oct 2026): Liga MX
// (4350, 18 filas), La Liga (4335, 20) y Premier (4328, 20), con los nombres cruzando EXACTO contra
// homeParticipantName. Para NFL, NBA, MLB, Champions y F1 el proveedor devuelve VACÍO con cualquier
// temporada: no se le pregunta, para no gastar llamadas en algo que ya se sabe que no existe.
//
// Falla del lado seguro: si la caché no sirve y el proveedor falla o contesta vacío, regresa null y
// el resumen se escribe sin posición ni récord. Nunca se guarda una tabla vacía.

const { leagueStandingsCacheRepository } = require("../repositories/leagueStandingsCacheRepositorySqlite");

const LIGAS_CON_TABLA = new Set(["4350", "4335", "4328"]);
const VIGENCIA_TABLA_MS = 12 * 60 * 60 * 1000;

function tieneTabla(leagueId) {
  return LIGAS_CON_TABLA.has(String(leagueId || ""));
}

// { season, standings, cachedAt, origen: "caché" | "proveedor" } o null.
// contador (opcional): { llamadas } para que el job sepa cuántas peticiones gastó.
async function obtenerTablaDePosiciones(leagueId, provider, contador = { llamadas: 0 }) {
  const clave = String(leagueId || "");
  if (!tieneTabla(clave)) return null;

  try {
    const guardada = await leagueStandingsCacheRepository.get(clave);
    if (guardada && Date.now() - Date.parse(guardada.cachedAt) < VIGENCIA_TABLA_MS) {
      return { ...guardada, origen: "caché" };
    }
  } catch (error) {
    console.log(`[tabla] ${clave}: no se pudo leer league_standings_cache (${error.message})`);
  }

  try {
    contador.llamadas += 1;
    const liga = await provider.getLeague(clave);
    const season = liga && liga.strCurrentSeason;
    if (!season) return null;
    contador.llamadas += 1;
    const standings = await provider.getStandings(clave, season);
    if (!standings.length) return null;
    try {
      await leagueStandingsCacheRepository.set(clave, season, standings);
    } catch (error) {
      console.log(`[tabla] ${clave}: no se pudo guardar en league_standings_cache (${error.message})`);
    }
    return { season, standings, cachedAt: new Date().toISOString(), origen: "proveedor" };
  } catch (error) {
    // Solo el mensaje: nunca la URL, que lleva la llave del proveedor.
    console.log(`[tabla] ${clave}: el proveedor falló (${error.message}); el resumen va sin tabla`);
    return null;
  }
}

// La fila de un equipo en la tabla, por su nombre EXACTO en los partidos (homeParticipantName).
function filaDeEquipo(tabla, nombreBase) {
  if (!tabla || !Array.isArray(tabla.standings)) return null;
  return tabla.standings.find((r) => r && r.strTeam === nombreBase) || null;
}

// ── Qué se juega cada posición, en español ──
//
// strDescription llega en inglés. Se traduce SOLO con src/data/tablaPosiciones.json; si el valor no
// está ahí, null y quien llama omite el renglón: nunca se pasa el inglés al modelo. Cada valor
// desconocido se avisa UNA vez por proceso, para ir completando el archivo.
const TRADUCCIONES = require("../data/tablaPosiciones.json").queEstaEnJuego || {};
const yaAvisados = new Set();

function queEstaEnJuegoEnEspanol(strDescription) {
  const valor = String(strDescription || "").trim();
  if (!valor) return null;
  if (Object.prototype.hasOwnProperty.call(TRADUCCIONES, valor)) return TRADUCCIONES[valor];
  if (!yaAvisados.has(valor)) {
    yaAvisados.add(valor);
    console.warn(`[tabla] strDescription sin traducción: "${valor}" — se omite. Agrégalo a src/data/tablaPosiciones.json`);
  }
  return null;
}

module.exports = {
  obtenerTablaDePosiciones,
  filaDeEquipo,
  queEstaEnJuegoEnEspanol,
  tieneTabla,
  LIGAS_CON_TABLA,
  VIGENCIA_TABLA_MS,
};

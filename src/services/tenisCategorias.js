// src/services/tenisCategorias.js
//
// Dado un partido, dice a qué circuito (ATP / WTA) y a qué categoría de torneo
// pertenece ("grand-slam", "atp-250", ...), según src/data/tenisTorneos.json.
//
// Lo usa subscriptionMatchService para las suscripciones de tenis POR CATEGORÍA
// (competitionKey = "grand-slam-atp", "atp-250", ...). Las de clave vieja (4464/4517)
// y las de jugador no pasan por aquí. También lo usan los reportes y la conversión.
//
// Las reglas, en orden:
//   1. Si el deporte no es tenis, no aplica.
//   2. Sin competitionKey  -> es challenger, ITF o juvenil.
//   3. Clave que no está en clavesDeCircuito -> desconocida.
//   4. Se busca el torneo por competitionName contra "nombre" y cada "alias",
//      sin distinguir mayúsculas y sin espacios sobrantes.
//   5. No está -> console.warn con el nombre exacto y la clave (una vez por
//      nombre+clave en cada proceso, para no inundar el log).
//   6. Está, pero ese circuito es null en la tabla -> ese circuito no juega ahí.

const tabla = require("../data/tenisTorneos.json");

const MOTIVOS = {
  NO_ES_TENIS: "no es tenis",
  SIN_CLAVE: "sin clave",
  CLAVE_DESCONOCIDA: "clave desconocida",
  FUERA_DE_LA_TABLA: "fuera de la tabla",
  CIRCUITO_NO_JUEGA: "ese circuito no juega ahí",
};

function normalizar(texto) {
  return String(texto == null ? "" : texto).trim().replace(/\s+/g, " ").toLowerCase();
}

// nombre o alias normalizado -> torneo de la tabla
const torneoPorNombre = new Map();
for (const torneo of tabla.torneos) {
  for (const nombre of [torneo.nombre, ...(torneo.alias || [])]) {
    torneoPorNombre.set(normalizar(nombre), torneo);
  }
}

const yaAvisados = new Set();

function clasificarTorneoTenis(match) {
  const sinCategoria = (motivo, circuito = null, torneo = null) =>
    ({ circuito, categoria: null, torneo, motivo });

  if (normalizar(match && match.sport) !== "tennis") {
    return sinCategoria(MOTIVOS.NO_ES_TENIS);
  }

  const clave = match.competitionKey == null ? "" : String(match.competitionKey).trim();
  if (clave === "") {
    return sinCategoria(MOTIVOS.SIN_CLAVE);
  }

  const circuito = tabla.clavesDeCircuito[clave];
  if (!circuito) {
    return sinCategoria(MOTIVOS.CLAVE_DESCONOCIDA);
  }

  const torneo = torneoPorNombre.get(normalizar(match.competitionName));
  if (!torneo) {
    const llaveAviso = `${match.competitionName}|${clave}`;
    if (!yaAvisados.has(llaveAviso)) {
      yaAvisados.add(llaveAviso);
      console.warn(
        `[tenisCategorias] Torneo de circuito fuera de la tabla: "${match.competitionName}" (clave ${clave}, ${circuito})`
      );
    }
    return sinCategoria(MOTIVOS.FUERA_DE_LA_TABLA, circuito);
  }

  const categoria = torneo[circuito.toLowerCase()];
  if (!categoria) {
    return sinCategoria(MOTIVOS.CIRCUITO_NO_JUEGA, circuito, torneo.nombre);
  }

  return { circuito, categoria, torneo: torneo.nombre, motivo: null };
}

const clavesDeCategoria = new Set(tabla.categorias.map(c => c.clave));

// ¿Esta competitionKey es una categoría de la tabla ("grand-slam-atp", "atp-250"...)?
// Las claves de circuito viejas (4464/4517) NO lo son.
function esClaveDeCategoria(clave) {
  return clave != null && clavesDeCategoria.has(String(clave));
}

// Las categorías que juega un circuito, sacadas de la tabla: las que aparecen en su
// columna (atp o wta). Así la conversión nunca le mete a un circuito una categoría del otro.
function categoriasDelCircuito(circuito) {
  const columna = String(circuito).toLowerCase();
  const usadas = new Set(tabla.torneos.map(t => t[columna]).filter(Boolean));
  return tabla.categorias.filter(c => usadas.has(c.clave));
}

// Mismos valores que traduce SPORT_NAME_MAP (syncService.js) a "tennis". No se importa de
// ahí para que este módulo siga siendo solo datos y no arrastre proveedores al cargarse.
function esTenis(sport) {
  return ["tenis", "tennis"].includes(normalizar(sport));
}

// Plan para pasar las suscripciones de tenis por CIRCUITO (4464/4517, sin jugador) a
// suscripciones por categoría. Función pura: no lee ni escribe la base.
//   - Cada suscripción de circuito se borra y se reemplaza por las categorías de SU
//     circuito: ATP Tour -> las de ATP, WTA Tour -> las de WTA.
//   - Las de jugador (con teamName, con o sin circuito) NO se tocan.
//   - No se crea una categoría que el usuario ya tenga.
// La usan la conversión Y el reporte de antes/después: los dos calculan lo mismo.
function planDeConversion(subs) {
  const aBorrar = [];
  const aCrear = [];
  const yaTiene = new Set(
    subs.filter(s => !s.teamName && esTenis(s.sport)).map(s => `${s.userId}|${s.competitionKey}`)
  );

  for (const sub of subs) {
    if (sub.teamName || !esTenis(sub.sport)) continue;
    const circuito = tabla.clavesDeCircuito[String(sub.competitionKey == null ? "" : sub.competitionKey).trim()];
    if (!circuito) continue;

    aBorrar.push(sub);
    for (const cat of categoriasDelCircuito(circuito)) {
      const llave = `${sub.userId}|${cat.clave}`;
      if (yaTiene.has(llave)) continue;
      yaTiene.add(llave);
      aCrear.push({
        userId: sub.userId,
        sport: "tenis",
        competitionKey: cat.clave,
        competitionName: cat.nombre,
        teamName: null,
      });
    }
  }
  return { aBorrar, aCrear };
}

// ── Dónde verlo ──
//
// El tenis NO se le pregunta al modelo: broadcasting_cache es UNIQUE(competitionKey, country) y
// todos los partidos de ATP traen la misma clave 4464, así que compartían UNA fila por país y el
// primero que abría "dónde verlo" decidía lo que veían todos los demás.
//
// Regla, con la clave sola (no hace falta que el torneo esté en la lista):
//   - clave de circuito (clavesDeCircuito) y país México -> texto y link de la tabla;
//   - cualquier otra cosa -> null, y quien llame muestra su texto honesto.
// El texto y el link se editan en tenisTorneos.json, sin tocar código.

const PAISES_MEXICO = new Set(["mexico", "méxico", "mx"]);

function esClaveDeCircuito(clave) {
  return clave != null && Object.prototype.hasOwnProperty.call(tabla.clavesDeCircuito, String(clave).trim());
}

const clavesDesconocidasAvisadas = new Set();

// Devuelve { texto, url } o null. pais: el nombre que manda el cliente ("Mexico").
function dondeVerTenis(competitionKey, pais) {
  const clave = competitionKey == null ? "" : String(competitionKey).trim();
  if (clave !== "" && !esClaveDeCircuito(clave) && !clavesDesconocidasAvisadas.has(clave)) {
    clavesDesconocidasAvisadas.add(clave);
    console.warn(`[tenisCategorias] Dónde verlo: partido de tenis con clave desconocida "${clave}"`);
  }
  if (!esClaveDeCircuito(clave) || !PAISES_MEXICO.has(normalizar(pais))) return null;
  if (!tabla.dondeVerPorDefecto) return null;
  return { texto: tabla.dondeVerPorDefecto, url: tabla.dondeVerPorDefectoUrl || null };
}

module.exports = {
  clasificarTorneoTenis,
  esClaveDeCircuito,
  dondeVerTenis,
  esClaveDeCategoria,
  categoriasDelCircuito,
  planDeConversion,
  MOTIVOS,
  categorias: tabla.categorias,
};

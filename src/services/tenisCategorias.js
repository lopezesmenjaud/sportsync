// src/services/tenisCategorias.js
//
// Dado un partido, dice a qué circuito (ATP / WTA) y a qué categoría de torneo
// pertenece ("grand-slam", "atp-250", ...), según src/data/tenisTorneos.json.
//
// Hoy NADIE lo usa para decidir nada: solo lo llama el reporte de solo lectura
// src/jobs/runReporteCategoriasTenis.js. No toca suscripciones ni sincronización.
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

module.exports = { clasificarTorneoTenis, MOTIVOS, categorias: tabla.categorias };

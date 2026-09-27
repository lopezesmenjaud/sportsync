// src/services/seleccionesConfederaciones.js
//
// Dado un partido de fútbol, dice si es de selecciones nacionales y, si lo es, a qué
// confederación y a qué rama (varonil / femenil) pertenece, según src/data/selecciones.json.
//
// Hoy NO lo usa ni el sync, ni matchAppliesToSubscription, ni el picker: solo el reporte
// (runReporteSelecciones.js). Es la pieza que usarán las suscripciones por confederación.
//
// Las reglas de clasificarPartidoSelecciones, en orden:
//   1. Si el deporte no es fútbol, no aplica.
//   2. Sin competitionKey -> no se puede decir nada.
//   3. Clave de una confederación (o de "mundial") -> esa confederación y su rama.
//   4. Clave de amistoso (4562 / 5400) -> sin confederación: solo llega siguiendo a la selección.
//   5. Clave en otrasConocidas -> de selecciones, pero a propósito sin confederación.
//   6. Ninguna de las anteriores: si el nombre de la competencia SUENA a selecciones
//      (pistasDeNombre, y no noSonDeSelecciones) -> console.warn con el nombre y la clave, una
//      vez por clave en cada proceso. Si no suena, es de clubes y se deja pasar callado.
//
// La rama sale SIEMPRE de la tabla, nunca de strGender: el proveedor tiene fichas mal cargadas
// (la de "Mexico Women" dice "Male").

const tabla = require("../data/selecciones.json");

const MOTIVOS = {
  NO_ES_FUTBOL: "no es fútbol",
  SIN_CLAVE: "sin clave",
  AMISTOSO: "amistoso (sin confederación)",
  OTRA_CONOCIDA: "de selecciones, fuera de confederación",
  DESCONOCIDA_DE_SELECCIONES: "parece de selecciones pero no está en la tabla",
  NO_ES_DE_SELECCIONES: "no es de selecciones",
};

const RAMAS = ["varonil", "femenil"];

function normalizar(texto) {
  return String(texto == null ? "" : texto).trim().replace(/\s+/g, " ").toLowerCase();
}

function limpiarClave(clave) {
  return clave == null ? "" : String(clave).trim();
}

// idLeague -> { confederacion, rama, base }
//
// Una clave repetida (en dos confederaciones, o en las dos ramas, o además como amistoso u
// otraConocida) haría ambigua la clasificación, así que truena AL CARGAR con el mensaje exacto.
// Mejor que el deploy falle a que un partido llegue a la confederación equivocada en silencio.
const porClave = new Map();

function registrar(clave, destino) {
  const k = limpiarClave(clave);
  if (porClave.has(k)) {
    const antes = porClave.get(k);
    throw new Error(
      `[seleccionesConfederaciones] La clave ${k} está dos veces en selecciones.json: ` +
      `${antes.confederacion || antes.tipo}/${antes.rama} y ${destino.confederacion || destino.tipo}/${destino.rama}`
    );
  }
  porClave.set(k, destino);
}

for (const conf of tabla.confederaciones) {
  for (const rama of RAMAS) {
    for (const comp of conf[rama] || []) {
      registrar(comp.clave, { tipo: "confederacion", confederacion: conf.clave, rama, base: comp.base });
    }
  }
}
for (const rama of RAMAS) {
  const amistoso = tabla.amistosos[rama];
  if (amistoso) registrar(amistoso.clave, { tipo: "amistoso", confederacion: null, rama, base: amistoso.base });
}
for (const otra of tabla.otrasConocidas || []) {
  registrar(otra.clave, { tipo: "otra", confederacion: null, rama: otra.rama, base: otra.base });
}

// La competencia de membresía tiene que ser de la lista de ESA confederación y ESA rama. Si no,
// la lista de selecciones se armaría con los miembros de otra: truena al cargar, como arriba.
for (const conf of tabla.confederaciones) {
  for (const rama of RAMAS) {
    const k = conf.membresia && conf.membresia[rama];
    if (k == null) continue;
    const r = porClave.get(limpiarClave(k));
    if (!r || r.tipo !== "confederacion" || r.confederacion !== conf.clave || r.rama !== rama) {
      throw new Error(`[seleccionesConfederaciones] membresia.${rama} de ${conf.clave} (${k}) no está en su lista ${rama}.`);
    }
  }
}

const clavesDeConfederacion = new Set(tabla.confederaciones.map(c => c.clave));
const pistas = (tabla.pistasDeNombre || []).map(normalizar);
const noSon = (tabla.noSonDeSelecciones || []).map(normalizar);

// Mismos valores que traduce SPORT_NAME_MAP (syncService.js) a "football", más "soccer", que es
// como lo manda el proveedor crudo. No se importa de allá para que este módulo siga siendo solo
// datos y no arrastre repositorios (y con ellos la base) al cargarse.
function esFutbol(sport) {
  return ["futbol", "football", "soccer"].includes(normalizar(sport));
}

function suenaASelecciones(nombreCompetencia) {
  const n = normalizar(nombreCompetencia);
  if (n === "") return false;
  if (noSon.some(p => n.includes(p))) return false;
  return pistas.some(p => n.includes(p));
}

// ¿Esta clave es una confederación de la tabla ("concacaf", "uefa", ..., "mundial")?
// Es la clave de SUSCRIPCIÓN, no un idLeague: los idLeague son numéricos y nunca chocan.
function esClaveDeConfederacion(clave) {
  return clavesDeConfederacion.has(normalizar(clave));
}

// Búsqueda pura por clave, sin avisos: { confederacion, rama, base } o null.
// Solo competencias de confederación; amistosos y otrasConocidas regresan null.
function confederacionDeCompetencia(competitionKey) {
  const r = porClave.get(limpiarClave(competitionKey));
  if (!r || r.tipo !== "confederacion") return null;
  return { confederacion: r.confederacion, rama: r.rama, base: r.base };
}

function esAmistoso(competitionKey) {
  const r = porClave.get(limpiarClave(competitionKey));
  return !!r && r.tipo === "amistoso";
}

const yaAvisados = new Set();

// Devuelve { confederacion, rama, esDeSelecciones, motivo }.
// motivo es null cuando el partido SÍ cae en una confederación.
function clasificarPartidoSelecciones(match) {
  const fuera = (motivo, extra = {}) =>
    ({ confederacion: null, rama: null, esDeSelecciones: false, motivo, ...extra });

  if (!esFutbol(match && match.sport)) return fuera(MOTIVOS.NO_ES_FUTBOL);

  const clave = limpiarClave(match.competitionKey);
  if (clave === "") return fuera(MOTIVOS.SIN_CLAVE);

  const r = porClave.get(clave);
  if (r && r.tipo === "confederacion") {
    return { confederacion: r.confederacion, rama: r.rama, esDeSelecciones: true, motivo: null };
  }
  if (r && r.tipo === "amistoso") return fuera(MOTIVOS.AMISTOSO, { rama: r.rama, esDeSelecciones: true });
  if (r && r.tipo === "otra") return fuera(MOTIVOS.OTRA_CONOCIDA, { rama: r.rama, esDeSelecciones: true });

  if (suenaASelecciones(match.competitionName)) {
    if (!yaAvisados.has(clave)) {
      yaAvisados.add(clave);
      console.warn(
        `[seleccionesConfederaciones] Competencia que parece de selecciones y no está en la tabla: "${match.competitionName}" (clave ${clave})`
      );
    }
    return fuera(MOTIVOS.DESCONOCIDA_DE_SELECCIONES);
  }

  return fuera(MOTIVOS.NO_ES_DE_SELECCIONES);
}

// Las competencias de una confederación en una rama, tal como están en la tabla:
// [{ clave, base, _revisar? }]. Confederación o rama desconocida -> [].
function competenciasDeConfederacion(confederacion, rama) {
  const conf = tabla.confederaciones.find(c => c.clave === normalizar(confederacion));
  if (!conf || !RAMAS.includes(rama)) return [];
  return (conf[rama] || []).map(c => ({ ...c }));
}

// La competencia que define quién es miembro de una confederación en una rama (su eliminatoria
// o su campeonato continental). Sirve para armar la lista de selecciones, no para clasificar
// partidos. null si la tabla no tiene una ("mundial", o la OFC femenil).
function claveDeMembresia(confederacion, rama) {
  const conf = tabla.confederaciones.find(c => c.clave === normalizar(confederacion));
  const k = conf && conf.membresia ? conf.membresia[rama] : null;
  return k == null ? null : String(k);
}

module.exports = {
  clasificarPartidoSelecciones,
  claveDeMembresia,
  confederacionDeCompetencia,
  competenciasDeConfederacion,
  esClaveDeConfederacion,
  esAmistoso,
  MOTIVOS,
  RAMAS,
  confederaciones: tabla.confederaciones.map(c => ({ clave: c.clave, nombre: c.nombre })),
  amistosos: tabla.amistosos,
  otrasConocidas: tabla.otrasConocidas || [],
};

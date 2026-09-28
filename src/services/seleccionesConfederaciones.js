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

// ── Suscripciones por confederación ──
//
// competitionKey = "<confederacion>-<rama>": "concacaf-varonil", "mundial-femenil"... Son 14.
// No chocan con nada que exista: los idLeague son numéricos, las categorías de tenis son
// "grand-slam-atp"/"atp-250"... y las viejas de selecciones empiezan con "national_".

const suscripciones = [];
for (const conf of tabla.confederaciones) {
  for (const rama of RAMAS) {
    suscripciones.push({
      clave: `${conf.clave}-${rama}`,
      confederacion: conf.clave,
      nombre: conf.nombre,
      rama,
      competencias: (conf[rama] || []).map(c => ({ clave: String(c.clave), base: c.base })),
    });
  }
}
const suscripcionPorClave = new Map(suscripciones.map(s => [s.clave, s]));

// { confederacion, rama } si la clave es una de las 14; null si no.
function leerClaveDeSuscripcion(clave) {
  const s = suscripcionPorClave.get(normalizar(clave));
  return s ? { confederacion: s.confederacion, rama: s.rama } : null;
}

function esClaveDeSuscripcionSelecciones(clave) {
  return suscripcionPorClave.has(normalizar(clave));
}

// ¿Esta suscripción es POR CONFEDERACIÓN? Sin teamName y con una de las 14 claves. Las de
// selección (teamName "Mexico") son suscripciones de equipo de siempre y NO pasan por aquí.
function esSuscripcionDeSelecciones(subscription) {
  return !!subscription && !subscription.teamName && esClaveDeSuscripcionSelecciones(subscription.competitionKey);
}

// ¿Este partido le llega a esta suscripción por confederación? Su competencia tiene que estar en
// la lista de ESA confederación y ESA rama, según clasificarPartidoSelecciones. Un amistoso
// nunca casa: el clasificador lo regresa sin confederación.
function casaConSuscripcionDeSelecciones(match, subscription) {
  const k = leerClaveDeSuscripcion(subscription && subscription.competitionKey);
  if (!k) return false;
  const r = clasificarPartidoSelecciones(match);
  return r.confederacion === k.confederacion && r.rama === k.rama;
}

// Los idLeague que hay que sincronizar para una suscripción por confederación ([] si no es una).
function competenciasDeSuscripcion(clave) {
  const s = suscripcionPorClave.get(normalizar(clave));
  return s ? s.competencias.map(c => c.clave) : [];
}

// ── Lista de selecciones por confederación y rama ──
//
// El proveedor no tiene una lista por confederación: search_all_teams.php?l=<competencia> regresa
// solo las selecciones cuya competencia PRINCIPAL es ésa. Quien llama junta las listas de todas
// las competencias de la tabla y las pasa aquí. Una selección entra a un grupo si entre sus
// competencias (idLeague a idLeague7) está la de membresía de ese grupo, o si está en equiposAMano.

const equiposAMano = tabla.equiposAMano || [];
for (const e of equiposAMano) {
  if (!clavesDeConfederacion.has(e.confederacion) || !RAMAS.includes(e.rama)) {
    throw new Error(`[seleccionesConfederaciones] equiposAMano: "${e.equipo}" trae confederación o rama inválida (${e.confederacion}/${e.rama}).`);
  }
}

// Todas las competencias cuyas listas de equipos hay que pedir para armar los grupos.
function competenciasParaListas() {
  const claves = new Map(); // clave -> base
  for (const conf of tabla.confederaciones) for (const rama of RAMAS) for (const c of conf[rama] || []) claves.set(String(c.clave), c.base);
  for (const rama of RAMAS) if (tabla.amistosos[rama]) claves.set(String(tabla.amistosos[rama].clave), tabla.amistosos[rama].base);
  for (const o of tabla.otrasConocidas || []) claves.set(String(o.clave), o.base);
  return [...claves].map(([clave, base]) => ({ clave, base }));
}

/**
 * Función pura. equipos: fichas crudas del proveedor (strTeam, idTeam, idLeague..idLeague7, ...).
 * Devuelve { grupos: Map("concacaf-varonil" -> [{ id, name, badge, country, aMano }]), sinConfederacion: [nombres] }.
 */
function armarListasDeSelecciones(equipos) {
  const membresiaAGrupo = new Map();
  for (const conf of tabla.confederaciones) {
    for (const rama of RAMAS) {
      const k = conf.membresia && conf.membresia[rama];
      if (k != null) membresiaAGrupo.set(String(k), `${conf.clave}-${rama}`);
    }
  }
  const aManoPorNombre = new Map(equiposAMano.map(e => [e.equipo, `${e.confederacion}-${e.rama}`]));

  const grupos = new Map(suscripciones.map(s => [s.clave, new Map()])); // clave -> Map(nombre -> equipo)
  const porNombre = new Map();
  for (const t of equipos || []) if (t && t.strTeam && !porNombre.has(t.strTeam)) porNombre.set(t.strTeam, t);

  const sinConfederacion = [];
  for (const t of porNombre.values()) {
    const suyas = [1, 2, 3, 4, 5, 6, 7].map(i => t[i === 1 ? "idLeague" : `idLeague${i}`]).filter(Boolean).map(String);
    const destino = new Set(suyas.map(k => membresiaAGrupo.get(k)).filter(Boolean));
    if (aManoPorNombre.has(t.strTeam)) destino.add(aManoPorNombre.get(t.strTeam));
    if (destino.size === 0) { sinConfederacion.push(t.strTeam); continue; }
    const equipo = { id: t.idTeam || null, name: t.strTeam, badge: t.strBadge || null, country: t.strCountry || "", aMano: aManoPorNombre.has(t.strTeam) };
    for (const g of destino) grupos.get(g).set(t.strTeam, equipo);
  }
  // Los de equiposAMano entran aunque el proveedor no los haya regresado en ninguna lista: para
  // seguirlos solo hace falta el nombre exacto, que ya está comprobado.
  for (const e of equiposAMano) {
    const g = grupos.get(`${e.confederacion}-${e.rama}`);
    if (!g.has(e.equipo)) g.set(e.equipo, { id: null, name: e.equipo, badge: null, country: "", aMano: true });
  }

  const salida = new Map();
  for (const [clave, m] of grupos) salida.set(clave, [...m.values()].sort((a, b) => a.name.localeCompare(b.name)));
  return { grupos: salida, sinConfederacion: sinConfederacion.sort() };
}

module.exports = {
  clasificarPartidoSelecciones,
  claveDeMembresia,
  leerClaveDeSuscripcion,
  esClaveDeSuscripcionSelecciones,
  esSuscripcionDeSelecciones,
  casaConSuscripcionDeSelecciones,
  competenciasDeSuscripcion,
  competenciasParaListas,
  armarListasDeSelecciones,
  suscripciones,
  equiposAMano,
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

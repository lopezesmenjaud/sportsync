// src/jobs/runBarridoCatalogo.js
//
// Barrido del catálogo público: recorre TODAS las claves de CLAVES_PUBLICAS (el catálogo de
// competencias.json más las competencias de selecciones) y le pide a TheSportsDB sus partidos
// próximos, SIN depender de que alguien esté suscrito. Hoy el sync solo recorre suscripciones:
// una competencia que nadie sigue nunca se consulta, y sus partidos no llegan a la tabla matches
// ni, por lo tanto, al directorio /equipos ni al sitemap.
//
// Usa EXACTAMENTE el camino de lectura de syncLeague (traerEventosDeLiga en syncService.js):
// eventsseason primero, con las temporadas que decide reglaTemporadas, y eventsnextleague solo
// de respaldo. La ventana es la misma: hoy → +30 días.
//
// Qué NO hace, nunca:
//   - No toca calendarios de usuarios ni nada de Google: no lee google_accounts, no crea
//     calendarios, no manda eventos. Solo lee de la fuente y compara contra la tabla matches.
//   - No llama a initializeDatabase(): usa la conexión de src/db/database.js, igual que los
//     demás jobs, y las tablas ya las creó el servidor al arrancar.
//   - No escribe la caché de temporadas (league_seasons_cache): la lista se le pide directo al
//     proveedor, a diferencia de syncLeague. Cuesta una llamada más por clave y a cambio el
//     ensayo no escribe nada.
//
// Disciplina de escrituras masivas:
//   Sin CONFIRM=1 NO se escribe nada: por clave imprime cuántos partidos trae la fuente,
//   cuántos ya están en matches y cuántos serían nuevos o cambiaron; cuántos equipos distintos
//   trae y cuántos son nuevos (su nombre no aparece hoy en matches ni de local ni de visitante).
//   Al final, el total de equipos nuevos sin repetir: es lo que cuesta generarles resumen.
//   SOLO=5280,4562        -> solo esas claves, y lista cada partido nuevo o cambiado.
//   CONFIRM=1 MAX=5       -> guarda en matches como mucho 5 partidos (nuevos o cambiados).
//   CONFIRM=1             -> guarda todos los nuevos o cambiados.
//   Se pueden combinar: CONFIRM=1 SOLO=5280 guarda solo los de ésa.
//   Guardar = matchRepository.save(), lo mismo que hace syncLeague. Nada más.
//
// Dos formas de correrlo:
//   - A mano, desde la terminal (abajo). Solo en ese caso termina con process.exit.
//   - Importado: barridoCatalogo({ confirm, max, solo, pausaMs }). Importar este archivo NO corre
//     nada ni termina el proceso: solo expone la función. NO está en el scheduler.
//
// Uso (en Render):
//   cd ~/project/src && node src/jobs/runBarridoCatalogo.js
//   cd ~/project/src && SOLO=5280,4562 node src/jobs/runBarridoCatalogo.js
//   cd ~/project/src && CONFIRM=1 MAX=5 node src/jobs/runBarridoCatalogo.js

const { getProvider } = require("../providers");
const { traerEventosDeLiga, normalizeSport, getSyncDateRange, nuevoContador } = require("../services/syncService");
const { detectMatchChanges } = require("../services/matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { db } = require("../db/database");
const { clavesDelCatalogo } = require("../routes/partidoPublico");
const { competenciasParaListas } = require("../services/seleccionesConfederaciones");
const COMPETENCIAS = require("../data/competencias.json").competencias;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Los nombres de equipo que ya conocemos: los que aparecen hoy como local o visitante en matches.
// Solo lectura. Se lee UNA vez, al arrancar y antes de cualquier escritura, para que "equipo
// nuevo" signifique nuevo respecto a hoy aunque se corra con CONFIRM=1.
function equiposConocidos() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT homeParticipantName AS nombre FROM matches WHERE homeParticipantName IS NOT NULL
       UNION
       SELECT awayParticipantName FROM matches WHERE awayParticipantName IS NOT NULL`,
      [],
      (err, filas) => (err ? reject(err) : resolve(new Set((filas || []).map((f) => f.nombre))))
    );
  });
}

// Los equipos distintos de una lista de partidos. Sin nombre (una sesión de F1) no cuenta.
function equiposDe(partidos) {
  const nombres = new Set();
  for (const m of partidos) {
    for (const n of [m.homeParticipantName, m.awayParticipantName]) {
      if (n && String(n).trim()) nombres.add(n);
    }
  }
  return nombres;
}

// Nombre y deporte de cada clave. Del catálogo si está; si no, es de selecciones: fútbol, con el
// nombre que trae su tabla (src/data/selecciones.json).
function fichaDeClave(clave) {
  const delCatalogo = COMPETENCIAS.find((c) => String(c.clave) === clave);
  if (delCatalogo) return { nombre: delCatalogo.nombrePublico, sport: delCatalogo.sport || "futbol" };
  const deSelecciones = competenciasParaListas().find((c) => c.clave === clave);
  return { nombre: deSelecciones ? deSelecciones.base : "(sin nombre)", sport: "futbol" };
}

function renglonDePartido(m) {
  const fecha = (m.currentStartUtc || m.scheduledStartUtc || "sin fecha").replace("T", " ").replace(/:00(\.000)?Z$/, " UTC");
  // Sin equipos (una sesión de F1): el nombre del evento.
  const quien = m.homeParticipantName || m.awayParticipantName
    ? `${m.homeParticipantName || "?"} vs ${m.awayParticipantName || "?"}`
    : m.eventName || "(sin nombre)";
  return `${fecha} | ${quien}`;
}

// confirm: guardar (CONFIRM=1). max: tope de partidos guardados (MAX). solo: claves a revisar
// (SOLO); con solo, además lista cada partido nuevo o cambiado. Devuelve los conteos de la corrida.
// Si algo truena (la base, por ejemplo), la promesa se rechaza: quien llama decide qué hacer.
async function barridoCatalogo({ confirm = false, max = Infinity, solo = [], pausaMs = 1000 } = {}) {
  const CONFIRM = confirm;
  const MAX = max;
  const SOLO = solo.map(String);
  const PAUSA_MS = pausaMs;
  const provider = getProvider("the_sports_db");
  const contador = nuevoContador();
  const { fromDate, toDate } = getSyncDateRange();

  const conocidos = await equiposConocidos();
  const equiposNuevosTotal = new Set(); // sin repetir entre claves: un equipo en dos claves cuenta una vez

  const todas = clavesDelCatalogo();
  let claves = todas;
  if (SOLO.length) {
    const faltan = SOLO.filter((c) => !todas.includes(c));
    if (faltan.length) console.log(`⚠ Estas claves no están en CLAVES_PUBLICAS: ${faltan.join(", ")}`);
    claves = todas.filter((c) => SOLO.includes(c));
  }

  console.log("========================================================");
  console.log(` BARRIDO DEL CATÁLOGO  (${CONFIRM ? "CONFIRM=1: SE GUARDA EN matches" : "ensayo: NO se guarda nada"})`);
  console.log(` Claves a revisar: ${claves.length} de ${todas.length}${Number.isFinite(MAX) ? ` | MAX=${MAX}` : ""}${SOLO.length ? ` | SOLO=${SOLO.join(",")}` : ""}`);
  console.log(` Ventana (la misma de syncLeague): ${fromDate} → ${toDate}`);
  console.log(` Equipos que ya conocemos (local o visitante en matches): ${conocidos.size}`);
  console.log("========================================================");

  const resumen = {
    claves: claves.length, conPartidos: 0, sinPartidos: 0, conError: 0,
    enFuente: 0, yaIguales: 0, cambiados: 0, nuevos: 0, guardados: 0, pendientesPorMax: 0,
  };

  for (const clave of claves) {
    const { nombre, sport } = fichaDeClave(clave);
    const llamadasAntes = contador.llamadas;
    const erroresAntes = contador.errores;

    // La lista de temporadas, directo del proveedor y SIN guardarla. Sin lista, la regla adivina
    // las temporadas exactamente como syncLeague cuando su lista falla.
    let lista = null;
    let origenLista;
    contador.llamadas += 1;
    try {
      const temporadas = await provider.getSeasons(clave);
      lista = temporadas.length ? temporadas : null;
      origenLista = lista ? `${lista.length} temporadas` : "vino vacía, se adivina";
    } catch (error) {
      contador.errores += 1;
      origenLista = `falló (${error.message}), se adivina`;
    }

    const { rawMatches, busqueda, delRespaldo } =
      await traerEventosDeLiga(provider, clave, normalizeSport(sport), lista, contador);
    const partidos = rawMatches.map((e) => provider.normalizeMatch(e));

    const nuevos = [];
    const cambiados = [];
    let iguales = 0;
    for (const m of partidos) {
      const viejo = await matchRepository.getByProviderMatchId(m.providerMatchId);
      const cambios = detectMatchChanges(viejo, m);
      if (!viejo) nuevos.push(m);
      else if (cambios.length) cambiados.push({ m, cambios });
      else iguales += 1;
    }

    const camino = busqueda.camino === "variante" ? `eventsseason "${busqueda.temporada}"`
      : busqueda.camino === "extra" ? `eventsseason "${busqueda.temporada}" (temporada extra) + ${delRespaldo} de eventsnextleague`
      : `eventsnextleague (respaldo): ${delRespaldo}`;
    const fallaron = contador.errores - erroresAntes;

    // Equipo nuevo = su nombre no aparece hoy ni como local ni como visitante en matches.
    const equipos = equiposDe(partidos);
    const equiposNuevos = [...equipos].filter((n) => !conocidos.has(n)).sort();
    for (const n of equiposNuevos) equiposNuevosTotal.add(n);

    resumen.enFuente += partidos.length;
    resumen.yaIguales += iguales;
    resumen.cambiados += cambiados.length;
    resumen.nuevos += nuevos.length;
    if (fallaron) resumen.conError += 1;
    if (partidos.length) resumen.conPartidos += 1; else resumen.sinPartidos += 1;

    console.log(`\n· ${clave} ${nombre}`);
    console.log(`    partidos en la fuente: ${partidos.length} | ya en matches sin cambios: ${iguales} | con cambios: ${cambiados.length} | nuevos: ${nuevos.length}`);
    console.log(`    equipos distintos: ${equipos.size} | equipos nuevos: ${equiposNuevos.length}${
      equiposNuevos.length ? ` (${(SOLO.length ? equiposNuevos : equiposNuevos.slice(0, 8)).join(", ")}${!SOLO.length && equiposNuevos.length > 8 ? ", …" : ""})` : ""
    }`);
    console.log(`    camino: ${camino} | lista: ${origenLista} | llamadas: ${contador.llamadas - llamadasAntes}${fallaron ? ` | FALLARON ${fallaron}` : ""}`);

    // Con SOLO se lista todo; sin SOLO, una muestra para no ahogar el reporte.
    const muestra = SOLO.length ? Infinity : 3;
    for (const m of nuevos.slice(0, muestra)) console.log(`      + nuevo:   ${renglonDePartido(m)}`);
    if (nuevos.length > muestra) console.log(`      … y ${nuevos.length - muestra} nuevos más (SOLO=${clave} para verlos todos)`);
    for (const { m, cambios } of cambiados.slice(0, muestra)) {
      console.log(`      ~ cambió:  ${renglonDePartido(m)} (${cambios.map((c) => c.type).join(", ")})`);
    }
    if (cambiados.length > muestra) console.log(`      … y ${cambiados.length - muestra} con cambios más`);

    if (CONFIRM) {
      for (const m of [...nuevos, ...cambiados.map((c) => c.m)]) {
        if (resumen.guardados >= MAX) { resumen.pendientesPorMax += 1; continue; }
        await matchRepository.save(m);
        resumen.guardados += 1;
      }
    }

    await dormir(PAUSA_MS);
  }

  console.log("\n========================================================");
  console.log(` Claves con partidos en la ventana: ${resumen.conPartidos} | sin partidos: ${resumen.sinPartidos} | con llamadas fallidas: ${resumen.conError}`);
  console.log(` Partidos en la fuente: ${resumen.enFuente}`);
  console.log(`   ya en matches sin cambios: ${resumen.yaIguales} | con cambios: ${resumen.cambiados} | nuevos: ${resumen.nuevos}`);
  console.log(` Equipos nuevos en todo el barrido (sin repetir entre claves): ${equiposNuevosTotal.size}`);
  if (CONFIRM) console.log(` Guardados en matches: ${resumen.guardados}${resumen.pendientesPorMax ? ` | pendientes por MAX=${MAX}: ${resumen.pendientesPorMax}` : ""}`);
  console.log(` Llamadas a TheSportsDB: ${contador.llamadas} | fallaron: ${contador.errores}`);
  if (!CONFIRM) console.log(" Ensayo: no se escribió nada. Para guardar, CONFIRM=1 (y MAX=5 la primera vez).");
  console.log("========================================================");
  resumen.equiposNuevos = equiposNuevosTotal.size;
  resumen.listaEquiposNuevos = [...equiposNuevosTotal].sort();
  return resumen;
}

module.exports = { barridoCatalogo };

// Solo si se corre a mano (node src/jobs/runBarridoCatalogo.js). Importado no entra aquí: ni lee
// las variables de entorno ni termina el proceso.
if (require.main === module) {
  barridoCatalogo({
    confirm: process.env.CONFIRM === "1",
    max: process.env.MAX ? Number(process.env.MAX) : Infinity,
    solo: String(process.env.SOLO || "").split(",").map((x) => x.trim()).filter(Boolean),
    pausaMs: Number(process.env.PAUSA_MS || 1000),
  }).then(() => process.exit(0)).catch((err) => {
    console.error("❌ Error en el job:", err.message);
    process.exit(1);
  });
}

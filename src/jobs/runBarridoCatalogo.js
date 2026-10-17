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
// Límite de TheSportsDB (medido el 17 oct 2026 con nuestra llave Premium): ~100 llamadas por
// minuto; al pasarse responde 429 y bloquea ~60 s. No hay límite por hora ni por día. La llave es
// la MISMA que usa producción, así que el barrido no puede gastársela toda:
//   INTERVALO_MS=700      -> espera mínima entre LLAMADAS (no entre claves): ~85 por minuto.
//   Un 429 corta esa clave en seco: las llamadas que le quedan fallan sin salir a la red (no se
//   gasta cuota en el camino de adivinar temporadas ni en el respaldo). Se espera ESPERA_429_MS
//   (65000 por default) y se reintenta la clave desde cero, hasta 2 veces. Si aun así no sale, se
//   reporta "SIN DATO (429)", nunca "0 partidos", y el resumen avisa que los totales no están
//   completos. Para repetir solo ésas: SOLO=<claves que salieron sin dato>.
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

const es429 = (error) => !!(error && error.response && error.response.status === 429);

// El proveedor, con ritmo y con fusible. Envuelve SOLO las tres llamadas que hace el barrido
// (lista de temporadas, temporada y respaldo); lo demás pasa tal cual. Va aquí y no en el
// proveedor ni en syncService para no tocar nada de lo que usa el sync de los calendarios.
//   - Ritmo: entre una llamada y la siguiente pasan al menos intervaloMs, en todo el barrido.
//   - Fusible: tras un 429, estado.cortada = true y las llamadas siguientes fallan al instante,
//     sin salir a la red, hasta que el barrido lo rearme para la siguiente clave o el reintento.
function proveedorConRitmo(provider, intervaloMs, estado) {
  let ultima = 0;
  const envolver = (nombre) => async (...args) => {
    if (estado.cortada) {
      throw new Error("no se pidió: la fuente ya respondió 429 en esta clave");
    }
    const falta = ultima + intervaloMs - Date.now();
    if (falta > 0) await dormir(falta);
    ultima = Date.now();
    estado.llamadasReales += 1;
    try {
      return await provider[nombre](...args);
    } catch (error) {
      if (es429(error)) { estado.cortada = true; estado.respuestas429 += 1; }
      throw error;
    }
  };
  const envueltas = {
    getSeasons: envolver("getSeasons"),
    getEventsByLeagueAndSeason: envolver("getEventsByLeagueAndSeason"),
    getNextLeagueEvents: envolver("getNextLeagueEvents"),
  };
  return new Proxy(provider, {
    get(objetivo, prop) {
      if (prop in envueltas) return envueltas[prop];
      const valor = objetivo[prop];
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}

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
// intervaloMs: espera mínima entre llamadas a la fuente. espera429Ms y reintentos429: qué hacer
// cuando una clave choca con el límite. pausaMs: pausa extra entre claves (0: ya la da el ritmo).
async function barridoCatalogo({
  confirm = false, max = Infinity, solo = [], pausaMs = 0,
  intervaloMs = 700, espera429Ms = 65000, reintentos429 = 2,
} = {}) {
  const CONFIRM = confirm;
  const MAX = max;
  const SOLO = solo.map(String);
  const PAUSA_MS = pausaMs;
  const estado = { cortada: false, llamadasReales: 0, respuestas429: 0 };
  const provider = proveedorConRitmo(getProvider("the_sports_db"), intervaloMs, estado);
  const contador = nuevoContador();
  const sinDato = []; // claves que siguieron en 429 después de los reintentos
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
  console.log(` Ritmo: ${intervaloMs} ms entre llamadas (~${Math.floor(60000 / intervaloMs)} por minuto) | tras un 429: espera ${Math.round(espera429Ms / 1000)} s y hasta ${reintentos429} reintentos`);
  console.log("========================================================");

  const resumen = {
    claves: claves.length, conPartidos: 0, sinPartidos: 0, conError: 0,
    enFuente: 0, yaIguales: 0, cambiados: 0, nuevos: 0, guardados: 0, pendientesPorMax: 0,
  };

  // Una clave, de punta a punta: lista de temporadas (directo del proveedor y SIN guardarla; sin
  // lista, la regla adivina exactamente como syncLeague cuando su lista falla) y luego el mismo
  // camino de lectura de syncLeague. Rearma el fusible al empezar.
  async function consultarClave(clave, sport) {
    estado.cortada = false;
    const llamadasAntes = estado.llamadasReales;
    const erroresAntes = contador.errores;
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
    const r = await traerEventosDeLiga(provider, clave, normalizeSport(sport), lista, contador);
    return {
      ...r, origenLista,
      cortada: estado.cortada,
      llamadas: estado.llamadasReales - llamadasAntes,
      fallaron: contador.errores - erroresAntes,
    };
  }

  for (const clave of claves) {
    const { nombre, sport } = fichaDeClave(clave);

    // Con un 429 la clave se corta: se espera a que la fuente reponga y se reintenta desde cero.
    let intento = await consultarClave(clave, sport);
    let llamadasClave = intento.llamadas;
    for (let n = 1; intento.cortada && n <= reintentos429; n++) {
      console.log(`\n· ${clave} ${nombre}: la fuente respondió 429 → espero ${Math.round(espera429Ms / 1000)} s y reintento (${n} de ${reintentos429})`);
      await dormir(espera429Ms);
      intento = await consultarClave(clave, sport);
      llamadasClave += intento.llamadas;
    }
    if (intento.cortada) {
      sinDato.push(clave);
      console.log(`\n· ${clave} ${nombre}`);
      console.log(`    SIN DATO (429): la fuente siguió rechazando después de ${reintentos429} reintentos. NO es "0 partidos". | llamadas: ${llamadasClave}`);
      await dormir(PAUSA_MS);
      continue;
    }

    const { rawMatches, busqueda, delRespaldo, origenLista } = intento;
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
    const fallaron = intento.fallaron;

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
    console.log(`    camino: ${camino} | lista: ${origenLista} | llamadas: ${llamadasClave}${fallaron ? ` | FALLARON ${fallaron}` : ""}`);

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
  console.log(` Claves con partidos en la ventana: ${resumen.conPartidos} | sin partidos: ${resumen.sinPartidos} | con llamadas fallidas: ${resumen.conError} | SIN DATO (429): ${sinDato.length}`);
  if (sinDato.length) {
    console.log(` ⚠ Los totales NO están completos: faltan ${sinDato.length} claves. Repetir solo ésas: SOLO=${sinDato.join(",")}`);
  }
  console.log(` Partidos en la fuente: ${resumen.enFuente}`);
  console.log(`   ya en matches sin cambios: ${resumen.yaIguales} | con cambios: ${resumen.cambiados} | nuevos: ${resumen.nuevos}`);
  console.log(` Equipos nuevos en todo el barrido (sin repetir entre claves): ${equiposNuevosTotal.size}`);
  if (CONFIRM) console.log(` Guardados en matches: ${resumen.guardados}${resumen.pendientesPorMax ? ` | pendientes por MAX=${MAX}: ${resumen.pendientesPorMax}` : ""}`);
  console.log(` Llamadas a TheSportsDB (las que salieron a la red): ${estado.llamadasReales} | respuestas 429: ${estado.respuestas429}`);
  if (!CONFIRM) console.log(" Ensayo: no se escribió nada. Para guardar, CONFIRM=1 (y MAX=5 la primera vez).");
  console.log("========================================================");
  resumen.sinDato = sinDato;
  resumen.llamadasReales = estado.llamadasReales;
  resumen.respuestas429 = estado.respuestas429;
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
    pausaMs: Number(process.env.PAUSA_MS || 0),
    intervaloMs: Number(process.env.INTERVALO_MS || 700),
    espera429Ms: Number(process.env.ESPERA_429_MS || 65000),
  }).then(() => process.exit(0)).catch((err) => {
    console.error("❌ Error en el job:", err.message);
    process.exit(1);
  });
}

// src/jobs/runCompararReglaTemporadas.js
//
// Comparador SOLO LECTURA: regla VIEJA de temporadas de syncLeague contra la regla NUEVA
// propuesta (preguntarle al proveedor qué temporadas existen en vez de adivinar cuatro).
// Se corre ANTES de tocar syncLeague. Si la nueva trajera menos partidos que la vieja para
// alguna liga, esa gente perdería eventos y la limpieza de abandonados se los borraría de su
// Google Calendar. Este job demuestra, con datos, si eso pasa o no.
//
// LA REGLA NUEVA que se mide (para una fecha D y la lista de temporadas L del proveedor):
//   1. Recorrer las MISMAS variantes que hoy, en el MISMO orden, saltando las que no están en L.
//      La variante principal se pide SIEMPRE, esté o no en L (remedio contra una lista vieja).
//      Detenerse en la primera con partidos en la ventana, igual que hoy.
//   2. Si ninguna trajo nada: probar las temporadas de L que NO son variantes y cuyo año mayor
//      es el de D o posterior ("2027", "2030"), de la más nueva a la más vieja, hasta la primera
//      con partidos en la ventana.
//   3. Si el paso 1 no trajo nada: correr TAMBIÉN el respaldo de siempre (eventsnextleague) y
//      sumarlo a lo del paso 2.
//   Si L viene vacía, la regla nueva se porta exactamente como la vieja.
//
// QUÉ MIDE:
//   A. COMPLETITUD: temporadas que eventsseason sirve CON partidos pero que la lista NO trae.
//      Tiene que salir cero: si no, la regla nueva se saltaría partidos que hoy sí llegan.
//   B. COMPARACIÓN: para cada liga y cada uno de los próximos 365 días, los partidos de la nueva
//      tienen que INCLUIR a todos los de la vieja. Combinaciones donde trae menos: tiene que ser 0.
//   C. Llamadas por sync de cada regla, por liga y en total.
//   D. Casos puntuales: 5520 (temporada "2027"), previas de Champions de julio (4480, julio 2026),
//      4501 y 4724 (temporada "2026"), y cuántas veces la variante principal no está en la lista.
//
// El respaldo (eventsnextleague) depende del reloj real y no se puede simular para otras fechas.
// No hace falta: la regla nueva lo corre SIEMPRE que la vieja lo correría (paso 3), así que en la
// comparación entra como el mismo conjunto en las dos. Se representa con un marcador.
//
// DISCIPLINA:
//   - La base se abre con { readonly: true }, solo para leer qué ligas tienen suscripciones.
//     NO carga src/db/database.js ni llama a initializeDatabase(). SIN_BASE=1 la salta.
//   - La regla vieja es la lógica REAL de syncService.js: se lee su texto y se ejecuta aparte
//     (importarlo abriría la base vía los repositorios), con un reloj simulado para cada fecha.
//     Si alguien mueve esas funciones, el job truena con un mensaje claro.
//   - Al proveedor solo se le hacen GET de lectura, cada uno UNA vez, con pausa (PAUSA_MS).
//   - PLAN=1 solo pide las listas de temporadas e imprime cuántas llamadas faltarían, sin pedirlas.
//
// Uso (en Render):
//   cd ~/project/src && NODE_ENV=production PLAN=1 node src/jobs/runCompararReglaTemporadas.js
//   cd ~/project/src && NODE_ENV=production node src/jobs/runCompararReglaTemporadas.js
// Opcionales: LIGAS_EXTRA="4350:futbol,4391:futbol_americano" suma ligas; SOLO_CLAVES="5520,4480"
// limita a esas claves (para pruebas).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const axios = require("axios");
const Database = require("better-sqlite3");
const { TheSportsDbProvider } = require("../providers/theSportsDb");
const { confederaciones, competenciasDeConfederacion, amistosos, RAMAS } = require("../services/seleccionesConfederaciones");

const PAUSA_MS = Number(process.env.PAUSA_MS || 700);
const SIN_BASE = process.env.SIN_BASE === "1";
const SOLO_PLAN = process.env.PLAN === "1";
const DIAS = 365;
const FALLBACK = "__respaldo__"; // marcador: "lo que traiga eventsnextleague", igual en las dos reglas

// Casos puntuales que pide el reporte.
const CLAVE_COPA_AFRICANA = "5520";
const CLAVE_CHAMPIONS = "4480";
const CLAVES_TEMPORADA_2026 = ["4501", "4724"];

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ── La lógica real de syncService.js, con un reloj que se puede fijar ──
//
// getSeasonVariants y getSyncDateRange llaman a `new Date()`. Se ejecutan en un contexto aparte
// cuyo Date, sin argumentos, regresa la fecha que se esté simulando. Todo lo demás de Date queda
// igual. Así la regla vieja es exactamente el código de producción, para cualquier día.
function cargarLogicaDeSync() {
  const archivo = path.resolve(__dirname, "../services/syncService.js");
  const fuente = fs.readFileSync(archivo, "utf8");
  const desde = fuente.indexOf("const SPORT_NAME_MAP");
  const hasta = fuente.indexOf("// Sincroniza los partidos de una liga específica");
  if (desde < 0 || hasta < 0 || hasta <= desde) {
    throw new Error(
      "No encontré en syncService.js el tramo de 'const SPORT_NAME_MAP' a " +
      "'// Sincroniza los partidos de una liga específica'. Si se movió, ajusta cargarLogicaDeSync."
    );
  }
  let ahora = Date.now();
  const RealDate = Date;
  class RelojFijo extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ahora);
      else super(...args);
    }
    static now() { return ahora; }
  }
  const codigo = fuente.slice(desde, hasta) +
    "\n({ normalizeSport, getCurrentSeason, getSeasonVariants, getSyncDateRange });";
  const logica = vm.runInNewContext(codigo, { Date: RelojFijo }, { filename: "syncService.js (tramo de temporadas)" });
  for (const fn of ["normalizeSport", "getCurrentSeason", "getSeasonVariants", "getSyncDateRange"]) {
    if (typeof logica[fn] !== "function") throw new Error(`El tramo de syncService.js ya no define ${fn}.`);
  }
  // Mediodía UTC: lejos de la medianoche, para que el mes y el año sean los mismos en cualquier zona.
  logica.fijarFecha = (fechaIso) => { ahora = RealDate.parse(`${fechaIso}T12:00:00Z`); };
  return logica;
}

function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function anioMayor(temporada) {
  const anios = String(temporada).match(/\d{4}/g);
  return anios ? Math.max(...anios.map(Number)) : null;
}

// ── Ligas a cubrir ──
function leerLigas(normalizeSport) {
  const ligas = new Map(); // clave -> { sport (normalizado), origen, deportesVistos }

  if (!SIN_BASE) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const subs = db.prepare("SELECT sport, competitionKey FROM subscriptions WHERE competitionKey IS NOT NULL").all();
    db.close();
    // Mismo filtro que syncMatches (syncService.js): fuera tenis y national_. Si una clave tiene
    // suscripciones con deportes distintos, syncMatches se queda con el ÚLTIMO; aquí igual.
    for (const s of subs) {
      const sport = normalizeSport(s.sport);
      const clave = String(s.competitionKey);
      if (sport === "tennis" || clave.startsWith("national_")) continue;
      const previa = ligas.get(clave);
      const vistos = previa ? previa.deportesVistos : new Set();
      vistos.add(sport);
      ligas.set(clave, { sport, origen: "suscripciones", deportesVistos: vistos });
    }
  }

  for (const conf of confederaciones) {
    for (const rama of RAMAS) {
      for (const c of competenciasDeConfederacion(conf.clave, rama)) {
        if (!ligas.has(c.clave)) ligas.set(c.clave, { sport: "football", origen: `selecciones (${conf.clave})`, deportesVistos: new Set(["football"]) });
      }
    }
  }
  for (const rama of RAMAS) {
    const a = amistosos[rama];
    if (a && !ligas.has(a.clave)) ligas.set(a.clave, { sport: "football", origen: "selecciones (amistosos)", deportesVistos: new Set(["football"]) });
  }

  for (const par of String(process.env.LIGAS_EXTRA || "").split(",").map(x => x.trim()).filter(Boolean)) {
    const [clave, sport] = par.split(":");
    if (!ligas.has(clave)) ligas.set(clave, { sport: normalizeSport(sport || "futbol"), origen: "LIGAS_EXTRA", deportesVistos: new Set() });
  }

  // La Champions es la liga de la pregunta de julio. Si nadie la sigue, se agrega solo para eso.
  if (!ligas.has(CLAVE_CHAMPIONS)) {
    ligas.set(CLAVE_CHAMPIONS, { sport: "football", origen: "agregada para la pregunta de Champions", deportesVistos: new Set(["football"]) });
  }

  const solo = String(process.env.SOLO_CLAVES || "").split(",").map(x => x.trim()).filter(Boolean);
  if (solo.length) for (const k of [...ligas.keys()]) if (!solo.includes(k)) ligas.delete(k);
  return ligas;
}

async function main() {
  const apiKey = process.env.THE_SPORTS_DB_API_KEY;
  const baseUrl = process.env.THE_SPORTS_DB_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("Faltan THE_SPORTS_DB_API_KEY o THE_SPORTS_DB_BASE_URL en el entorno. Córrelo en el Shell de Render.");
  }

  const logica = cargarLogicaDeSync();
  const provider = new TheSportsDbProvider();
  const hoy = new Date().toISOString().slice(0, 10);

  // Fechas a simular: los próximos 365 días. Y aparte, julio 2026 para la Champions: su julio
  // dentro de la ventana es julio 2027, cuya temporada todavía no existe en el proveedor.
  const fechas = Array.from({ length: DIAS }, (_, i) => sumarDias(hoy, i));
  const fechasJulioChampions = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);

  let llamadas = 0;
  async function pedir(fn) {
    llamadas += 1;
    try { return await fn(); } finally { await dormir(PAUSA_MS); }
  }

  const ligas = leerLigas(logica.normalizeSport);

  console.log("========================================================");
  console.log(" REGLA DE TEMPORADAS: VIEJA vs NUEVA  (solo lectura)");
  console.log(` Hoy: ${hoy}   Días simulados: ${fechas[0]} → ${fechas[fechas.length - 1]}`);
  console.log(` Base: ${SIN_BASE ? "(saltada, SIN_BASE=1)" : dbPath}   Ligas: ${ligas.size}`);
  console.log("========================================================");
  if (apiKey === "123") {
    console.log("\n⚠️  Llave GRATUITA (123): la lista de temporadas trae solo las 5 más viejas y eventsseason");
    console.log("    viene capado. La completitud y la comparación saldrán MAL a propósito. Córrelo en Render.\n");
  }
  const conflictos = [...ligas].filter(([, l]) => l.deportesVistos.size > 1);
  for (const [clave, l] of conflictos) {
    console.log(`⚠ ${clave}: suscripciones con deportes distintos (${[...l.deportesVistos].join(", ")}); se usa "${l.sport}", como syncMatches.`);
  }

  // ── Paso 1 de datos: la lista de temporadas de cada liga ──
  const listas = new Map(); // clave -> [temporadas] (vacía si no vino)
  for (const clave of ligas.keys()) {
    try {
      const data = await pedir(async () =>
        (await axios.get(`${baseUrl}/${apiKey}/search_all_seasons.php`, { params: { id: clave }, timeout: 15000 })).data || {}
      );
      listas.set(clave, (data.seasons || []).map(s => s.strSeason).filter(Boolean));
    } catch (e) {
      console.log(`⚠ ${clave}: search_all_seasons falló (${e.message}); se trata como lista vacía.`);
      listas.set(clave, []);
    }
  }

  // Qué variantes usa la regla vieja en una fecha, para el deporte de una liga.
  const variantesEn = (sport, fecha) => { logica.fijarFecha(fecha); return logica.getSeasonVariants(sport); };
  const ventanaEn = (fecha) => { logica.fijarFecha(fecha); return logica.getSyncDateRange(); };

  // ── Plan: qué temporadas hay que pedir por liga ──
  // Todas las variantes que la regla vieja usaría en algún día simulado (para compararla fiel),
  // más las temporadas de la lista que la regla nueva podría probar en el paso 2.
  const plan = new Map(); // clave -> Set(temporadas)
  for (const [clave, liga] of ligas) {
    const set = new Set();
    const dias = clave === CLAVE_CHAMPIONS ? [...fechas, ...fechasJulioChampions] : fechas;
    for (const f of dias) for (const v of variantesEn(liga.sport, f)) set.add(v);
    const anioMin = Number(hoy.slice(0, 4)) - (clave === CLAVE_CHAMPIONS ? 1 : 0);
    for (const t of listas.get(clave)) {
      const a = anioMayor(t);
      if (a !== null && a >= anioMin) set.add(t);
    }
    plan.set(clave, set);
  }
  const porPedir = [...plan.values()].reduce((s, set) => s + set.size, 0);
  console.log(`\nPLAN: ${ligas.size} listas ya pedidas + ${porPedir} eventsseason por pedir = ${ligas.size + porPedir} llamadas en total.`);
  console.log(`      Con PAUSA_MS=${PAUSA_MS}, unos ${Math.ceil((porPedir * (PAUSA_MS + 400)) / 60000)} minutos más.`);
  if (SOLO_PLAN) {
    console.log("\nPLAN=1: no se pide nada más. Listo, no se escribió nada.");
    return;
  }

  // ── Paso 2 de datos: cada temporada candidata, UNA vez ──
  // Sin fechas: la temporada completa, ya con el filtro de sorteos del proveedor, igual que la
  // recibe syncLeague antes de recortar a su ventana.
  const temporadas = new Map(); // clave -> Map(temporada -> { eventos, error })
  for (const [clave, set] of plan) {
    const m = new Map();
    for (const t of set) {
      try {
        const eventos = await pedir(() => provider.getEventsByLeagueAndSeason({ leagueId: clave, season: t }));
        m.set(t, { eventos, error: null });
      } catch (e) {
        m.set(t, { eventos: [], error: e.message });
      }
    }
    temporadas.set(clave, m);
  }

  // ── A. COMPLETITUD ──
  const incompletas = [];
  const conError = [];
  const sinAnio = [];
  for (const [clave, m] of temporadas) {
    const lista = new Set(listas.get(clave));
    for (const [t, r] of m) {
      if (r.error) conError.push({ clave, temporada: t, error: r.error });
      else if (r.eventos.length > 0 && !lista.has(t)) incompletas.push({ clave, temporada: t, partidos: r.eventos.length });
    }
    for (const t of listas.get(clave)) if (anioMayor(t) === null) sinAnio.push({ clave, temporada: t });
  }

  // ── Las dos reglas, para una liga y una fecha ──
  const enVentana = (desde, hasta) => (e) => !!e.dateEvent && e.dateEvent >= desde && e.dateEvent <= hasta;
  function datos(clave, t) {
    const r = temporadas.get(clave).get(t);
    if (!r) throw new Error(`Falta en memoria la temporada "${t}" de ${clave}: el plan no la incluyó.`);
    return r.eventos;
  }

  function reglaVieja(clave, sport, fecha) {
    const variantes = variantesEn(sport, fecha);
    const { fromDate, toDate } = ventanaEn(fecha);
    for (let i = 0; i < variantes.length; i++) {
      const ev = datos(clave, variantes[i]).filter(enVentana(fromDate, toDate));
      if (ev.length > 0) return { ids: new Set(ev.map(e => e.idEvent)), llamadas: i + 1, via: variantes[i] };
    }
    return { ids: new Set([FALLBACK]), llamadas: variantes.length + 1, via: "respaldo" };
  }

  function reglaNueva(clave, sport, fecha, { conGuarda = true } = {}) {
    const lista = listas.get(clave);
    if (lista.length === 0) return { ...reglaVieja(clave, sport, fecha), sinLista: true };
    const enLista = new Set(lista);
    const variantes = variantesEn(sport, fecha);
    const principal = variantes[0];
    const { fromDate, toDate } = ventanaEn(fecha);
    let n = 0;
    for (const v of variantes) {
      if (!enLista.has(v) && !(conGuarda && v === principal)) continue;
      n += 1;
      const ev = datos(clave, v).filter(enVentana(fromDate, toDate));
      if (ev.length > 0) return { ids: new Set(ev.map(e => e.idEvent)), llamadas: n, via: v };
    }
    const anio = Number(fecha.slice(0, 4));
    const extras = lista
      .filter(t => !variantes.includes(t) && anioMayor(t) !== null && anioMayor(t) >= anio)
      .reverse();
    const ids = new Set([FALLBACK]);
    let via = "respaldo";
    for (const t of extras) {
      n += 1;
      const ev = datos(clave, t).filter(enVentana(fromDate, toDate));
      if (ev.length > 0) { ev.forEach(e => ids.add(e.idEvent)); via = `${t} + respaldo`; break; }
    }
    return { ids, llamadas: n + 1, via };
  }

  // ── B y C. COMPARACIÓN y LLAMADAS ──
  const menos = [];
  const filas = [];
  let combinaciones = 0;
  let combinacionesMas = 0;
  let principalFuera = 0;
  for (const [clave, liga] of ligas) {
    const lista = new Set(listas.get(clave));
    let sumVieja = 0, sumNueva = 0, sumSinGuarda = 0, mas = 0, fuera = 0;
    for (const f of fechas) {
      const v = reglaVieja(clave, liga.sport, f);
      const n = reglaNueva(clave, liga.sport, f);
      const s = reglaNueva(clave, liga.sport, f, { conGuarda: false });
      combinaciones += 1;
      sumVieja += v.llamadas; sumNueva += n.llamadas; sumSinGuarda += s.llamadas;
      const faltan = [...v.ids].filter(id => !n.ids.has(id));
      if (faltan.length) menos.push({ clave, fecha: f, faltan: faltan.length, vieja: v.via, nueva: n.via });
      else if (n.ids.size > v.ids.size) { mas += 1; combinacionesMas += 1; }
      if (!lista.has(variantesEn(liga.sport, f)[0])) { fuera += 1; principalFuera += 1; }
    }
    const vHoy = reglaVieja(clave, liga.sport, hoy);
    const nHoy = reglaNueva(clave, liga.sport, hoy);
    filas.push({
      clave,
      origen: liga.origen,
      sport: liga.sport,
      "temporadas en lista": listas.get(clave).length,
      "hoy vieja": `${vHoy.llamadas} (${vHoy.via})`,
      "hoy nueva": `${nHoy.llamadas} (${nHoy.via})`,
      "prom. vieja": +(sumVieja / fechas.length).toFixed(2),
      "prom. nueva": +(sumNueva / fechas.length).toFixed(2),
      "prom. sin guarda": +(sumSinGuarda / fechas.length).toFixed(2),
      "días con más": mas,
      "días principal fuera de lista": fuera,
    });
  }

  console.log("\n========================================================");
  console.log(" A) COMPLETITUD: temporadas con partidos que la lista NO trae  (tiene que ser 0)");
  console.log("========================================================");
  console.log(`   Resultado: ${incompletas.length}`);
  if (incompletas.length) {
    console.table(incompletas);
    console.log("   🛑 PARA: con esto la regla nueva SÍ se saltaría partidos. No se toca syncLeague.");
  }
  if (conError.length) {
    console.log(`   ⚠ ${conError.length} temporada(s) no se pudieron pedir; la comparación de esas ligas no es confiable:`);
    console.table(conError);
  }
  if (sinAnio.length) {
    console.log(`   Temporadas sin año en el nombre (la regla nueva no las prueba en el paso 2): ${sinAnio.length}`);
    console.table(sinAnio);
  }

  console.log("\n========================================================");
  console.log(` B) COMPARACIÓN: ${combinaciones} combinaciones liga × día`);
  console.log("========================================================");
  console.log(`   Donde la nueva trae MENOS que la vieja (tiene que ser 0): ${menos.length}`);
  console.log(`   Donde la nueva trae MÁS (encuentra lo que la vieja perdía): ${combinacionesMas}`);
  console.log(`   Iguales: ${combinaciones - menos.length - combinacionesMas}`);
  if (menos.length) {
    console.table(menos.slice(0, 40));
    if (menos.length > 40) console.log(`   ... y ${menos.length - 40} más.`);
    console.log("   🛑 PARA: la regla nueva pierde partidos en estas combinaciones. No se toca syncLeague.");
  }

  console.log("\n========================================================");
  console.log(" C) LLAMADAS POR SYNC, por liga  (prom. = promedio en los 365 días)");
  console.log("========================================================");
  console.table(filas);
  const suma = (k) => filas.reduce((s, f) => s + f[k], 0);
  const hoyV = filas.reduce((s, f) => s + Number(String(f["hoy vieja"]).split(" ")[0]), 0);
  const hoyN = filas.reduce((s, f) => s + Number(String(f["hoy nueva"]).split(" ")[0]), 0);
  const deSubs = filas.filter(f => f.origen === "suscripciones");
  const hoySubsV = deSubs.reduce((s, f) => s + Number(String(f["hoy vieja"]).split(" ")[0]), 0);
  const hoySubsN = deSubs.reduce((s, f) => s + Number(String(f["hoy nueva"]).split(" ")[0]), 0);
  console.log(`   TOTAL hoy, todas las ligas:         vieja ${hoyV}  →  nueva ${hoyN}`);
  console.log(`   TOTAL hoy, solo las de suscripción: vieja ${hoySubsV}  →  nueva ${hoySubsN}`);
  console.log(`   TOTAL promedio por sync:            vieja ${suma("prom. vieja").toFixed(1)}  →  nueva ${suma("prom. nueva").toFixed(1)}  (sin la guarda: ${suma("prom. sin guarda").toFixed(1)})`);
  console.log("   La regla nueva suma además 1 llamada por liga cada vez que se refresca la lista (vigencia 24 h).");

  console.log("\n========================================================");
  console.log(" D) CASOS PUNTUALES");
  console.log("========================================================");
  const caso = (clave, etiqueta) => {
    const liga = ligas.get(clave);
    if (!liga) { console.log(`   ${etiqueta} (${clave}): no está entre las ligas de esta corrida.`); return; }
    const v = reglaVieja(clave, liga.sport, hoy);
    const n = reglaNueva(clave, liga.sport, hoy);
    const realesV = [...v.ids].filter(id => id !== FALLBACK).length;
    const realesN = [...n.ids].filter(id => id !== FALLBACK).length;
    console.log(`   ${etiqueta} (${clave}) hoy: vieja ${v.llamadas} llamada(s), ${realesV} partido(s) por eventsseason, vía ${v.via}`);
    console.log(`   ${" ".repeat(etiqueta.length + clave.length + 3)}      nueva ${n.llamadas} llamada(s), ${realesN} partido(s) por eventsseason, vía ${n.via}`);
    console.log(`      Lista del proveedor: ${listas.get(clave).slice(-8).join(", ") || "(vacía)"}${listas.get(clave).length > 8 ? " (últimas 8)" : ""}`);
  };
  caso(CLAVE_COPA_AFRICANA, "Clasificación Copa Africana");
  for (const k of CLAVES_TEMPORADA_2026) caso(k, "Temporada \"2026\"");

  if (ligas.has(CLAVE_CHAMPIONS)) {
    const liga = ligas.get(CLAVE_CHAMPIONS);
    let diasVieja = 0, diasNueva = 0, menosJulio = 0;
    for (const f of fechasJulioChampions) {
      const v = reglaVieja(CLAVE_CHAMPIONS, liga.sport, f);
      const n = reglaNueva(CLAVE_CHAMPIONS, liga.sport, f);
      if ([...v.ids].some(id => id !== FALLBACK)) diasVieja += 1;
      if ([...n.ids].some(id => id !== FALLBACK)) diasNueva += 1;
      if ([...v.ids].some(id => !n.ids.has(id))) menosJulio += 1;
    }
    logica.fijarFecha("2026-07-15");
    console.log(`   Previas de Champions (4480), julio 2026 (variantes de ese mes: ${logica.getSeasonVariants(liga.sport).join(", ")}):`);
    console.log(`      días de julio donde eventsseason trae partidos → vieja: ${diasVieja} de 31, nueva: ${diasNueva} de 31. Días donde la nueva trae menos: ${menosJulio}.`);
    const t = temporadas.get(CLAVE_CHAMPIONS).get("2026-2027");
    const deJulio = t ? t.eventos.filter(e => e.dateEvent && e.dateEvent.startsWith("2026-07")).length : 0;
    console.log(`      Partidos de julio 2026 en la temporada "2026-2027" del proveedor: ${deJulio}.`);
  }

  console.log(`\n   Variante principal fuera de la lista: ${principalFuera} de ${combinaciones} combinaciones liga × día.`);
  console.log("   (Cada una cuesta 1 llamada de la guarda. Por liga, en la columna 'días principal fuera de lista'.)");

  console.log("\n========================================================");
  console.log(" RIESGO ABIERTO: la lista guardada vieja  (NO se puede probar simulando)");
  console.log("========================================================");
  console.log("   Si se guarda la lista y el proveedor crea después una temporada nueva, la regla nueva");
  console.log("   podría saltársela mientras la vieja sí la pediría. Es el cambio de temporada de cada");
  console.log("   agosto. Simular fechas futuras con los datos de hoy no lo refleja: una temporada que");
  console.log("   todavía no existe sale vacía en las dos reglas.");
  console.log("   Remedio propuesto (va con el cambio a syncLeague, no está en esta simulación salvo la guarda):");
  console.log("     1. Pedir SIEMPRE la variante principal, esté o no en la lista guardada. (simulado arriba)");
  console.log("     2. Si no se encuentra nada, volver a pedir la lista antes de rendirse.");
  console.log("     3. Vigencia de la lista guardada: 24 horas.");
  console.log("   Aun con el remedio, el riesgo no queda en cero: una ventana de hasta 24 h, cubierta en");
  console.log("   parte por el respaldo (eventsnextleague).");

  console.log(`\nListo. No se escribió nada. Este job gastó ${llamadas} llamadas a TheSportsDB.`);
}

main().catch(err => {
  console.error("❌ Error en el comparador:", err);
  process.exit(1);
});

// src/jobs/runReporteSelecciones.js
//
// Reporte SOLO LECTURA de las selecciones nacionales (src/data/selecciones.json). Por
// confederación y por rama dice:
//   1. qué competencias la componen, con su nombre y su temporada actual EN EL PROVEEDOR;
//   2. cuáles tienen partidos en los próximos 60 días y cuáles están dormidas;
//   3. cuántas llamadas al proveedor costaría sincronizarla: con la regla VIEJA de temporadas
//      (la lógica real de syncService, leída de su texto) y con la NUEVA (reglaTemporadas).
// Y además, para decidir lo que sigue:
//   4. cuántos próximos partidos regresa el proveedor para una selección (lo que usa syncTeam);
//   5. la lista de selecciones de cada confederación y rama (membresía + equiposAMano), y cuáles
//      siguen sin confederación;
//   6. si alguna suscripción de equipo que YA existe se llama como una selección.
//
// No escribe nada en ningún lado:
//   - La base se abre con { readonly: true } y solo para contar partidos que ya estén en
//     matches y revisar choques de nombre. NO carga src/db/database.js ni llama a
//     initializeDatabase(). SIN_BASE=1 la salta.
//   - Al proveedor solo se le hacen GET de lectura. Sí GASTA peticiones de TheSportsDB (~290
//     con las 32 claves de hoy); por eso va una pausa entre cada una (PAUSA_MS, 700 por omisión)
//     y al final se imprime cuántas gastó.
//
// Por qué NO importa syncService.js: importa los repositorios, y ésos cargan database.js, que
// abre la base en cuanto se hace require. Para no copiar a mano la lógica de temporadas (y que se
// desincronice el día que alguien la cambie), se LEE el texto de syncService.js y se ejecutan
// aparte getSeasonVariants y getSyncDateRange tal cual están escritas. Si alguien mueve o
// renombra esas funciones, este job truena con un mensaje claro en vez de simular otra cosa.
//
// No carga dotenv: solo necesita THE_SPORTS_DB_API_KEY y THE_SPORTS_DB_BASE_URL, que en Render
// ya vienen en el entorno.
//
// Uso (en Render):
//   cd ~/project/src && NODE_ENV=production node src/jobs/runReporteSelecciones.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const axios = require("axios");
const Database = require("better-sqlite3");
const { TheSportsDbProvider } = require("../providers/theSportsDb");
const {
  confederaciones,
  competenciasDeConfederacion,
  amistosos,
  RAMAS,
  competenciasParaListas,
  armarListasDeSelecciones,
} = require("../services/seleccionesConfederaciones");
const { buscarPorTemporadas, anioMayor } = require("../services/reglaTemporadas");

const PAUSA_MS = Number(process.env.PAUSA_MS || 700);
const SIN_BASE = process.env.SIN_BASE === "1";
const DIAS_ACTIVIDAD = 60;

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ── La lógica real de temporadas y ventana, leída de syncService.js ──
function cargarLogicaDeSync() {
  const archivo = path.resolve(__dirname, "../services/syncService.js");
  const fuente = fs.readFileSync(archivo, "utf8");
  const desde = fuente.indexOf("const SPLIT_SEASON_SPORTS");
  const hasta = fuente.indexOf("// Sincroniza los partidos de una liga específica");
  if (desde < 0 || hasta < 0 || hasta <= desde) {
    throw new Error(
      "No encontré en syncService.js el tramo de temporadas (de 'const SPLIT_SEASON_SPORTS' a " +
      "'// Sincroniza los partidos de una liga específica'). Si se movió, ajusta cargarLogicaDeSync."
    );
  }
  const codigo = fuente.slice(desde, hasta) + "\n({ getSeasonVariants, getSyncDateRange });";
  const logica = vm.runInNewContext(codigo, { Date }, { filename: "syncService.js (tramo de temporadas)" });
  if (typeof logica.getSeasonVariants !== "function" || typeof logica.getSyncDateRange !== "function") {
    throw new Error("El tramo de syncService.js ya no define getSeasonVariants y getSyncDateRange.");
  }
  return logica;
}

function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Mismo criterio de ventana que syncLeague y el proveedor: dateEvent como texto, extremos incluidos.
const enVentana = (desde, hasta) => (e) => !!e.dateEvent && e.dateEvent >= desde && e.dateEvent <= hasta;

async function main() {
  const apiKey = process.env.THE_SPORTS_DB_API_KEY;
  const baseUrl = process.env.THE_SPORTS_DB_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("Faltan THE_SPORTS_DB_API_KEY o THE_SPORTS_DB_BASE_URL en el entorno. Córrelo en el Shell de Render.");
  }

  const { getSeasonVariants, getSyncDateRange } = cargarLogicaDeSync();
  const provider = new TheSportsDbProvider();

  let llamadasDelReporte = 0;
  // Toda petición al proveedor pasa por aquí: cuenta y hace la pausa.
  async function pedir(fn) {
    llamadasDelReporte += 1;
    try {
      return await fn();
    } finally {
      await dormir(PAUSA_MS);
    }
  }
  const getJson = (endpoint, params) => pedir(async () =>
    (await axios.get(`${baseUrl}/${apiKey}/${endpoint}`, { params, timeout: 15000 })).data || {}
  );

  // Las selecciones son "football": mismas variantes que usaría syncLeague para ellas hoy.
  const variantes = getSeasonVariants("football");
  const { fromDate, toDate } = getSyncDateRange();
  const hasta60 = sumarDias(fromDate, DIAS_ACTIVIDAD);

  console.log("========================================================");
  console.log(" SELECCIONES NACIONALES  (solo lectura)");
  console.log(` Hoy: ${fromDate}   Ventana del sync: ${fromDate} → ${toDate}   Actividad: hasta ${hasta60}`);
  console.log(` Temporadas que probaría syncLeague, en orden: ${variantes.join(", ")}`);
  console.log(` Base: ${SIN_BASE ? "(saltada, SIN_BASE=1)" : dbPath}`);
  console.log("========================================================");
  if (apiKey === "123") {
    console.log("\n⚠️  Llave GRATUITA (123): eventsseason regresa solo los primeros 5-15 partidos de la");
    console.log("    temporada y las listas vienen capadas. Los partidos, el costo y las listas de");
    console.log("    selecciones de este reporte NO son confiables. Córrelo en Render con la llave real.\n");
  }

  // Partidos ya guardados en matches, por clave (solo lectura).
  const enBase = new Map();
  if (!SIN_BASE) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const filas = db.prepare(
      `SELECT competitionKey, COUNT(*) AS total,
              SUM(CASE WHEN substr(currentStartUtc,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS proximos
         FROM matches GROUP BY competitionKey`
    ).all(fromDate, hasta60);
    db.close();
    for (const f of filas) enBase.set(String(f.competitionKey), f);
  }

  // Simula syncLeague para una competencia y de paso mide la actividad a 60 días.
  //
  // syncLeague prueba las temporadas en orden y se DETIENE en la primera que trae partidos en su
  // ventana de 30 días; si ninguna trae, hace una llamada más de respaldo (eventsnextleague).
  // Aquí se piden TODAS las temporadas (para ver la actividad a 60 días en cualquiera de ellas) y
  // el respaldo, pero el costo que se reporta es el que haría syncLeague, no el de este reporte.
  // getEventsByLeagueAndSeason sin fechas regresa la temporada entera ya con el filtro de sorteos,
  // y luego se recorta igual que lo recorta el proveedor con fechas: el resultado es el mismo.
  async function estudiarCompetencia(clave, baseDeTabla) {
    const fila = { clave, base: baseDeTabla };

    const liga = ((await getJson("lookupleague.php", { id: clave })).leagues || [])[0];
    fila.nombreProveedor = liga ? liga.strLeague : "(lookupleague no la encontró)";
    fila.temporadaActual = liga ? (liga.strCurrentSeason || "(vacía)") : "-";
    fila.renombrada = !!liga && liga.strLeague !== baseDeTabla;

    let acierto = -1;
    let en60 = 0;
    const porTemporada = [];
    const datos = new Map(); // temporada -> eventos de la temporada completa (para la regla nueva)
    for (let i = 0; i < variantes.length; i++) {
      let eventos = [];
      let error = null;
      try {
        eventos = await pedir(() => provider.getEventsByLeagueAndSeason({ leagueId: clave, season: variantes[i] }));
      } catch (e) {
        error = e.message;
      }
      const n30 = eventos.filter(enVentana(fromDate, toDate)).length;
      const n60 = eventos.filter(enVentana(fromDate, hasta60)).length;
      en60 = Math.max(en60, n60);
      datos.set(variantes[i], eventos);
      porTemporada.push(error ? `${variantes[i]}:error` : `${variantes[i]}:${eventos.length}`);
      if (acierto < 0 && n30 > 0) acierto = i;
    }

    let proximo = null;
    try {
      const siguientes = await pedir(() => provider.getNextLeagueEvents(clave));
      proximo = siguientes.filter(e => e.dateEvent && e.dateEvent >= fromDate)
        .sort((a, b) => a.dateEvent.localeCompare(b.dateEvent))[0] || null;
    } catch (e) {
      fila.nota = `eventsnextleague falló: ${e.message}`;
    }

    fila.llamadasSync = acierto >= 0 ? acierto + 1 : variantes.length + 1;

    // ── La regla NUEVA de syncLeague (reglaTemporadas), con los mismos datos ──
    // Costo por corrida = 1 (la lista: su vigencia es de 6 h y el cron de fútbol corre cada 12, así
    // que en cada corrida del cron se vuelve a pedir) + lo que pida la regla + 1 del respaldo si
    // las variantes no trajeron nada. Si la lista falla, la regla nueva adivina como la vieja.
    let lista = null;
    try {
      lista = await pedir(() => provider.getSeasons(clave));
      if (!lista.length) lista = null;
    } catch (e) {
      lista = null;
    }
    const anioActual = Number(fromDate.slice(0, 4));
    for (const t of lista || []) {
      const a = anioMayor(t);
      if (datos.has(t) || a === null || a < anioActual) continue;
      try {
        datos.set(t, await pedir(() => provider.getEventsByLeagueAndSeason({ leagueId: clave, season: t })));
      } catch (e) {
        datos.set(t, []);
      }
      en60 = Math.max(en60, datos.get(t).filter(enVentana(fromDate, hasta60)).length);
    }
    const nueva = await buscarPorTemporadas({
      variantes, lista, anioActual,
      pedirTemporada: async (t) => (datos.get(t) || []).filter(enVentana(fromDate, toDate)),
    });
    fila.llamadasNueva = 1 + nueva.llamadas + (nueva.camino === "variante" ? 0 : 1);
    fila.caminoNueva = nueva.camino === "ninguno" ? "respaldo" : `${nueva.camino} "${nueva.temporada}"`;
    fila.listaDelProveedor = lista ? lista.slice(-4).join(",") : "(falló o vacía)";
    fila.acertaCon = acierto >= 0 ? variantes[acierto] : "(ninguna: respaldo)";
    fila.partidos60 = en60;
    fila.proximo = proximo ? `${proximo.dateEvent} (temp. ${proximo.strSeason || "?"})` : "-";
    const proximoEn60 = !!proximo && proximo.dateEvent <= hasta60;
    fila.estado = en60 > 0 || proximoEn60 ? "ACTIVA" : "dormida";
    fila.temporadasVistas = porTemporada.join(" ");

    // El caso a vigilar: el proveedor sí tiene un partido dentro de la ventana del sync, pero en
    // una temporada que no está entre las variantes. syncLeague no lo encuentra por eventsseason
    // y depende del respaldo, que trae pocos partidos.
    const avisos = [];
    if (proximo && proximo.dateEvent <= toDate && acierto < 0) {
      avisos.push(`hay partido en la ventana pero ninguna temporada probada lo trae (la suya es "${proximo.strSeason}")`);
    }
    if (proximo && proximo.strSeason && !variantes.includes(proximo.strSeason)) {
      avisos.push(`temporada "${proximo.strSeason}" fuera de las variantes`);
    }
    if (fila.renombrada) avisos.push(`el proveedor la llama "${fila.nombreProveedor}"`);
    if (avisos.length) fila.nota = [fila.nota, ...avisos].filter(Boolean).join("; ");

    const b = enBase.get(String(clave));
    fila.yaEnMatches = SIN_BASE ? "-" : (b ? `${b.total} (${b.proximos || 0} próximos)` : "0");
    return fila;
  }

  // ── 1-3: por confederación y por rama ──
  const totales = [];
  for (const conf of confederaciones) {
    for (const rama of RAMAS) {
      const comps = competenciasDeConfederacion(conf.clave, rama);
      console.log(`\n── ${conf.nombre.toUpperCase()} · ${rama} ──`);
      if (comps.length === 0) {
        console.log("   (sin competencias en la tabla)");
        totales.push({ confederacion: conf.nombre, rama, competencias: 0, activas: 0, dormidas: 0, llamadasPorSync: 0, nuevaPorSync: 0 });
        continue;
      }
      const filas = [];
      for (const c of comps) {
        const fila = await estudiarCompetencia(c.clave, c.base);
        filas.push(fila);
      }
      console.table(filas.map(f => ({
        clave: f.clave,
        proveedor: f.nombreProveedor,
        temporada: f.temporadaActual,
        estado: f.estado,
        "partidos 60d": f.partidos60,
        "próximo": f.proximo,
        "vieja/sync": f.llamadasSync,
        "nueva/sync": f.llamadasNueva,
        "nueva por": f.caminoNueva,
        "ya en matches": f.yaEnMatches,
      })));
      for (const f of filas) {
        console.log(`   ${f.clave} temporadas → ${f.temporadasVistas} | lista (últimas): ${f.listaDelProveedor}${f.nota ? `   ⚠ ${f.nota}` : ""}`);
      }
      totales.push({
        confederacion: conf.nombre,
        rama,
        competencias: filas.length,
        activas: filas.filter(f => f.estado === "ACTIVA").length,
        dormidas: filas.filter(f => f.estado !== "ACTIVA").length,
        llamadasPorSync: filas.reduce((s, f) => s + f.llamadasSync, 0),
        nuevaPorSync: filas.reduce((s, f) => s + f.llamadasNueva, 0),
      });
    }
  }

  // Amistosos: informativo. NO se sincronizan como liga; llegan por syncTeam.
  console.log("\n── AMISTOSOS (no son de ninguna confederación; llegan solo siguiendo a una selección) ──");
  const filasAmistosos = [];
  for (const rama of RAMAS) {
    const a = amistosos[rama];
    if (a) filasAmistosos.push({ rama, ...(await estudiarCompetencia(a.clave, a.base)) });
  }
  console.table(filasAmistosos.map(f => ({
    rama: f.rama, clave: f.clave, proveedor: f.nombreProveedor, temporada: f.temporadaActual,
    estado: f.estado, "partidos 60d": f.partidos60, "próximo": f.proximo,
    "llamadas/sync si fuera liga": f.llamadasSync,
  })));

  console.log("\n========================================================");
  console.log(" COSTO DE SINCRONIZAR CADA CONFEDERACIÓN  (llamadas por corrida de syncLeague)");
  console.log("========================================================");
  console.table(totales);
  const porConf = new Map();
  for (const t of totales) {
    const p = porConf.get(t.confederacion) || { vieja: 0, nueva: 0 };
    p.vieja += t.llamadasPorSync; p.nueva += t.nuevaPorSync;
    porConf.set(t.confederacion, p);
  }
  console.table([...porConf].map(([confederacion, p]) => ({
    confederacion,
    "vieja por sync (ambas ramas)": p.vieja,
    "NUEVA por sync (ambas ramas)": p.nueva,
    "nueva al día (cron cada 12 h)": p.nueva * 2,
  })));
  const total = totales.reduce((s, t) => s + t.llamadasPorSync, 0);
  const totalNueva = totales.reduce((s, t) => s + t.nuevaPorSync, 0);
  console.log(`TOTAL, todas las confederaciones y ambas ramas: vieja ${total} → NUEVA ${totalNueva} llamadas por sync (~${totalNueva * 2} al día).`);
  console.log("La nueva incluye 1 llamada por competencia para la lista de temporadas (vigencia 6 h, cron cada 12 h).");
  console.log("Se suma una corrida en cada arranque del servidor y una por competencia al suscribirse.");
  console.log("Solo se paga lo que alguien siga: syncMatches solo baja ligas con al menos una suscripción.");

  // ── 4: lo que regresa el proveedor para una selección (lo que usa syncTeam) ──
  console.log("\n========================================================");
  console.log(" 4) PRÓXIMOS PARTIDOS POR SELECCIÓN  (eventsnext.php, lo que usa syncTeam)");
  console.log("========================================================");
  for (const nombre of ["Mexico", "Mexico Women", "USA"]) {
    const equipo = await pedir(() => provider.searchTeam(nombre));
    if (!equipo) { console.log(`   "${nombre}": searchteams no lo encontró`); continue; }
    const siguientes = await pedir(() => provider.getNextTeamEvents(equipo.idTeam));
    const fechas = siguientes.map(e => e.dateEvent).filter(Boolean).sort();
    console.log(`   "${nombre}" → id ${equipo.idTeam} ("${equipo.strTeam}"): eventsnext regresó ${siguientes.length} partido(s)` +
      (fechas.length ? `, del ${fechas[0]} al ${fechas[fechas.length - 1]}` : ""));
    for (const e of siguientes) console.log(`      ${e.dateEvent}  ${e.strLeague}  ${e.strHomeTeam} vs ${e.strAwayTeam}`);
  }

  // ── 5: la lista de selecciones de cada confederación y rama ──
  //
  // search_all_teams.php?l=<competencia> regresa solo las selecciones cuya competencia PRINCIPAL
  // es ésa. Se piden las de todas las competencias de la tabla (confederaciones, amistosos y
  // otrasConocidas) y armarListasDeSelecciones las acomoda: por la competencia de membresía de
  // cada grupo, más equiposAMano. Es la MISMA función que usará el endpoint de la pantalla.
  console.log("\n========================================================");
  console.log(" 5) SELECCIONES POR CONFEDERACIÓN Y RAMA  (membresía + equiposAMano)");
  console.log("========================================================");
  const fichas = [];
  const topadas = [];
  const fallidas = [];
  for (const c of competenciasParaListas()) {
    try {
      const lista = (await getJson("search_all_teams.php", { l: c.base })).teams || [];
      if (lista.length > 0 && lista.length % 10 === 0) topadas.push(`${c.base} (${lista.length})`);
      fichas.push(...lista.filter(t => t.strSport === "Soccer"));
    } catch (e) {
      fallidas.push(`${c.base}: ${e.message}`);
    }
  }
  const { grupos, sinConfederacion } = armarListasDeSelecciones(fichas);
  for (const [clave, equipos] of grupos) {
    const aMano = equipos.filter(e => e.aMano).length;
    console.log(`   ${clave}: ${equipos.length} selecciones${aMano ? ` (${aMano} de equiposAMano)` : ""}`);
    console.log(`      ${equipos.map(e => e.name).join(", ") || "(ninguna)"}`);
  }
  console.log(`\n   SIGUEN SIN CONFEDERACIÓN (${sinConfederacion.length}): ${sinConfederacion.join(", ") || "(ninguna)"}`);
  console.log("   Ésas no salen en ninguna lista. Si alguna importa, va a equiposAMano en selecciones.json.");
  if (fallidas.length) console.log(`   ⚠ Listas que no se pudieron pedir (las de arriba pueden venir incompletas): ${fallidas.join("; ")}`);
  if (topadas.length) console.log(`   ⚠ Listas con un múltiplo exacto de 10 (posible tope del proveedor): ${topadas.join(", ")}`);

  // ── 6: ¿algún nombre de selección choca con una suscripción de equipo que YA existe? ──
  //
  // Una suscripción de equipo empata por nombre en CUALQUIER competencia. Si alguien sigue hoy un
  // equipo que se llama exactamente como una selección, en cuanto el sync baje las competencias de
  // selecciones le empezarían a llegar esos partidos. Tiene que salir vacío.
  console.log("\n========================================================");
  console.log(" 6) SUSCRIPCIONES DE EQUIPO QUE YA EXISTEN CON NOMBRE DE SELECCIÓN  (tiene que ser 0)");
  console.log("========================================================");
  if (SIN_BASE) {
    console.log("   (saltado, SIN_BASE=1)");
  } else {
    const nombresSeleccion = new Set([...fichas.map(t => t.strTeam), ...[...grupos.values()].flat().map(e => e.name)]);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const deEquipo = db.prepare("SELECT id, sport, competitionKey, teamName FROM subscriptions WHERE teamName IS NOT NULL").all();
    db.close();
    const choques = deEquipo.filter(s => nombresSeleccion.has(s.teamName));
    console.log(`   Suscripciones de equipo revisadas: ${deEquipo.length}. Con nombre de selección: ${choques.length}`);
    if (choques.length) console.table(choques);
  }

  console.log(`\nListo. No se escribió nada. Este reporte gastó ${llamadasDelReporte} llamadas a TheSportsDB.`);
}

main().catch(err => {
  console.error("❌ Error en el reporte:", err);
  process.exit(1);
});

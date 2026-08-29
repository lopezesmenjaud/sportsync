require("dotenv").config();

// PRUEBA EN SECO del proveedor de tenis. NO ESCRIBE NADA.
//
// Trae las páginas de partidos próximos, aplica el filtro, normaliza, e IMPRIME lo que
// guardaría. No escribe ni una fila y no toca el calendario de nadie.
//
// La garantía no es una promesa, es estructural: este archivo NO requiere ni la base de
// datos, ni matchRepository, ni calendarSyncService, ni googleCalendarProvider. No tiene
// forma de escribir aunque se quisiera. Por eso tampoco necesita CONFIRM=1: no hay nada
// que confirmar.
//
// Cómo correrlo en el Shell de Render (el repo vive en ~/project/src, no en ~/project):
//
//   cd ~/project/src && node src/jobs/runTennisDryRun.js
//
// Cuesta una petición por página. MIENTRAS SE DEPURA está en UNA sola página (ver MAX_PAGES
// en el proveedor): un intento fallido ya se comió 6 de las 100 diarias sin traer nada.
// Con una página se ven 50 partidos, que alcanzan de sobra para validar el mapeo.

const { LiveTennisApiProvider, TOUR_TO_COMPETITION_KEY } = require("../providers/liveTennisApi");

const MUESTRA = 10;

function linea() {
  console.log("─".repeat(72));
}

async function run() {
  console.log("PRUEBA EN SECO — proveedor de tenis (Live Tennis API)");
  console.log("NO se escribe ninguna fila. NO se toca ningún calendario.");
  linea();

  let provider;
  try {
    provider = new LiveTennisApiProvider();
  } catch (e) {
    // getEnv lanza si falta la variable. Es el error más probable la primera vez, y este
    // script se corre en DOS lados: la máquina de Julio y el Shell de Render. Nombrar solo
    // uno manda a buscar al lugar equivocado.
    console.error(`✗ ${e.message}`);
    console.error("  Si lo corres en tu máquina: falta LIVE_TENNIS_API_KEY en el .env de la raíz del repo.");
    console.error("  Si lo corres en Render:     falta LIVE_TENNIS_API_KEY en las Environment Variables del servicio.");
    process.exitCode = 1;
    return;
  }

  const { raw, paginas, completo, error, diagnostico, ultimaMeta, motivoParo } =
    await provider.getUpcomingMatches();

  console.log(`Páginas traídas:   ${paginas}`);
  console.log(`Barrido completo:  ${completo ? "sí" : `NO — ${error}`}`);
  console.log(`Se paró por:       ${motivoParo || "—"}`);
  console.log(`Partidos crudos:   ${raw.length}`);
  // El meta de la última página, a la vista: el 29 ago 2026 decía total=194 mientras la
  // paginación entregaba 200 en páginas llenas. Si no concuerda con lo traído, hay que verlo.
  if (ultimaMeta) {
    console.log(`meta última página: count=${ultimaMeta.count} has_more=${ultimaMeta.has_more} offset=${ultimaMeta.offset} total=${ultimaMeta.total}`);
  }

  if (!completo && raw.length > 0) {
    console.log("");
    console.log("⚠️  El barrido quedó INCOMPLETO. Lo que sigue es solo lo que alcanzó a llegar.");
    console.log("   Un barrido incompleto NO significa que los partidos que faltan se cancelaron.");
  }

  if (raw.length === 0) {
    linea();
    console.log("✗ CERO PARTIDOS. Esto es un FALLO, no un resultado.");
    console.log("");
    // El rastro que faltaba la primera vez: sin esto hubo que consultar la API a mano para
    // descubrir que el bug era nuestro y no del proveedor.
    if (diagnostico) {
      console.log(`  Status HTTP de la primera página: ${diagnostico.status}`);
      console.log("  Primeros 300 caracteres del cuerpo:");
      console.log(`  ${diagnostico.cuerpo || "(cuerpo vacío)"}`);
      console.log("");
      console.log("  Si ahí se ven partidos, el bug es NUESTRO: la ruta con la que se leen no");
      console.log("  corresponde con la forma del cuerpo. Si no se ven, contestó así el proveedor.");
    } else {
      console.log("  No hubo respuesta que inspeccionar: la petición no llegó a salir.");
      console.log(`  Motivo: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  // ── Filtro ──
  const aceptados = [];
  const descartes = new Map(); // motivo → cantidad

  for (const r of raw) {
    const motivo = provider.descartar(r);
    if (motivo) {
      descartes.set(motivo, (descartes.get(motivo) || 0) + 1);
      continue;
    }
    aceptados.push(provider.normalizeMatch(r));
  }

  // Reparto de `tour` ANTES del filtro. Va aquí y no adentro de los descartes porque un
  // partido de challenger que además es qualy se descarta por qualy y su tour no se ve.
  // Sin esta vista, un mapa de tours incompleto se confunde con "el proveedor no trae nada".
  const porTourCrudo = new Map();
  for (const r of raw) {
    const t = String(r.tour || "vacío").trim().toLowerCase();
    porTourCrudo.set(t, (porTourCrudo.get(t) || 0) + 1);
  }
  linea();
  console.log("REPARTO DE `tour` EN CRUDO (antes de filtrar):");
  for (const [t, n] of [...porTourCrudo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${t}`);
  }

  linea();
  console.log(`PASAN EL FILTRO:   ${aceptados.length}`);
  console.log(`SE DESCARTAN:      ${raw.length - aceptados.length}`);
  if (descartes.size > 0) {
    // Del motivo más frecuente al menos frecuente: lo que más pesa, hasta arriba.
    const ordenados = [...descartes.entries()].sort((a, b) => b[1] - a[1]);
    for (const [motivo, n] of ordenados) {
      console.log(`   ${String(n).padStart(4)}  ${motivo}`);
    }
  }

  // ── ¿Un mismo jugador aparece escrito de dos formas? ──
  //
  // Es la comprobación más importante de todo el script, y contesta la falla más silenciosa
  // que podríamos meter. TODO el vínculo suscripción→partido es igualdad EXACTA de strings:
  // subscriptions.teamName contra homeParticipantName/awayParticipantName
  // (matchAppliesToSubscription). Si un jugador se escribe "H. Shi" en un partido y
  // "Haoxuan Shi" en otro, quien lo siguió con una escritura DEJA DE RECIBIR sus partidos
  // cuando aparece con la otra — y no truena nada: el partido se guarda, ninguna suscripción
  // lo reclama, y el usuario simplemente no se entera.
  //
  // Se recorre el barrido COMPLETO, no solo lo que pasó el filtro: un id que se escribe de
  // dos formas es un problema aunque hoy lo estemos descartando por otra razón.
  const nombresPorId = new Map(); // id → { nombres:Set, enDobles:boolean }
  for (const r of raw) {
    for (const lado of ["p1", "p2"]) {
      const p = r.players?.[lado];
      if (!p?.id || !p?.name) continue;
      let entrada = nombresPorId.get(p.id);
      if (!entrada) {
        entrada = { nombres: new Set(), enDobles: false };
        nombresPorId.set(p.id, entrada);
      }
      entrada.nombres.add(p.name);
      // En dobles el "nombre" es la pareja completa. Se marca para no confundir un choque
      // real con el efecto de mezclar parejas y jugadores bajo el mismo id.
      if (r.is_doubles) entrada.enDobles = true;
    }
  }

  const conflictos = [...nombresPorId.entries()].filter(([, e]) => e.nombres.size > 1);

  linea();
  console.log("CONSISTENCIA DE NOMBRES (id de jugador → cuántas escrituras distintas)");
  console.log(`   ids de jugador vistos:        ${nombresPorId.size}`);
  console.log(`   ids con MÁS DE UN nombre:     ${conflictos.length}`);

  if (conflictos.length === 0) {
    console.log("");
    console.log("   ✓ Ningún jugador aparece escrito de dos formas.");
    console.log("     El diseño de casar la suscripción por NOMBRE aguanta.");
  } else {
    console.log("");
    console.log("   ✗ PARARSE AQUÍ. Casar por nombre NO es seguro.");
    console.log("     La suscripción tendría que guardar el ID del jugador, no su nombre,");
    console.log("     y eso es un cambio de esquema que hay que decidir antes de seguir.");
    console.log("");
    for (const [id, e] of conflictos.slice(0, 10)) {
      console.log(`     id ${id}${e.enDobles ? "  (aparece en dobles)" : ""}`);
      for (const n of e.nombres) console.log(`        · ${n}`);
    }
    if (conflictos.length > 10) {
      console.log(`     … y ${conflictos.length - 10} más.`);
    }
    process.exitCode = 1;
  }

  if (aceptados.length === 0) {
    linea();
    console.log("✗ NINGÚN partido pasó el filtro. Esto es un FALLO, no un resultado.");
    console.log("");
    // Un ejemplo SIN NORMALIZAR. La primera corrida se fue en cero porque el mapa de tours
    // esperaba "ATP" y el proveedor manda "atp"; con un crudo a la vista se veía de
    // inmediato, sin gastar otra petición para averiguarlo.
    console.log("  Ejemplo de partido CRUDO, tal cual lo manda el proveedor:");
    console.log(JSON.stringify(raw[0], null, 2));
    process.exitCode = 1;
    return;
  }

  // ── Contexto que decide la siguiente rebanada ──
  //
  // Jugadores distintos: es el tamaño que tendría la lista del picker si sale de los
  // partidos del barrido. De eso depende si la tabla que acumula vale la pena.
  const jugadores = new Set();
  for (const m of aceptados) {
    jugadores.add(m.homeParticipantName);
    jugadores.add(m.awayParticipantName);
  }

  // Horizonte real de los datos, para confirmar los ~2.5 días con números y no de oídas.
  const fechas = aceptados.map(m => m.currentStartUtc).filter(Boolean).sort();

  // Cuántos comparten hora exacta: es el síntoma de que scheduled_time es la apertura de la
  // sesión y no la hora del partido — lo que justifica el "no antes de" en el evento.
  const porHora = new Map();
  for (const f of fechas) porHora.set(f, (porHora.get(f) || 0) + 1);
  const horaMasRepetida = [...porHora.entries()].sort((a, b) => b[1] - a[1])[0];

  linea();
  console.log(`Jugadores distintos:        ${jugadores.size}`);
  console.log(`Primer partido:             ${fechas[0] || "—"}`);
  console.log(`Último partido:             ${fechas[fechas.length - 1] || "—"}`);
  console.log(`Horas de inicio distintas:  ${porHora.size} (para ${fechas.length} partidos)`);
  if (horaMasRepetida) {
    console.log(`Hora más repetida:          ${horaMasRepetida[0]} — ${horaMasRepetida[1]} partidos`);
  }

  // Reparto por circuito, con el competitionKey que es la llave real contra subscriptions.
  const porTour = new Map();
  for (const m of aceptados) {
    porTour.set(m.competitionKey, (porTour.get(m.competitionKey) || 0) + 1);
  }
  const nombrePorKey = Object.fromEntries(
    Object.entries(TOUR_TO_COMPETITION_KEY).map(([tour, key]) => [key, tour])
  );
  console.log("Por circuito:");
  for (const [key, n] of porTour) {
    console.log(`   ${String(n).padStart(4)}  ${nombrePorKey[key] || "?"} (competitionKey ${key})`);
  }

  // ── Muestra ──
  linea();
  console.log(`MUESTRA DE ${Math.min(MUESTRA, aceptados.length)} PARTIDOS YA NORMALIZADOS`);
  console.log("(esto es exactamente lo que se guardaría en la tabla matches)");
  linea();

  for (const m of aceptados.slice(0, MUESTRA)) {
    console.log(JSON.stringify(m, null, 2));
    console.log("");
  }

  linea();
  console.log("FIN. No se escribió ninguna fila y no se tocó ningún calendario.");
}

run().catch(err => {
  console.error("PRUEBA EN SECO FALLÓ:");
  console.error(err.response?.data || err.message);
  process.exitCode = 1;
});

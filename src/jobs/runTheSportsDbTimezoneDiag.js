require("dotenv").config();

const { TheSportsDbProvider } = require("../providers/theSportsDb");

// Replica EXACTAMENTE lo que hace buildScheduledStartUtc en theSportsDb.js
function currentCodeBuild(rawEvent) {
  const eventDate = rawEvent.dateEvent || null;
  const eventTime = rawEvent.strTime || "00:00:00";
  if (!eventDate) return null;
  return `${eventDate}T${eventTime}Z`;
}

function fmtCDMX(iso) {
  if (!iso) return "(null)";
  const d = new Date(iso);
  if (isNaN(d)) return "(invalid)";
  return d.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printEvent(label, e) {
  const built = currentCodeBuild(e);
  const stamp = e.strTimestamp || null;
  const diffMin = built && stamp
    ? Math.round((new Date(built) - new Date(stamp)) / 60000)
    : null;

  console.log(`\n  [${label}] ${e.strEvent || "(no name)"}`);
  console.log(`    idEvent       : ${e.idEvent}`);
  console.log(`    dateEvent     : ${e.dateEvent}`);
  console.log(`    strTime       : ${e.strTime}`);
  console.log(`    strTimestamp  : ${stamp}`);
  console.log(`    strTimezone   : ${e.strTimezone || "(none)"}`);
  console.log(`    strTimeLocal  : ${e.strTimeLocal || "(none)"}`);
  console.log(`    strDateLocal  : ${e.strDateLocal || "(none)"}`);
  console.log(`    --- comparativa ---`);
  console.log(`    código actual : ${built}   → CDMX: ${fmtCDMX(built)}`);
  console.log(`    strTimestamp  : ${stamp}   → CDMX: ${fmtCDMX(stamp)}`);
  console.log(`    diferencia    : ${diffMin === null ? "(no se puede calcular)" : diffMin + " min"}`);
}

function pickUpcoming(events, n) {
  const now = new Date();
  return (events || [])
    .filter(e => {
      const stamp = e.strTimestamp || (e.dateEvent ? `${e.dateEvent}T${e.strTime || "00:00:00"}Z` : null);
      return stamp && new Date(stamp) >= now;
    })
    .sort((a, b) => {
      const sa = a.strTimestamp || `${a.dateEvent}T${a.strTime || "00:00:00"}Z`;
      const sb = b.strTimestamp || `${b.dateEvent}T${b.strTime || "00:00:00"}Z`;
      return new Date(sa) - new Date(sb);
    })
    .slice(0, n);
}

async function searchLeague(provider, name) {
  const axios = require("axios");
  const url = `${provider.baseUrl}/${provider.apiKey}/search_all_leagues.php`;
  const res = await axios.get(url, { params: { s: "Motorsport" }, timeout: 15000 });
  const leagues = res.data?.countries || res.data?.leagues || [];
  return leagues.filter(l => (l.strLeague || "").toLowerCase().includes(name.toLowerCase()));
}

async function run() {
  const provider = new TheSportsDbProvider();

  console.log("=".repeat(70));
  console.log("DIAGNÓSTICO DE HORARIOS — TheSportsDB (llamadas REALES a la API)");
  console.log("Hora actual local del proceso :", new Date().toString());
  console.log("Hora actual UTC                :", new Date().toISOString());
  console.log("=".repeat(70));

  // ── F1: primero descubrir el idLeague real ──
  console.log("\n████  Buscando idLeague real de Formula 1  ████");
  let f1LeagueId = null;
  try {
    const candidates = await searchLeague(provider, "Formula 1");
    console.log(`  Ligas encontradas: ${candidates.length}`);
    candidates.slice(0, 5).forEach(l => {
      console.log(`    - idLeague=${l.idLeague}  strLeague="${l.strLeague}"  strSport="${l.strSport}"  strCurrentSeason="${l.strCurrentSeason}"`);
    });
    // Tomar el primer Motorsport
    const motor = candidates.find(l => (l.strSport || "").toLowerCase() === "motorsport");
    if (motor) {
      f1LeagueId = motor.idLeague;
      console.log(`  → Usando idLeague=${f1LeagueId}`);
    }
  } catch (err) {
    console.error("  ERROR búsqueda F1:", err.response?.data || err.message);
  }

  // ── F1 ──
  console.log(`\n████  Formula 1 (idLeague=${f1LeagueId || "4443 (legacy, lo que tiene el código)"})  ████`);
  for (const idToTry of [f1LeagueId, "4443"].filter(Boolean)) {
    console.log(`\n>> Probando idLeague=${idToTry}`);
    try {
      const f1Events = await provider.getNextLeagueEvents(idToTry);
      console.log(`Eventos devueltos por eventsnextleague.php?id=${idToTry}: ${f1Events?.length || 0}`);
      const sportTypes = [...new Set((f1Events || []).map(e => e.strSport))];
      console.log(`Tipos de strSport en respuesta: ${JSON.stringify(sportTypes)}`);
      const f1Sample = pickUpcoming(f1Events, 3);
      if (f1Sample.length === 0) {
        console.log("  (no se encontraron eventos futuros en la respuesta)");
      } else {
        f1Sample.forEach((e, i) => printEvent(`F1 #${i + 1} (id=${idToTry})`, e));
      }
    } catch (err) {
      console.error(`  ERROR id=${idToTry}:`, err.response?.data || err.message);
    }
  }

  // ── La Liga ──
  console.log("\n\n████  La Liga (idLeague=4335)  ████");
  try {
    const liga = await provider.getNextLeagueEvents("4335");
    console.log(`Eventos devueltos por eventsnextleague.php: ${liga?.length || 0}`);
    const ligaSample = pickUpcoming(liga, 3);
    if (ligaSample.length === 0) {
      console.log("  (no se encontraron eventos futuros en la respuesta)");
    } else {
      ligaSample.forEach((e, i) => printEvent(`LaLiga #${i + 1}`, e));
    }
  } catch (err) {
    console.error("  ERROR LaLiga:", err.response?.data || err.message);
  }

  console.log("\n" + "=".repeat(70));
  console.log("FIN DEL DIAGNÓSTICO");
  console.log("=".repeat(70));
}

run().catch(err => {
  console.error("DIAGNÓSTICO FALLÓ:", err);
  process.exit(1);
});

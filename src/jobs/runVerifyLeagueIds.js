require("dotenv").config();

const axios = require("axios");
const { TheSportsDbProvider } = require("../providers/theSportsDb");

// Ligas hardcoded en el código (consolidando frontend LeaguePicker + backfill database.js)
// Formato: { codeId, expectedName, expectedSport, source }
const HARDCODED = [
  // Fútbol — Europa
  { codeId: "4335", expectedName: "La Liga",          expectedSport: "Soccer",       source: "frontend/LeaguePicker, database.js backfill" },
  { codeId: "4400", expectedName: "Segunda División", expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4483", expectedName: "Copa del Rey",     expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4328", expectedName: "Premier League",   expectedSport: "Soccer",       source: "frontend/LeaguePicker, database.js backfill" },
  { codeId: "4329", expectedName: "Championship",     expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4482", expectedName: "FA Cup",           expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4331", expectedName: "Bundesliga",       expectedSport: "Soccer",       source: "frontend/LeaguePicker, database.js (Ligue 1 ❌)" },
  { codeId: "4399", expectedName: "2. Bundesliga",    expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4485", expectedName: "DFB Pokal",        expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4332", expectedName: "Serie A",          expectedSport: "Soccer",       source: "frontend/LeaguePicker, database.js (Bundesliga ❌)" },
  { codeId: "4334", expectedName: "Ligue 1",          expectedSport: "Soccer",       source: "frontend/LeaguePicker, database.js (Serie A ❌)" },
  { codeId: "4344", expectedName: "Primeira Liga",    expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4350", expectedName: "Liga MX",          expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4351", expectedName: "Brasileirão",      expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  { codeId: "4406", expectedName: "Argentina Primera",expectedSport: "Soccer",       source: "frontend/LeaguePicker" },
  // Continental
  { codeId: "4480", expectedName: "Champions League",  expectedSport: "Soccer",      source: "frontend/LeaguePicker, database.js" },
  { codeId: "4481", expectedName: "Europa League",     expectedSport: "Soccer",      source: "frontend/LeaguePicker" },
  { codeId: "5071", expectedName: "Conference League", expectedSport: "Soccer",      source: "frontend/LeaguePicker" },
  { codeId: "4501", expectedName: "Copa Libertadores", expectedSport: "Soccer",      source: "frontend/LeaguePicker" },
  // Basket
  { codeId: "4387", expectedName: "NBA",         expectedSport: "Basketball",         source: "frontend/LeaguePicker, database.js" },
  { codeId: "4516", expectedName: "WNBA",        expectedSport: "Basketball",         source: "frontend/LeaguePicker" },
  { codeId: "4607", expectedName: "NCAA",        expectedSport: "Basketball",         source: "frontend/LeaguePicker" },
  { codeId: "4546", expectedName: "EuroLeague",  expectedSport: "Basketball",         source: "frontend/LeaguePicker" },
  { codeId: "4408", expectedName: "ACB Liga",    expectedSport: "Basketball",         source: "frontend/LeaguePicker" },
  // Americano
  { codeId: "4391", expectedName: "NFL",         expectedSport: "American Football",  source: "frontend/LeaguePicker (database.js → NHL ❌)" },
  { codeId: "4479", expectedName: "NCAA Football", expectedSport: "American Football", source: "frontend/LeaguePicker" },
  { codeId: "4405", expectedName: "CFL",         expectedSport: "American Football",  source: "frontend/LeaguePicker" },
  { codeId: "4346", expectedName: "(database.js dice NFL — verificar)", expectedSport: "(?)", source: "database.js backfill" },
  // Motorsport
  { codeId: "4370", expectedName: "Fórmula 1",   expectedSport: "Motorsport",         source: "frontend/LeaguePicker" },
  { codeId: "4373", expectedName: "IndyCar",     expectedSport: "Motorsport",         source: "frontend/LeaguePicker" },
  { codeId: "4393", expectedName: "NASCAR",      expectedSport: "Motorsport",         source: "frontend/LeaguePicker" },
  { codeId: "4407", expectedName: "MotoGP",      expectedSport: "Motorsport",         source: "frontend/LeaguePicker" },
  { codeId: "4409", expectedName: "WRC",         expectedSport: "Motorsport",         source: "frontend/LeaguePicker" },
  { codeId: "4443", expectedName: "UFC",         expectedSport: "Fighting",           source: "frontend/LeaguePicker (database.js → Formula 1 ❌)" },
  // Béisbol
  { codeId: "4424", expectedName: "MLB",         expectedSport: "Baseball",           source: "frontend/LeaguePicker, database.js" },
  { codeId: "5064", expectedName: "Liga Mexicana",expectedSport: "Baseball",          source: "frontend/LeaguePicker" },
  { codeId: "4591", expectedName: "NPB",         expectedSport: "Baseball",           source: "frontend/LeaguePicker" },
  // Tenis
  { codeId: "4464", expectedName: "ATP Tour",    expectedSport: "Tennis",             source: "frontend/LeaguePicker" },
  { codeId: "4517", expectedName: "WTA Tour",    expectedSport: "Tennis",             source: "frontend/LeaguePicker" },
  // Combate
  { codeId: "4445", expectedName: "Boxeo",       expectedSport: "Fighting",           source: "frontend/LeaguePicker" },
  // Hockey
  { codeId: "4380", expectedName: "NHL",         expectedSport: "Ice Hockey",         source: "frontend/LeaguePicker" },
  { codeId: "4920", expectedName: "KHL",         expectedSport: "Ice Hockey",         source: "frontend/LeaguePicker" },
  // Rugby
  { codeId: "4714", expectedName: "Six Nations", expectedSport: "Rugby",              source: "frontend/LeaguePicker" },
  // Golf
  { codeId: "4425", expectedName: "PGA Tour",    expectedSport: "Golf",               source: "frontend/LeaguePicker" },
  { codeId: "4426", expectedName: "DP World Tour",expectedSport: "Golf",              source: "frontend/LeaguePicker" },
  { codeId: "4553", expectedName: "LPGA Tour",   expectedSport: "Golf",               source: "frontend/LeaguePicker" },
  { codeId: "5329", expectedName: "LIV Golf",    expectedSport: "Golf",               source: "frontend/LeaguePicker" },
];

async function lookupLeague(provider, leagueId) {
  const url = `${provider.baseUrl}/${provider.apiKey}/lookupleague.php`;
  try {
    const res = await axios.get(url, { params: { id: leagueId }, timeout: 15000 });
    const league = res.data?.leagues?.[0] || null;
    return league;
  } catch (err) {
    return { _error: err.response?.status || err.message };
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const provider = new TheSportsDbProvider();

  console.log("=".repeat(110));
  console.log("VERIFICACIÓN DE IDs DE LIGAS — código FanSchedule vs TheSportsDB real");
  console.log("=".repeat(110));

  const results = [];
  for (const entry of HARDCODED) {
    const real = await lookupLeague(provider, entry.codeId);
    const realName  = real?.strLeague || real?._error || "(no encontrado)";
    const realSport = real?.strSport || "—";
    const matches =
      real && real.strLeague &&
      entry.expectedSport !== "(?)" &&
      (real.strSport || "").toLowerCase() === entry.expectedSport.toLowerCase();
    results.push({ ...entry, realName, realSport, matches });
    await sleep(120); // gentle on API
  }

  // Imprimir tabla
  const fmt = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  console.log();
  console.log(
    fmt("ID", 6) +
    fmt("Código dice", 24) +
    fmt("Sport esperado", 18) +
    fmt("API dice (strLeague)", 34) +
    fmt("API dice (strSport)", 16) +
    "¿coincide?"
  );
  console.log("-".repeat(110));
  for (const r of results) {
    const ok = r.matches ? "OK ✓" : "MAL ✗";
    console.log(
      fmt(r.codeId, 6) +
      fmt(r.expectedName, 24) +
      fmt(r.expectedSport, 18) +
      fmt(r.realName, 34) +
      fmt(r.realSport, 16) +
      ok
    );
  }

  // Sumario de discrepancias
  const bad = results.filter(r => !r.matches);
  console.log("\n" + "=".repeat(110));
  console.log(`DISCREPANCIAS: ${bad.length} de ${results.length}`);
  console.log("=".repeat(110));
  for (const r of bad) {
    console.log(`\n[${r.codeId}]`);
    console.log(`  El código dice : "${r.expectedName}" (${r.expectedSport})  — fuente: ${r.source}`);
    console.log(`  La API dice    : "${r.realName}" (${r.realSport})`);
  }
}

run().catch(err => {
  console.error("VERIFICACIÓN FALLÓ:", err);
  process.exit(1);
});

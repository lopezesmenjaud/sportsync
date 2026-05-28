require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { oauth2Client } = require("./src/config/googleClient");
const { saveTokens } = require("./src/config/googleTokenStore");
const { initializeDatabase, db } = require("./src/db/database");
const { subscriptionRepository } = require("./src/repositories/subscriptionRepositorySqlite");
const { googleAccountRepository } = require("./src/repositories/googleAccountRepositorySqlite");
const { syncMatchToCalendars } = require("./src/services/calendarSyncService");
const { syncMatches, syncLeague, syncTeam, normalizeSport } = require("./src/services/syncService");
const { matchRepository } = require("./src/repositories/matchRepositorySqlite");
const { startScheduler } = require("./src/services/scheduler");
const { calendarEventRepository } = require("./src/repositories/calendarEventRepositorySqlite");
const googleCalendarProvider = require("./src/services/googleCalendarProvider");

const app = express();
const PORT = process.env.PORT || 3000;

const SPORTSDB_KEY = process.env.THE_SPORTS_DB_API_KEY || process.env.SPORTSDB_API_KEY || "123";

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://192.168.1.101:5173",
    "https://fanschedule.com",
    "https://www.fanschedule.com",
    "https://fanschedule.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

initializeDatabase().then(() => {
  startScheduler();
});

const SPORT_MAP = {
  futbol:           "Soccer",
  basketball:       "Basketball",
  futbol_americano: "American Football",
  automovilismo:    "Motorsport",
  baseball:         "Baseball",
  tenis:            "Tennis",
  combate:          "Fighting",
  rugby:            "Rugby",
  hockey:           "Ice Hockey",
  voleibol:         "Volleyball",
  golf:             "Golf"
};

const COUNTRY_ES_TO_EN = {
  "españa":               "Spain",
  "méxico":               "Mexico",
  "alemania":             "Germany",
  "francia":              "France",
  "italia":               "Italy",
  "portugal":             "Portugal",
  "inglaterra":           "England",
  "países bajos":         "Netherlands",
  "bélgica":              "Belgium",
  "argentina":            "Argentina",
  "brasil":               "Brazil",
  "colombia":             "Colombia",
  "chile":                "Chile",
  "perú":                 "Peru",
  "uruguay":              "Uruguay",
  "ecuador":              "Ecuador",
  "paraguay":             "Paraguay",
  "bolivia":              "Bolivia",
  "venezuela":            "Venezuela",
  "estados unidos":       "United States",
  "reino unido":          "United Kingdom",
  "japón":                "Japan",
  "corea del sur":        "South Korea",
  "australia":            "Australia",
  "rusia":                "Russia",
  "china":                "China",
  "marruecos":            "Morocco",
  "nigeria":              "Nigeria",
  "costa rica":           "Costa Rica",
  "honduras":             "Honduras",
  "guatemala":            "Guatemala",
  "el salvador":          "El Salvador",
  "panamá":               "Panama",
  "república dominicana": "Dominican Republic",
  "cuba":                 "Cuba",
};

function normalizeCountry(rawCountry) {
  if (!rawCountry) return null;
  const lower = rawCountry.toLowerCase().trim();
  return COUNTRY_ES_TO_EN[lower] || rawCountry;
}

// Helper para fetch seguro que no crashea con HTML
async function safeFetchJson(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    if (text.trim().startsWith("<")) return null; // TheSportsDB devolvió HTML de error
    return JSON.parse(text);
  } catch {
    return null;
  }
}


// ─────────────────────────────────────────────
// Helpers resumen IA con caché
// ─────────────────────────────────────────────
function saveSummaryToDb(providerMatchId, summary) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run(
      `UPDATE matches SET ai_summary = ?, summary_generated_at = ? WHERE providerMatchId = ?`,
      [summary, now, providerMatchId],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
}

function getSummaryFromDb(providerMatchId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ai_summary, summary_generated_at, currentStartUtc FROM matches WHERE providerMatchId = ?`,
      [providerMatchId],
      (err, row) => { if (err) reject(err); else resolve(row); }
    );
  });
}

async function getSmartSummary(match) {
  const now            = new Date();
  const matchDate      = new Date(match.currentStartUtc);
  const daysUntilMatch = (matchDate - now) / (1000 * 60 * 60 * 24);

  if (daysUntilMatch > 7) {
    return { summary: null, source: "too_far", reason: "El partido es en más de 7 días." };
  }
  if (!match.homeParticipantName || !match.awayParticipantName ||
      match.homeParticipantName === "TBD" || match.awayParticipantName === "TBD") {
    return { summary: null, source: "tbd", reason: "Los rivales aún no están confirmados." };
  }

  const stored = await getSummaryFromDb(match.providerMatchId);
  if (stored?.ai_summary && stored?.summary_generated_at) {
    const generatedAt  = new Date(stored.summary_generated_at);
    const todayStr     = now.toISOString().slice(0, 10);
    const generatedStr = generatedAt.toISOString().slice(0, 10);
    if (generatedStr === todayStr) {
      const minutesDiff = Math.abs(new Date(match.currentStartUtc) - new Date(stored.currentStartUtc || match.currentStartUtc)) / (1000 * 60);
      if (minutesDiff < 60) {
        console.log(`[summary] Using cached summary for ${match.providerMatchId}`);
        return { summary: stored.ai_summary, source: "cache" };
      }
    }
  }

  console.log(`[summary] Generating new summary for ${match.homeParticipantName} vs ${match.awayParticipantName}...`);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Genera un resumen pre-partido breve y emocionante (máximo 3 oraciones) para este partido de ${match.sport}:
${match.homeParticipantName} vs ${match.awayParticipantName}
Competición: ${match.competitionName}
Fecha: ${match.currentStartUtc}
Responde solo con el resumen, sin títulos ni formato extra.`
      }]
    })
  });

  const data    = await response.json();
  const summary = data.content?.[0]?.text || "Resumen no disponible.";
  await saveSummaryToDb(match.providerMatchId, summary);
  console.log(`[summary] Saved new summary for ${match.providerMatchId}`);
  return { summary, source: "generated" };
}

// ─────────────────────────────────────────────
// Helpers broadcasting IA con caché
// ─────────────────────────────────────────────
function getBroadcastingFromDb(competitionKey, country) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT data, createdAtUtc FROM broadcasting_cache WHERE competitionKey = ? AND country = ?`,
      [competitionKey, country],
      (err, row) => { if (err) reject(err); else resolve(row); }
    );
  });
}

function saveBroadcastingToDb(competitionKey, competitionName, country, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO broadcasting_cache (competitionKey, competitionName, country, data, createdAtUtc) VALUES (?, ?, ?, ?, ?)`,
      [competitionKey, competitionName, country, JSON.stringify(data), new Date().toISOString()],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
}

// ─────────────────────────────────────────────
// RUTAS
// ─────────────────────────────────────────────

app.get("/", (req, res) => res.send("SportSync backend running"));

// ── Google OAuth ──
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Detecta si el request viene de la red local o de localhost
function getOriginInfo(req) {
  const host = req.hostname;
  const isLan = host !== "localhost" && host !== "127.0.0.1";
  const backendBase = isLan ? `http://${host}:${PORT}` : `http://localhost:${PORT}`;
  const frontendBase = process.env.FRONTEND_URL || (isLan ? `http://${host}:5173` : "http://localhost:5173");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${backendBase}/auth/google/callback`;
  return { backendBase, frontendBase, redirectUri };
}

app.get("/auth/google", (req, res) => {
  const { redirectUri } = getOriginInfo(req);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    redirect_uri: redirectUri,
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  const { redirectUri, frontendBase } = getOriginInfo(req);
  console.log(`[auth] Callback hit. redirectUri=${redirectUri} frontendBase=${frontendBase}`);
  console.log(`[auth] Query params:`, req.query);
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing authorization code");

    console.log(`[auth] Exchanging code for tokens...`);
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: redirectUri });
    oauth2Client.setCredentials(tokens);
    console.log(`[auth] Tokens received. access_token=${tokens.access_token?.slice(0,20)}...`);

    const oauth2 = require("googleapis").google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();
    console.log(`[auth] Profile: email=${profile.email} name=${profile.name}`);

    const userId = profile.email;
    await googleAccountRepository.upsert({
      userId,
      googleEmail: profile.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      scope: tokens.scope,
      expiryDate: tokens.expiry_date,
    });

    saveTokens(tokens);

    const userObj = { userId, email: profile.email, name: profile.name || profile.email.split("@")[0] };
    const userParam = encodeURIComponent(JSON.stringify(userObj));
    const finalUrl = `${frontendBase}/dashboard?google=connected&user=${userParam}`;
    console.log(`[auth] SUCCESS. Redirecting to: ${finalUrl}`);
    res.redirect(finalUrl);
  } catch (error) {
    console.error("[auth] OAuth callback ERROR:", error.message);
    console.error("[auth] Full error:", error.response?.data || error.stack);
    const errorUrl = `${frontendBase}/?google=error`;
    console.log(`[auth] Redirecting to error: ${errorUrl}`);
    res.redirect(errorUrl);
  }
});

app.get("/auth/google/status/:userId", async (req, res) => {
  try {
    const account = await googleAccountRepository.getByUserId(req.params.userId);
    res.json({
      ok: true,
      connected: !!account,
      email: account?.googleEmail || null,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Detectar país por IP ──
app.get("/api/detect-country", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
               || req.socket.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "") {
      return res.json({ ok: true, country: "Mexico", countryCode: "MX", source: "default" });
    }
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`);
    const data     = await response.json();
    if (data.status === "success") {
      res.json({ ok: true, country: data.country, countryCode: data.countryCode, source: "ip" });
    } else {
      res.json({ ok: true, country: "Mexico", countryCode: "MX", source: "default" });
    }
  } catch (error) {
    res.json({ ok: true, country: "Mexico", countryCode: "MX", source: "default" });
  }
});

// ── Broadcasting IA con caché ──
app.get("/api/broadcasting/:competitionKey/:country", async (req, res) => {
  try {
    const { competitionKey, country } = req.params;
    const competitionName = req.query.competitionName || competitionKey;

    const cached = await getBroadcastingFromDb(competitionKey, country);
    if (cached) {
      const ageDays = (Date.now() - new Date(cached.createdAtUtc)) / (1000 * 60 * 60 * 24);
      if (ageDays < 30) {
        console.log(`[broadcasting] Cache hit: ${competitionKey} / ${country}`);
        return res.json({ ok: true, data: JSON.parse(cached.data), source: "cache" });
      }
    }

    console.log(`[broadcasting] Generating for: ${competitionName} / ${country}`);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Eres un experto en derechos de transmisión deportiva. Para la competición "${competitionName}" en el país "${country}", dime en qué canales se puede ver en 2026.

Reglas importantes:
- Responde SOLO con un JSON válido, sin texto adicional
- Sé específico para el país indicado, no des canales de otros países
- Para México en específico: F1 ya NO se transmite por Fox Sports desde 2025, ahora es exclusivo de Sky Sports (Izzi/Sky) y F1 TV Pro
- Para deportes como NFL donde los partidos rotan de canal, incluye todos los posibles y agrega una nota en el campo "note"
- Si no tienes certeza, es mejor omitir un canal que incluir uno incorrecto
- Incluye URLs oficiales de las plataformas de streaming cuando las conozcas

Responde SOLO con este JSON:
{
  "freeTV": ["canal1", "canal2"],
  "paidTV": ["canal1", "canal2"],
  "streaming": [{"name": "nombre", "url": "https://..."}],
  "note": "Nota opcional sobre rotación de canales o cambios recientes"
}

Competición: ${competitionName}
País: ${country}`
        }]
      })
    });

    const aiData = await response.json();
    const text   = aiData.content?.[0]?.text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { freeTV: [], paidTV: [], streaming: [] };
    }

    await saveBroadcastingToDb(competitionKey, competitionName, country, parsed);
    console.log(`[broadcasting] Saved: ${competitionKey} / ${country}`);
    res.json({ ok: true, data: parsed, source: "generated" });

  } catch (error) {
    console.error("[broadcasting] Error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Limpiar caché de broadcasting ──
app.delete("/api/broadcasting/:competitionKey/:country", (req, res) => {
  const { competitionKey, country } = req.params;
  db.run(
    `DELETE FROM broadcasting_cache WHERE competitionKey = ? AND country = ?`,
    [competitionKey, country],
    (err) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      console.log(`[broadcasting] Cache cleared: ${competitionKey} / ${country}`);
      res.json({ ok: true, message: `Cache cleared for ${competitionKey} / ${country}` });
    }
  );
});

// ── Ligas desde TheSportsDB ──
app.get("/api/leagues/:sport", async (req, res) => {
  try {
    const { sport } = req.params;
    const sportName = SPORT_MAP[sport];
    if (!sportName) return res.status(400).json({ ok: false, error: `Deporte no soportado: ${sport}` });
    const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/search_all_leagues.php?s=${encodeURIComponent(sportName)}`;
    const data = await safeFetchJson(url);
    const leagues = ((data?.leagues || data?.countries) || []).map(l => ({
      id: l.idLeague, name: l.strLeague, country: l.strCountry || "Internacional"
    }));
    res.json({ ok: true, leagues });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Equipos desde TheSportsDB ──
// Estrategia robusta con múltiples intentos
app.get("/api/teams/:leagueId", async (req, res) => {
  try {
    const { leagueId } = req.params;
    const leagueName   = req.query.leagueName || null;

    let teams = [];

    // Intento 1: buscar por nombre exacto
    if (leagueName) {
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
      const data = await safeFetchJson(url);
      if (data?.teams?.length > 0) {
        teams = data.teams.map(t => ({
          id: t.idTeam, name: t.strTeam,
          initials: t.strTeamShort || t.strTeam.substring(0, 3).toUpperCase(),
          country: t.strCountry || "", badge: t.strBadge || null
        }));
        console.log(`[teams] Found ${teams.length} teams by name: "${leagueName}"`);
      }
    }

    // Intento 2: buscar por ID
    if (teams.length === 0) {
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/lookup_all_teams.php?id=${leagueId}`;
      const data = await safeFetchJson(url);
      if (data?.teams?.length > 0) {
        teams = data.teams.map(t => ({
          id: t.idTeam, name: t.strTeam,
          initials: t.strTeamShort || t.strTeam.substring(0, 3).toUpperCase(),
          country: t.strCountry || "", badge: t.strBadge || null
        }));
        console.log(`[teams] Found ${teams.length} teams by ID: ${leagueId}`);
      } else {
        console.log(`[teams] Intento 2 failed for ID ${leagueId} (data=${data === null ? 'null/HTML' : 'empty'})`);
      }
    }

    // Intento 3: buscar por nombre con prefijo del país (ej: "Spanish La Liga")
    if (teams.length === 0 && leagueName) {
      const prefixes = ["Spanish ", "English ", "Italian ", "German ", "French ", "Mexican ", "American ", "Brazilian ", "Portuguese ", "Dutch ", "Belgian ", "Scottish ", "Turkish ", "Japanese ", "Australian "];
      for (const prefix of prefixes) {
        const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/search_all_teams.php?l=${encodeURIComponent(prefix + leagueName)}`;
        const data = await safeFetchJson(url);
        if (data?.teams?.length > 0) {
          teams = data.teams.map(t => ({
            id: t.idTeam, name: t.strTeam,
            initials: t.strTeamShort || t.strTeam.substring(0, 3).toUpperCase(),
            country: t.strCountry || "", badge: t.strBadge || null
          }));
          console.log(`[teams] Found ${teams.length} teams with prefix "${prefix}${leagueName}"`);
          break;
        }
      }
    }

    console.log(`[teams] League ${leagueName || leagueId}: ${teams.length} teams total`);
    res.json({ ok: true, teams });
  } catch (error) {
    console.error("[teams] Error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Jugadores desde TheSportsDB (tenis, etc.) ──
app.get("/api/players/:leagueId", async (req, res) => {
  try {
    const { leagueId } = req.params;
    const leagueName   = req.query.leagueName || null;

    let players = [];

    // Paso 1: obtener el "team" de la liga (en tenis, el tour es un team)
    let teamId = null;

    if (leagueName) {
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
      const data = await safeFetchJson(url);
      if (data?.teams?.length > 0) {
        teamId = data.teams[0].idTeam;
        console.log(`[players] Found team "${data.teams[0].strTeam}" (${teamId}) for league "${leagueName}"`);
      }
    }

    // Fallback: buscar por ID de liga
    if (!teamId) {
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/lookup_all_teams.php?id=${leagueId}`;
      const data = await safeFetchJson(url);
      if (data?.teams?.length > 0) {
        teamId = data.teams[0].idTeam;
        console.log(`[players] Found team by league ID ${leagueId}: ${teamId}`);
      }
    }

    // Paso 2: obtener jugadores del team
    if (teamId) {
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/lookup_all_players.php?id=${teamId}`;
      const data = await safeFetchJson(url);
      if (data?.player?.length > 0) {
        players = data.player.map(p => ({
          id: p.idPlayer,
          name: p.strPlayer,
          nationality: p.strNationality || "",
          photo: p.strThumb || p.strCutout || p.strRender || null,
          position: p.strPosition || "",
          dateBorn: p.dateBorn || null,
        }));
        console.log(`[players] Found ${players.length} players for team ${teamId}`);
      }
    }

    // Paso 3: si no hay jugadores con lookup, buscar por nombre de equipo
    if (players.length === 0 && leagueName) {
      const searchName = leagueName.replace("World ", "").replace("Tour", "").trim();
      const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/searchplayers.php?t=${encodeURIComponent(searchName)}`;
      const data = await safeFetchJson(url);
      if (data?.player?.length > 0) {
        players = data.player.map(p => ({
          id: p.idPlayer,
          name: p.strPlayer,
          nationality: p.strNationality || "",
          photo: p.strThumb || p.strCutout || p.strRender || null,
          position: p.strPosition || "",
          dateBorn: p.dateBorn || null,
        }));
        console.log(`[players] Found ${players.length} players by search "${searchName}"`);
      }
    }

    console.log(`[players] League ${leagueName || leagueId}: ${players.length} players total`);
    res.json({ ok: true, players });
  } catch (error) {
    console.error("[players] Error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Detalle de un partido ──
app.get("/api/match/:matchId", async (req, res) => {
  try {
    const match = await matchRepository.getByProviderMatchId(req.params.matchId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    res.json({ ok: true, match });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Boletos (Ticketmaster + StubHub) ──
app.get("/api/tickets/:matchId", async (req, res) => {
  try {
    const match = await matchRepository.getByProviderMatchId(req.params.matchId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

    const home = match.homeParticipantName || "";
    const away = match.awayParticipantName || "";
    const keyword = `${home} ${away}`;
    const tmKey = process.env.TICKETMASTER_API_KEY;

    // StubHub (siempre disponible — link de búsqueda)
    const stubhubUrl = `https://www.stubhub.com/search?q=${encodeURIComponent(keyword)}`;

    // Ticketmaster Discovery API
    let ticketmaster = null;
    if (tmKey) {
      try {
        const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${tmKey}&keyword=${encodeURIComponent(keyword)}&size=3&sort=date,asc`;
        const tmData = await safeFetchJson(tmUrl);
        const events = tmData?._embedded?.events || [];
        if (events.length > 0) {
          ticketmaster = events.map(e => ({
            name: e.name,
            date: e.dates?.start?.localDate || null,
            venue: e._embedded?.venues?.[0]?.name || null,
            url: e.url,
            priceRange: e.priceRanges?.[0] ? `${e.priceRanges[0].currency} ${e.priceRanges[0].min}–${e.priceRanges[0].max}` : null,
          }));
        }
      } catch (err) {
        console.error("[tickets] Ticketmaster error:", err.message);
      }
    }

    // Ticketmaster búsqueda general como fallback
    const tmSearchUrl = `https://www.ticketmaster.com/search?q=${encodeURIComponent(keyword)}`;

    res.json({
      ok: true,
      keyword,
      stubhubUrl,
      ticketmasterSearchUrl: tmSearchUrl,
      ticketmasterEvents: ticketmaster,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Helper para /api/nearby: variantes de temporada candidatas para eventsseason.php,
// según el deporte de la liga (strSport viene en inglés desde TheSportsDB).
function guessSeasonsForLeague(league) {
  const sport = (league.strSport || "").toLowerCase().trim();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (sport === "american football") {
    return month >= 8 ? [`${year}`, `${year - 1}`] : [`${year - 1}`, `${year}`];
  }
  if (["motorsport", "baseball", "tennis", "fighting", "rugby", "golf"].includes(sport)) {
    return [`${year}`, `${year - 1}`];
  }
  if (["soccer", "basketball", "ice hockey", "volleyball"].includes(sport)) {
    const splitCurrent = month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    const splitOther   = month >= 8 ? `${year - 1}-${year}` : `${year}-${year + 1}`;
    return [splitCurrent, splitOther, `${year}`];
  }
  return [`${year}`, `${year - 1}-${year}`, `${year}-${year + 1}`];
}

// ── Partidos por ubicación (Cerca de mí + Planear viaje) ──
app.post("/api/nearby", async (req, res) => {
  console.log("[nearby] *** ENDPOINT HIT ***", req.body);
  try {
    const { lat, lon, city, country } = req.body;

    if (!lat || !lon || !country) {
      return res.status(400).json({ ok: false, error: "Se requieren lat, lon y country." });
    }

    const location = { city: city || "Tu ciudad", country, lat, lon };
    const cityNorm = (location.city || "").toLowerCase();

    // Limpiar caché de venues para esta ciudad (re-evaluar con criterios frescos)
    db.run("DELETE FROM venue_city_cache WHERE targetCity = ?", [cityNorm], () => {});

    // 2. Buscar ligas del país en todos los deportes (con caché SQLite de 24h)
    const getLeagueCache = (country, sport) => new Promise((resolve, reject) => {
      db.get(`SELECT data, cachedAt FROM league_country_cache WHERE country = ? AND sport = ?`,
        [country, sport],
        (err, row) => { if (err) reject(err); else resolve(row || null); });
    });
    const setLeagueCache = (country, sport, data) => new Promise((resolve, reject) => {
      db.run(`INSERT OR REPLACE INTO league_country_cache (country, sport, data, cachedAt) VALUES (?, ?, ?, ?)`,
        [country, sport, JSON.stringify(data), new Date().toISOString()],
        (err) => { if (err) reject(err); else resolve(); });
    });

    const sportEntries = Object.values(SPORT_MAP);
    const leagueResults = await Promise.all(
      sportEntries.map(async (sportName) => {
        // Buscar en caché (válido por 24h)
        const cached = await getLeagueCache(country, sportName);
        if (cached) {
          const age = Date.now() - new Date(cached.cachedAt).getTime();
          if (age < 24 * 60 * 60 * 1000) {
            return JSON.parse(cached.data);
          }
        }

        // No hay caché válido — llamar a TheSportsDB
        const url  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/search_all_leagues.php?s=${encodeURIComponent(sportName)}&c=${encodeURIComponent(country)}`;
        let data = await safeFetchJson(url);
        let results = data?.leagues || data?.countries || [];
        if (results.length === 0) {
          await new Promise(r => setTimeout(r, 500));
          data = await safeFetchJson(url);
          results = data?.leagues || data?.countries || [];
        }

        // Guardar en caché
        await setLeagueCache(country, sportName, results);
        return results;
      })
    );
    const allLeagues = leagueResults.flat().filter(Boolean);
    const uniqueLeagues = [...new Map(allLeagues.map(l => [l.idLeague, l])).values()];
    console.log(`[nearby] Found ${uniqueLeagues.length} leagues in ${country}`);

    if (uniqueLeagues.length === 0) {
      return res.json({ ok: true, location, matches: [] });
    }

    // 3. Obtener próximos eventos de cada liga (paralelo)
    //
    // Estrategia dual: eventsnextleague.php devuelve "los próximos N" (~15 free,
    // ~50 premium; el parámetro &e=N en este endpoint es ignorado por TheSportsDB).
    // Para ligas con calendario denso (p.ej. Liga Mexicana de Béisbol) eso puede
    // ser apenas ~2 días. Si la respuesta no alcanza windowToDate, complementamos
    // con eventsseason.php (devuelve la temporada completa) usando la primera
    // variante de temporada con resultados.
    const nowMxNearby = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const windowFromDate = nowMxNearby.toISOString().split('T')[0];
    const windowToDate = new Date(nowMxNearby.getTime() + 30 * 86400000).toISOString().split('T')[0];

    const eventResults = await Promise.all(
      uniqueLeagues.map(async (league) => {
        // a) eventsnextleague.php — próximos eventos rápidos
        const nextUrl  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsnextleague.php?id=${league.idLeague}`;
        const nextData = await safeFetchJson(nextUrl);
        const nextEvents = nextData?.events || [];

        const lastNextDate = nextEvents.reduce((max, e) => {
          const d = e?.dateEvent || "";
          return d > max ? d : max;
        }, "");
        const coversWindow = lastNextDate && lastNextDate >= windowToDate;

        let combined = nextEvents;
        let seasonContribution = 0;
        let seasonUsed = null;

        if (!coversWindow) {
          // b) eventsseason.php — primera variante de temporada con eventos gana
          const seasons = guessSeasonsForLeague(league);
          for (const season of seasons) {
            const seasonUrl  = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsseason.php?id=${league.idLeague}&s=${encodeURIComponent(season)}`;
            const seasonData = await safeFetchJson(seasonUrl);
            const seasonEvents = seasonData?.events || [];
            if (seasonEvents.length > 0) {
              const seenIds = new Set(combined.map(e => e?.idEvent).filter(Boolean));
              const newOnes = seasonEvents.filter(e => e?.idEvent && !seenIds.has(e.idEvent));
              combined = [...combined, ...newOnes];
              seasonContribution = newOnes.length;
              seasonUsed = season;
              break;
            }
          }
        }

        console.log(
          `[nearby] DEBUG liga ${league.strLeague || league.idLeague} → ${combined.length} eventos ` +
          `(eventsnextleague=${nextEvents.length}${
            seasonUsed
              ? `, +${seasonContribution} via eventsseason s=${seasonUsed}`
              : (coversWindow ? ", season no requerido" : ", season sin resultados")
          })`
        );

        return combined.map(e => ({ ...e, _leagueName: league.strLeague, _leagueSport: league.strSport }));
      })
    );
    const allEvents = eventResults.flat();
    console.log(`[nearby] DEBUG total eventos: ${allEvents.length}`);
    console.log(`[nearby] DEBUG eventos SIN strVenue: ${allEvents.filter(e => !e.strVenue).length}`);

    // Pre-filtrar a la ventana de 30 días ANTES de la clasificación de venues.
    // Sin esto, eventsseason.php infla uniqueVenues con eventos lejanos que
    // igual se descartan al final, encareciendo Claude innecesariamente.
    const eventsInWindow = allEvents.filter(e => {
      const d = e.dateEvent;
      return d && d >= windowFromDate && d <= windowToDate;
    });
    console.log(`[nearby] DEBUG eventos en ventana 30d: ${eventsInWindow.length}`);

    // 4. Resolver si cada venue está en la ciudad buscada (caché SQLite + Claude AI)

    // Lista de "lugares" a clasificar: estadios cuando el evento trae strVenue,
    // equipo local (strHomeTeam) como fallback cuando NO trae strVenue.
    // Esto evita descartar partidos que TheSportsDB devuelve sin estadio.
    const uniqueVenues = [...new Set(
      eventsInWindow.flatMap(e => e.strVenue ? [e.strVenue] : (e.strHomeTeam ? [e.strHomeTeam] : []))
    )];
    console.log(`[nearby] DEBUG venues únicos: ${JSON.stringify(uniqueVenues)}`);

    // Helper: leer venue_city_cache para un (venue, targetCity)
    const getVenueCityCache = (venue, targetCity) => new Promise((resolve, reject) => {
      db.get(`SELECT inTargetCity FROM venue_city_cache WHERE venue = ? AND targetCity = ?`,
        [venue, targetCity],
        (err, row) => { if (err) reject(err); else resolve(row || null); });
    });

    // Helper: escribir venue_city_cache
    const setVenueCityCache = (venue, targetCity, city, inTarget) => new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO venue_city_cache (venue, targetCity, city, inTargetCity, cachedAt) VALUES (?, ?, ?, ?, ?)`,
        [venue, targetCity, city, inTarget ? 1 : 0, new Date().toISOString()],
        (err) => { if (err) reject(err); else resolve(); });
    });

    // Separar cached vs uncached para esta ciudad específica
    const venueInCity = new Map(); // venue → boolean
    const uncached = [];
    for (const venue of uniqueVenues) {
      const row = await getVenueCityCache(venue, cityNorm);
      if (row) {
        venueInCity.set(venue, row.inTargetCity === 1);
      } else {
        uncached.push(venue);
      }
    }

    // Heurística rápida: si el nombre del venue contiene cityNorm, marcarlo como inTargetCity sin Claude
    const stillUncached = [];
    for (const venue of uncached) {
      const venueL = venue.toLowerCase();
      if (venueL.includes(cityNorm)) {
        venueInCity.set(venue, true);
        await setVenueCityCache(venue, cityNorm, location.city, true);
      } else {
        stillUncached.push(venue);
      }
    }
    if (stillUncached.length < uncached.length) {
    }

    // Para los que quedan, resolver con Claude AI (batches de 50 en paralelo)
    if (stillUncached.length > 0) {
      const BATCH_SIZE = 50;
      const batches = [];
      for (let i = 0; i < stillUncached.length; i += BATCH_SIZE) {
        batches.push(stillUncached.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(batches.map(async (batch) => {
        try {
          const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4000,
              messages: [{
                role: "user",
                content: `Tengo una lista de elementos. Cada elemento puede ser un ESTADIO deportivo o un EQUIPO deportivo. Para cada uno, necesito saber si su ubicación cae dentro de la zona metropolitana de "${location.city}", ${location.country}:\n- Si es un ESTADIO: dime en qué ciudad está físicamente ubicado.\n- Si es un EQUIPO: dime en qué ciudad juega de local (su sede principal).\n\nReglas estrictas:\n- Responde inTargetCity: true SOLO si la ciudad (del estadio, o de la sede del equipo) está geográficamente dentro de la zona metropolitana de "${location.city}".\n- NO marques true solo porque el nombre contiene "${location.city}" — verifica la ubicación real.\n- Incluye ciudades conurbadas y municipios adyacentes que forman parte del área metropolitana.\n- Si no conoces la ubicación del estadio o la sede del equipo, responde inTargetCity: false.\n\nResponde SOLO con un JSON array, sin texto adicional:\n[{"venue": "nombre exacto del estadio o equipo", "city": "ciudad donde está físicamente el estadio o donde juega de local el equipo", "inTargetCity": true/false}]\n\nLista:\n${batch.map((v, i) => `${i + 1}. ${v}`).join("\n")}`
              }]
            })
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const text = aiData?.content?.[0]?.text || "";
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
          }
        } catch (aiErr) {
          console.error(`[nearby] Claude AI batch failed:`, aiErr.message);
        }
        return [];
      }));

      // Combinar resultados de todos los batches
      const allResults = batchResults.flat();
      for (const item of allResults) {
        if (item.venue && stillUncached.includes(item.venue)) {
          const inTarget = item.inTargetCity === true;
          console.log(`[nearby] DEBUG venue "${item.venue}" → city="${item.city || ''}", inTargetCity=${inTarget}`);
          venueInCity.set(item.venue, inTarget);
          await setVenueCityCache(item.venue, cityNorm, item.city || null, inTarget);
        }
      }
      console.log(`[nearby] Claude AI resolved ${allResults.length}/${stillUncached.length} venues for "${location.city}"`);

      // Venues que Claude no resolvió: cachear como false para no reintentar
      for (const venue of stillUncached) {
        if (!venueInCity.has(venue)) {
          venueInCity.set(venue, false);
          await setVenueCityCache(venue, cityNorm, null, false);
        }
      }
    }

    // 5. Filtrar eventos cuyo venue esté en la ciudad buscada
    const localVenues = new Set(
      [...venueInCity.entries()]
        .filter(([, inCity]) => inCity)
        .map(([venue]) => venue)
    );
    console.log(`[nearby] ${localVenues.size} venues in "${location.city}":`, [...localVenues]);

    // Un evento se queda si su estadio (strVenue) está marcado como local,
    // o si no tiene estadio pero su equipo local (strHomeTeam) está marcado como local.
    const filteredEvents = eventsInWindow.filter(e => {
      if (e.strVenue) return localVenues.has(e.strVenue);
      return e.strHomeTeam && localVenues.has(e.strHomeTeam);
    });

    if (filteredEvents.length === 0) {
      return res.json({ ok: true, location, matches: [], message: `No encontramos partidos confirmados en ${location.city || cityNorm}` });
    }

    // 6. Deduplicar por idEvent, filtrar próximos 30 días, ordenar por fecha
    const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const fromDate = nowMx.toISOString().split('T')[0];
    const toDate = new Date(nowMx.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const uniqueEvents = [...new Map(filteredEvents
      .filter(e => {
        const d = e.dateEvent;
        return d && d >= fromDate && d <= toDate;
      })
      .map(e => [e.idEvent, e])).values()]
      .sort((a, b) => (a.dateEvent + (a.strTime || "")).localeCompare(b.dateEvent + (b.strTime || "")));

    console.log(`[nearby] Found ${uniqueEvents.length} upcoming events in ${cityNorm}`);

    // 7. Mapear al formato del proyecto
    const normalizeSportName = (raw) => {
      if (!raw) return "unknown";
      const n = raw.trim().toLowerCase();
      if (n === "soccer") return "football";
      return n;
    };

    const matches = uniqueEvents.map(e => {
      const eventDate = e.dateEvent || null;
      const eventTime = e.strTime || "00:00:00";
      const scheduledStartUtc = eventDate ? `${eventDate}T${eventTime}Z` : null;
      return {
        internalMatchId: `the_sports_db_${e.idEvent}`,
        provider: "the_sports_db",
        providerMatchId: e.idEvent,
        sport: normalizeSportName(e.strSport),
        competitionKey: e.idLeague || "unknown",
        competitionName: e.strLeague || "Unknown",
        eventName: e.strEvent || null,
        homeParticipantName: e.strHomeTeam || null,
        awayParticipantName: e.strAwayTeam || null,
        scheduledStartUtc,
        currentStartUtc: scheduledStartUtc,
        status: (e.strStatus || "Not Started").toLowerCase() === "not started" ? "scheduled" : (e.strStatus || "unknown"),
        rawStatus: e.strStatus || null,
        venueName: e.strVenue || null,
        city: e.strCity || location.city,
        country: e.strCountry || location.country,
        lastProviderUpdateUtc: new Date().toISOString(),
      };
    });

    res.json({ ok: true, location, matches });
  } catch (error) {
    console.error("[nearby] Error:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Suscripciones ──
app.get("/api/admin/stats", async (req, res) => {
  try {
    const adminUser = req.headers['x-admin-user'];
    if (adminUser !== 'lopezesmenjaud@gmail.com') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    // Total usuarios
    const totalUsers = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM google_accounts", [], (err, row) => {
        if (err) reject(err); else resolve(row?.count || 0);
      });
    });

    // Usuarios nuevos esta semana
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newUsersThisWeek = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM google_accounts WHERE createdAtUtc >= ?", [weekAgo], (err, row) => {
        if (err) reject(err); else resolve(row?.count || 0);
      });
    });

    // Partidos sincronizados a calendarios
    const syncedEvents = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM calendar_events", [], (err, row) => {
        if (err) reject(err); else resolve(row?.count || 0);
      });
    });

    // Top 10 ligas por suscriptores
    const topLeagues = await new Promise((resolve, reject) => {
      db.all(
        `SELECT competitionName, competitionKey, sport, COUNT(DISTINCT userId) as subscribers
         FROM subscriptions
         WHERE competitionKey IS NOT NULL AND competitionName IS NOT NULL
         GROUP BY competitionKey
         ORDER BY subscribers DESC
         LIMIT 10`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    // Distribución por deporte
    const sportDistribution = await new Promise((resolve, reject) => {
      db.all(
        `SELECT sport, COUNT(DISTINCT userId) as users
         FROM subscriptions
         GROUP BY sport
         ORDER BY users DESC`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    // Usuarios con detalle
    const users = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
           g.userId as email,
           g.createdAtUtc,
           (SELECT COUNT(*) FROM subscriptions s WHERE s.userId = g.userId) as leagueCount,
           ec.emailFanschedule,
           ec.emailPartners
         FROM google_accounts g
         LEFT JOIN email_consent ec ON ec.userId = g.userId
         ORDER BY g.createdAtUtc DESC`,
        [], (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    res.json({
      ok: true,
      totalUsers,
      newUsersThisWeek,
      syncedEvents,
      topLeagues,
      sportDistribution,
      users
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/cleanup-calendar", async (req, res) => {
  try {
    const adminUser = req.headers['x-admin-user'];
    if (adminUser !== 'lopezesmenjaud@gmail.com') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const accounts = await googleAccountRepository.getAll();
    let totalDeleted = 0;
    const details = [];

    for (const account of accounts) {
      try {
        const calendar = await googleCalendarProvider.getCalendarClientForUser(account.userId);
        const fanscheduleCalendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId: account.userId });

        // Obtener eventos de FanSchedule y SportSync (branding anterior) en los próximos 60 días
        const now = new Date();
        const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
        const listParams = {
          calendarId: fanscheduleCalendarId,
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults: 500,
          singleEvents: true,
        };
        const [fanRes, sportRes] = await Promise.all([
          calendar.events.list({ ...listParams, q: 'FanSchedule' }),
          calendar.events.list({ ...listParams, q: 'SportSync' }),
        ]);

        // Combinar y deduplicar por event.id
        const seen = new Set();
        const events = [];
        for (const ev of [...(fanRes.data.items || []), ...(sportRes.data.items || [])]) {
          if (!seen.has(ev.id)) {
            seen.add(ev.id);
            events.push(ev);
          }
        }

        // 1) Agrupar por link fanschedule.com/match/{id}
        const byMatchId = new Map();
        const eventsWithoutLink = [];
        for (const ev of events) {
          const desc = ev.description || '';
          const match = desc.match(/fanschedule\.com\/match\/(\w+)/);
          if (match) {
            const matchId = match[1];
            if (!byMatchId.has(matchId)) byMatchId.set(matchId, []);
            byMatchId.get(matchId).push(ev);
          } else {
            eventsWithoutLink.push(ev);
          }
        }

        // 2) Agrupar eventos sin link por summary + fecha de inicio (YYYY-MM-DD)
        const bySummaryDate = new Map();
        for (const ev of eventsWithoutLink) {
          const summary = (ev.summary || '').trim();
          const startRaw = ev.start?.dateTime || ev.start?.date || '';
          const dateKey = startRaw.substring(0, 10); // YYYY-MM-DD
          if (!summary || !dateKey) continue;
          const groupKey = `${summary}|||${dateKey}`;
          if (!bySummaryDate.has(groupKey)) bySummaryDate.set(groupKey, []);
          bySummaryDate.get(groupKey).push(ev);
        }

        // Borrar duplicados de ambos grupos: mantener el más reciente, borrar el resto
        let userDeleted = 0;
        const allGroups = [...byMatchId.values(), ...bySummaryDate.values()];
        for (const dupes of allGroups) {
          if (dupes.length <= 1) continue;
          dupes.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
          for (let i = 1; i < dupes.length; i++) {
            try {
              await calendar.events.delete({ calendarId: fanscheduleCalendarId, eventId: dupes[i].id });
              userDeleted++;
            } catch (e) {
              // skip if already deleted
            }
          }
        }

        totalDeleted += userDeleted;
        if (userDeleted > 0) {
          details.push({ userId: account.userId, deleted: userDeleted, totalEvents: events.length });
        }
      } catch (e) {
        details.push({ userId: account.userId, error: e.message });
      }
    }

    res.json({ ok: true, totalDeleted, users: accounts.length, details });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── Re-sincronización per-usuario (solo localhost — pensado para el shell de Render) ──
// Corre en el mismo proceso que el server, así reutiliza el mutex en memoria de
// calendarSyncService y previene duplicados aunque el scheduler dispare en paralelo.
app.post("/api/admin/resync-user", async (req, res) => {
  const remote = req.socket.remoteAddress || "";
  const isLocal =
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1";
  if (!isLocal) {
    return res.status(403).json({ ok: false, error: "Forbidden (localhost-only)" });
  }

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ ok: false, error: "email is required in body" });
  }

  try {
    const allAccounts = await googleAccountRepository.getAll();
    const target = allAccounts.find(
      a => (a.googleEmail || "").toLowerCase() === email.toLowerCase()
    );
    if (!target) {
      return res.status(404).json({ ok: false, error: `No account found for email: ${email}` });
    }

    console.log(`[admin/resync-user] start  userId=${target.userId}  email=${target.googleEmail}`);
    console.log(`[admin/resync-user] fanschedule_calendar_id (antes)=${target.fanschedule_calendar_id || "(null)"}`);

    const subscriptions = await subscriptionRepository.getByUserId(target.userId);
    console.log(`[admin/resync-user] subscriptions=${subscriptions.length}`);
    if (subscriptions.length === 0) {
      return res.json({
        ok: true,
        message: "Usuario sin suscripciones — nada que sincronizar.",
        userId: target.userId,
        email: target.googleEmail,
        subscriptions: 0,
        relevantMatches: 0,
        created: 0,
        updated: 0,
        errors: 0,
        totalCalendarEventRows: 0,
        duplicates: [],
      });
    }

    const { getMatchesForUser } = require("./src/services/subscriptionMatchService");
    const relevantMatches = await getMatchesForUser(target.userId);
    console.log(`[admin/resync-user] relevantMatches=${relevantMatches.length}`);

    let created = 0;
    let updated = 0;
    let errors = 0;
    for (let i = 0; i < relevantMatches.length; i++) {
      const m = relevantMatches[i];
      try {
        const results = await syncMatchToCalendars(m);
        const userResults = results.filter(r => r.userId === target.userId);
        created += userResults.filter(r => r.action === "created").length;
        updated += userResults.filter(r => r.action === "updated").length;
      } catch (e) {
        errors++;
        console.error(`[admin/resync-user] error for ${m.providerMatchId}: ${e.message}`);
      }
      if ((i + 1) % 10 === 0 || i + 1 === relevantMatches.length) {
        console.log(`[admin/resync-user] progress ${i + 1}/${relevantMatches.length}  created=${created} updated=${updated} errors=${errors}`);
      }
    }

    const refreshed = await googleAccountRepository.getByUserId(target.userId);
    const finalLinks = await calendarEventRepository.getByUserId(target.userId);
    const byMatchId = new Map();
    for (const ce of finalLinks) {
      byMatchId.set(ce.providerMatchId, (byMatchId.get(ce.providerMatchId) || 0) + 1);
    }
    const duplicates = [...byMatchId.entries()]
      .filter(([, count]) => count > 1)
      .map(([providerMatchId, count]) => ({ providerMatchId, count }));

    console.log(`[admin/resync-user] done.  created=${created} updated=${updated} errors=${errors} totalRows=${finalLinks.length} duplicates=${duplicates.length}`);

    res.json({
      ok: true,
      userId: target.userId,
      email: target.googleEmail,
      fanscheduleCalendarIdBefore: target.fanschedule_calendar_id || null,
      fanscheduleCalendarIdAfter: refreshed?.fanschedule_calendar_id || null,
      subscriptions: subscriptions.length,
      relevantMatches: relevantMatches.length,
      created,
      updated,
      errors,
      totalCalendarEventRows: finalLinks.length,
      duplicates,
    });
  } catch (error) {
    console.error("[admin/resync-user] FATAL:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/consent", async (req, res) => {
  try {
    const { userId, emailFanschedule, emailPartners } = req.body;
    if (!userId) return res.status(400).json({ ok: false, error: "userId is required" });
    const now = new Date().toISOString();
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO email_consent (userId, emailFanschedule, emailPartners, consentDate, updatedAt) VALUES (?, ?, ?, COALESCE((SELECT consentDate FROM email_consent WHERE userId = ?), ?), ?)`,
        [userId, emailFanschedule ? 1 : 0, emailPartners ? 1 : 0, userId, now, now],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/subscriptions", async (req, res) => {
  try {
    const { userId, sport, competitionKey, competitionName, teamName } = req.body;
    if (!userId || !sport) return res.status(400).json({ error: "userId and sport are required" });
    const existing  = await subscriptionRepository.getByUserId(userId);
    const duplicate = existing.find(s =>
      s.sport === sport &&
      s.competitionKey === (competitionKey || null) &&
      s.teamName === (teamName || null)
    );
    if (duplicate) return res.json({ ok: true, subscription: duplicate, duplicate: true });
    const subscription = await subscriptionRepository.create({
      userId, sport,
      competitionKey: competitionKey || null,
      competitionName: competitionName || null,
      teamName: teamName || null
    });
    res.json({ ok: true, subscription });

    // Sync inmediato en background (no bloquea la respuesta)
    setImmediate(async () => {
      try {
        if (competitionKey && !competitionKey.startsWith("national_")) {
          const results = await syncLeague(competitionKey, sport);
          console.log(`[sub] Immediate sync for league ${competitionKey}: ${results.length} changes`);
          for (const r of results) {
            try { await syncMatchToCalendars(r.newMatch); } catch (e) { /* skip */ }
          }
        } else if (teamName && !competitionKey) {
          const results = await syncTeam(teamName, sport);
          console.log(`[sub] Immediate sync for team "${teamName}": ${results.length} changes`);
          for (const r of results) {
            try { await syncMatchToCalendars(r.newMatch); } catch (e) { /* skip */ }
          }
        }
      } catch (err) {
        console.error("[sub] Immediate sync error:", err.message);
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/subscriptions/:userId", async (req, res) => {
  try {
    const subscriptions = await subscriptionRepository.getByUserId(req.params.userId);
    res.json({ ok: true, subscriptions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/subscriptions/:id", async (req, res) => {
  try {
    const subId   = parseInt(req.params.id, 10);
    const deleted = await subscriptionRepository.deleteById(subId);
    if (!deleted) return res.status(404).json({ ok: false, error: "Subscription not found" });

    console.log(`[sub] Deleted subscription ${subId}: ${deleted.sport} / ${deleted.teamName || deleted.competitionKey}`);
    res.json({ ok: true, deleted });

    // Cleanup en background: partidos huérfanos + eventos de Google Calendar
    setImmediate(async () => {
      try {
        const remaining = await subscriptionRepository.getAll();
        const allMatches = await matchRepository.getAll();

        // Encontrar partidos que ya no cubre ninguna suscripción
        const { matchAppliesToSubscription } = require("./src/services/subscriptionMatchService");
        const orphanMatches = allMatches.filter(match =>
          !remaining.some(sub => matchAppliesToSubscription(match, sub))
        );

        if (orphanMatches.length === 0) {
          console.log(`[sub] No orphan matches to clean`);
          return;
        }

        console.log(`[sub] Found ${orphanMatches.length} orphan matches, cleaning...`);
        const orphanIds = orphanMatches.map(m => m.providerMatchId);

        // Eliminar eventos de Google Calendar para el usuario
        const calEvents = await calendarEventRepository.getByUserIdAndMatchIds(deleted.userId, orphanIds);
        const calendarIdByUser = new Map();
        for (const ce of calEvents) {
          try {
            let calendarId = calendarIdByUser.get(ce.userId);
            if (!calendarId) {
              calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId: ce.userId });
              calendarIdByUser.set(ce.userId, calendarId);
            }
            await googleCalendarProvider.deleteEvent({ userId: ce.userId, calendarId, calendarEventId: ce.calendarEventId });
            await calendarEventRepository.deleteById(ce.id);
            console.log(`[sub] Deleted calendar event ${ce.calendarEventId} for match ${ce.providerMatchId}`);
          } catch (err) {
            console.error(`[sub] Failed to delete calendar event ${ce.calendarEventId}:`, err.message);
            // Borrar el registro de la DB aunque falle en Google
            await calendarEventRepository.deleteById(ce.id);
          }
        }

        // Eliminar partidos huérfanos de la DB
        for (const match of orphanMatches) {
          await matchRepository.deleteByProviderMatchId(match.providerMatchId);
        }
        console.log(`[sub] Cleaned ${orphanMatches.length} orphan matches and ${calEvents.length} calendar events`);
      } catch (err) {
        console.error("[sub] Cleanup error:", err.message);
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/subscriptions/sync", async (req, res) => {
  try {
    // Paso 1: descargar partidos nuevos/actualizados de TheSportsDB
    const results = await syncMatches();
    const calendarResults = [];
    for (const result of results) {
      const calendarResult = await syncMatchToCalendars(result.newMatch);
      calendarResults.push(...calendarResult);
    }

    // Paso 2: re-sincronizar partidos existentes que no estén en calendar_events
    const allMatches = await matchRepository.getAll();
    const allCalendarEvents = await calendarEventRepository.getAll();
    const syncedMatchIds = new Set(allCalendarEvents.map(ce => ce.providerMatchId));

    let backfillCount = 0;
    for (const match of allMatches) {
      if (!syncedMatchIds.has(match.providerMatchId)) {
        try {
          const backfillResults = await syncMatchToCalendars(match);
          calendarResults.push(...backfillResults);
          backfillCount += backfillResults.length;
        } catch (e) {
          console.error(`[sync] Backfill error for ${match.providerMatchId}:`, e.message);
        }
      }
    }
    if (backfillCount > 0) console.log(`[sync] Backfilled ${backfillCount} calendar events`);

    res.json({ ok: true, synced: calendarResults.length, results: calendarResults });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/matches/:userId", async (req, res) => {
  try {
    const { userId }      = req.params;
    const subscriptions   = await subscriptionRepository.getByUserId(userId);
    const allMatches      = await matchRepository.getAll();
    // Filtrar por suscripciones
    const relevantMatches = allMatches.filter(match =>
      subscriptions.some(sub => {
        if (normalizeSport(sub.sport) !== normalizeSport(match.sport)) return false;
        if (sub.teamName) {
          return match.homeParticipantName === sub.teamName ||
                 match.awayParticipantName === sub.teamName;
        }
        if (sub.competitionKey) return match.competitionKey === sub.competitionKey;
        return true;
      })
    );

    // Filtrar solo partidos desde "hoy" en la timezone del usuario
    const tz = req.query.timezone || 'America/Mexico_City';
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const nowIso = now.toISOString();
    const upcomingMatches = relevantMatches.filter(m => {
      const d = m.currentStartUtc || m.scheduledStartUtc;
      return d && d >= nowIso;
    });

    res.json({ ok: true, matches: upcomingMatches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Resumen IA con caché ──
app.post("/summary/:matchId", async (req, res) => {
  try {
    const match = await matchRepository.getByProviderMatchId(req.params.matchId);
    if (!match) return res.status(404).json({ error: "Match not found" });
    const result = await getSmartSummary(match);
    if (result.source === "too_far" || result.source === "tbd") {
      return res.json({ ok: false, reason: result.source, message: result.reason });
    }
    res.json({ ok: true, summary: result.summary, source: result.source });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SportSync server running on http://0.0.0.0:${PORT}`);
  console.log(`[sportsdb] Using ${SPORTSDB_KEY === "123" ? "FREE key (123)" : "PREMIUM key ✓"}`);
});
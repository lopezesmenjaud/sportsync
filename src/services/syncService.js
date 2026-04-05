const { getProvider } = require("../providers");
const { detectMatchChanges } = require("./matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");

// Mapeo de nombres del frontend (español) a nombres internos de TheSportsDB
const SPORT_NAME_MAP = {
  futbol:           "football",
  basketball:       "basketball",
  futbol_americano: "american football",
  automovilismo:    "motorsport",
  baseball:         "baseball",
  tenis:            "tennis",
  combate:          "fighting",
  rugby:            "rugby",
  hockey:           "ice hockey",
  voleibol:         "volleyball",
  // Nombres en inglés (por si ya hay datos guardados así)
  football:         "football",
  "american football": "american football",
  motorsport:       "motorsport",
  tennis:           "tennis",
  fighting:         "fighting",
  "ice hockey":     "ice hockey",
  volleyball:       "volleyball",
};

function normalizeSport(sport) {
  return SPORT_NAME_MAP[sport] || sport;
}

// ── Cálculo dinámico de temporada según deporte y fecha actual ──
//
// Deportes con temporada split (Aug/Sep → May/Jun): football, basketball, ice hockey, rugby, volleyball
//   → Si estamos en Aug+ : "{year}-{year+1}"
//   → Si estamos en Jan-Jul: "{year-1}-{year}"
//
// Deportes con temporada calendario (Jan → Dec): motorsport, baseball, tennis, fighting
//   → "{year}"
//
// NFL es especial (Sep → Feb, temporada = año de inicio):
//   → Si estamos en Sep+: "{year}"
//   → Si estamos en Jan-Aug: "{year-1}"

const SPLIT_SEASON_SPORTS  = new Set(["football", "basketball", "ice hockey", "volleyball"]);
const SINGLE_YEAR_SPORTS   = new Set(["motorsport", "baseball", "tennis", "fighting", "rugby"]);

function getCurrentSeason(normalizedSport) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  if (normalizedSport === "american football") {
    return month >= 8 ? `${year}` : `${year - 1}`;
  }

  if (SINGLE_YEAR_SPORTS.has(normalizedSport)) {
    return `${year}`;
  }

  // Split season (football, basketball, ice hockey, volleyball)
  if (month >= 8) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

// Genera variantes de temporada para probar si la principal no da resultados
function getSeasonVariants(normalizedSport) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const primary = getCurrentSeason(normalizedSport);
  const variants = [primary];

  // Agregar variantes alternas
  if (primary.includes("-")) {
    // Si es split, también probar año simple
    variants.push(`${year}`);
    variants.push(`${year - 1}`);
  } else {
    // Si es año simple, también probar split
    if (month >= 8) {
      variants.push(`${year}-${year + 1}`);
    } else {
      variants.push(`${year - 1}-${year}`);
    }
    variants.push(`${year - 1}`);
  }

  return variants;
}

// Rango de sincronización: desde hoy hasta 30 días adelante
function getSyncDateRange() {
  const from = new Date();
  const to   = new Date();
  to.setDate(to.getDate() + 30);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
  };
}

// Sincroniza los partidos de una liga específica
async function syncLeague(leagueId, sport) {
  const provider        = getProvider("the_sports_db");
  const normalizedSport = normalizeSport(sport);
  const { fromDate, toDate } = getSyncDateRange();

  let rawMatches = [];

  // ── Estrategia 1: eventsseason.php con múltiples variantes de temporada ──
  const seasons = getSeasonVariants(normalizedSport);
  for (const season of seasons) {
    try {
      rawMatches = await provider.getEventsByLeagueAndSeason({ leagueId, season, fromDate, toDate });
      if (rawMatches.length > 0) {
        console.log(`[sync] League ${leagueId} (${normalizedSport}): ${rawMatches.length} events with season "${season}"`);
        break;
      }
    } catch (error) {
      // Silently try next variant
    }
  }

  // ── Estrategia 2: fallback a eventsnextleague.php ──
  if (rawMatches.length === 0) {
    try {
      const nextEvents = await provider.getNextLeagueEvents(leagueId);
      if (nextEvents.length > 0) {
        // Filtrar por rango de 30 días
        rawMatches = nextEvents.filter(e => {
          const d = e.dateEvent;
          if (!d) return false;
          return d >= fromDate && d <= toDate;
        });
        console.log(`[sync] League ${leagueId} (${normalizedSport}): ${rawMatches.length} events via eventsnextleague fallback`);
      }
    } catch (error) {
      // Last resort failed
    }
  }

  if (rawMatches.length === 0) {
    console.log(`[sync] No matches found for league ${leagueId} (${normalizedSport}) in range ${fromDate} → ${toDate}`);
    return [];
  }

  const normalizedMatches = rawMatches.map(m => provider.normalizeMatch(m));
  const results = [];

  for (const match of normalizedMatches) {
    const oldMatch = await matchRepository.getByProviderMatchId(match.providerMatchId);
    const changes  = detectMatchChanges(oldMatch, match);
    await matchRepository.save(match);

    if (changes.length > 0) {
      results.push({
        matchId:             match.providerMatchId,
        homeParticipantName: match.homeParticipantName,
        awayParticipantName: match.awayParticipantName,
        changes,
        newMatch: match
      });
    }
  }

  console.log(`[sync] League ${leagueId}: ${normalizedMatches.length} matches processed, ${results.length} changes`);
  return results;
}

// Sincroniza los partidos de un equipo específico por nombre
async function syncTeam(teamName, sport) {
  const provider        = getProvider("the_sports_db");
  const { fromDate, toDate } = getSyncDateRange();

  try {
    // Paso 1: buscar el teamId por nombre
    const team = await provider.searchTeam(teamName);
    if (!team) {
      console.log(`[sync] Team "${teamName}" not found in TheSportsDB`);
      return [];
    }

    const teamId = team.idTeam;
    console.log(`[sync] Found team "${teamName}" → id ${teamId}`);

    // Paso 2: obtener próximos eventos del equipo
    let rawMatches = await provider.getNextTeamEvents(teamId);

    // Filtrar por rango de 30 días
    rawMatches = rawMatches.filter(e => {
      const d = e.dateEvent;
      if (!d) return false;
      return d >= fromDate && d <= toDate;
    });

    if (rawMatches.length === 0) {
      console.log(`[sync] No upcoming matches for "${teamName}" in range ${fromDate} → ${toDate}`);
      return [];
    }

    console.log(`[sync] Team "${teamName}": ${rawMatches.length} upcoming events`);

    const normalizedMatches = rawMatches.map(m => provider.normalizeMatch(m));
    const results = [];

    for (const match of normalizedMatches) {
      const oldMatch = await matchRepository.getByProviderMatchId(match.providerMatchId);
      const changes  = detectMatchChanges(oldMatch, match);
      await matchRepository.save(match);

      if (changes.length > 0) {
        results.push({
          matchId:             match.providerMatchId,
          homeParticipantName: match.homeParticipantName,
          awayParticipantName: match.awayParticipantName,
          changes,
          newMatch: match
        });
      }
    }

    console.log(`[sync] Team "${teamName}": ${normalizedMatches.length} matches processed, ${results.length} changes`);
    return results;
  } catch (error) {
    console.error(`[sync] Error syncing team "${teamName}":`, error.message);
    return [];
  }
}

// Sincroniza todas las ligas y equipos que tienen al menos una suscripción activa
async function syncMatches() {
  console.log("[sync] Starting full sync...");

  const allSubscriptions = await subscriptionRepository.getAll();
  const leagueMap        = new Map(); // leagueId → sport
  const teamSubs         = [];        // suscripciones por equipo

  for (const sub of allSubscriptions) {
    if (sub.competitionKey && !sub.competitionKey.startsWith("national_")) {
      leagueMap.set(sub.competitionKey, normalizeSport(sub.sport));
    } else if (sub.teamName && !sub.competitionKey) {
      teamSubs.push(sub);
    }
  }

  if (leagueMap.size === 0 && teamSubs.length === 0) {
    console.log("[sync] No subscriptions found, using La Liga as fallback");
    leagueMap.set("4335", "football");
  }

  const allResults = [];

  // Sync por liga
  if (leagueMap.size > 0) {
    console.log(`[sync] Syncing ${leagueMap.size} leagues...`);
    for (const [leagueId, sport] of leagueMap) {
      const results = await syncLeague(leagueId, sport);
      allResults.push(...results);
    }
  }

  // Sync por equipo
  if (teamSubs.length > 0) {
    const uniqueTeams = [...new Map(teamSubs.map(s => [s.teamName, s])).values()];
    console.log(`[sync] Syncing ${uniqueTeams.length} teams...`);
    for (const sub of uniqueTeams) {
      const results = await syncTeam(sub.teamName, sub.sport);
      allResults.push(...results);
    }
  }

  console.log(`[sync] Full sync complete. Total changes: ${allResults.length}`);
  return allResults;
}

// Sincroniza solo las ligas de un deporte específico
async function syncSport(sport) {
  console.log(`[sync] Syncing sport: ${sport}`);

  const normalizedTarget = normalizeSport(sport);
  const allSubscriptions = await subscriptionRepository.getAll();
  const leagueIds        = [...new Set(
    allSubscriptions
      .filter(s => normalizeSport(s.sport) === normalizedTarget && s.competitionKey && !s.competitionKey.startsWith("national_"))
      .map(s => s.competitionKey)
  )];

  // Equipos del mismo deporte
  const teamNames = [...new Set(
    allSubscriptions
      .filter(s => normalizeSport(s.sport) === normalizedTarget && s.teamName && !s.competitionKey)
      .map(s => s.teamName)
  )];

  if (leagueIds.length === 0 && teamNames.length === 0) {
    console.log(`[sync] No subscriptions for sport: ${sport}`);
    return [];
  }

  const allResults = [];
  for (const leagueId of leagueIds) {
    const results = await syncLeague(leagueId, sport);
    allResults.push(...results);
  }
  for (const teamName of teamNames) {
    const results = await syncTeam(teamName, sport);
    allResults.push(...results);
  }

  return allResults;
}

module.exports = { syncMatches, syncSport, syncLeague, syncTeam, normalizeSport };

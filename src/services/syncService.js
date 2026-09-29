const { getProvider } = require("../providers");
const { detectMatchChanges } = require("./matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { syncTennis } = require("./tennisSyncService");
const { leagueSeasonsCacheRepository } = require("../repositories/leagueSeasonsCacheRepositorySqlite");
const { buscarPorTemporadas } = require("./reglaTemporadas");
// Una suscripción por confederación ("concacaf-varonil") NO es una liga del proveedor: se
// sincronizan sus competencias (5516, 5280, 4873, 5522...). Ver src/data/selecciones.json.
const { esSuscripcionDeSelecciones, competenciasDeSuscripcion } = require("./seleccionesConfederaciones");

// Vigencia de la lista de temporadas guardada. 6 h y no 24: el proveedor a veces crea una
// temporada nueva a media competencia (las finales de la Nations League de 2019 y 2021 quedaron
// como temporada aparte). Ojo con el costo: el cron de fútbol corre cada 12 h, así que en esas
// corridas la lista siempre está vencida y se vuelve a pedir (+1 llamada por liga). La caché
// solo se aprovecha entre corridas con menos de 6 h de distancia (arranque, sync inmediato).
const VIGENCIA_TEMPORADAS_MS = 6 * 60 * 60 * 1000;

// Contador de llamadas a TheSportsDB de UNA corrida. Se pasa como argumento (y no como variable
// del módulo) porque a medianoche corren varios crons a la vez y se mezclarían las cuentas.
//
// errores = llamadas que fallaron (red, proveedor caído). syncLeague las atrapa y sigue, así que
// sin este número "no pude preguntar" se ve igual que "pregunté y no hay nada". Lo usa el POST de
// confederación para no decir "no hay partidos" cuando en realidad no se pudo consultar.
function nuevoContador() {
  return { llamadas: 0, listasPedidas: 0, listasDeCache: 0, listasFallidas: 0, errores: 0 };
}

// "N llamadas a TheSportsDB, M fallaron (...)". M es el total de la corrida (ligas Y equipos): si
// el proveedor empieza a cortarnos (429, caída), se ve aquí de un vistazo sin buscar en el log.
// OJO: "listas ... fallidas" es otra cosa: incluye las listas que vinieron VACÍAS, que no son error.
function resumenContador(c) {
  return `${c.llamadas} llamadas a TheSportsDB, ${c.errores} fallaron ` +
    `(listas de temporadas: ${c.listasPedidas} pedidas, ${c.listasDeCache} de caché, ${c.listasFallidas} sin lista)`;
}

// Hace UNA llamada al proveedor y la cuenta; si falla, la cuenta también como error y deja pasar
// el error, para que quien llama lo maneje igual que siempre.
async function llamarContando(contador, fn) {
  contador.llamadas += 1;
  try {
    return await fn();
  } catch (error) {
    contador.errores += 1;
    throw error;
  }
}

// La lista de temporadas de una liga: de la caché si tiene menos de 6 h; si no, del proveedor.
// Devuelve { lista, origen } donde origen es "caché", "proveedor" o "falló: <motivo>".
// lista null = no hay lista y syncLeague adivina como antes. Un error de la tabla de caché NO
// detiene nada: se trata como caché vacía (al leer) o se registra y se sigue (al guardar).
async function obtenerListaDeTemporadas(provider, leagueId, contador) {
  try {
    const guardada = await leagueSeasonsCacheRepository.get(leagueId);
    if (guardada && Date.now() - Date.parse(guardada.cachedAt) < VIGENCIA_TEMPORADAS_MS) {
      contador.listasDeCache += 1;
      return { lista: guardada.seasons, origen: "caché" };
    }
  } catch (error) {
    console.log(`[sync] League ${leagueId}: no se pudo leer league_seasons_cache (${error.message})`);
  }

  contador.llamadas += 1;
  let lista;
  try {
    lista = await provider.getSeasons(leagueId);
  } catch (error) {
    contador.listasFallidas += 1;
    contador.errores += 1;
    return { lista: null, origen: `falló: ${error.message}` };
  }
  if (lista.length === 0) {
    contador.listasFallidas += 1;
    return { lista: null, origen: "falló: vino vacía" };
  }

  contador.listasPedidas += 1;
  try {
    await leagueSeasonsCacheRepository.set(leagueId, lista);
  } catch (error) {
    console.log(`[sync] League ${leagueId}: no se pudo guardar en league_seasons_cache (${error.message})`);
  }
  return { lista, origen: "proveedor" };
}

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
  golf:             "golf",
  ciclismo:         "cycling",
  // Nombres en inglés (por si ya hay datos guardados así)
  football:         "football",
  "american football": "american football",
  motorsport:       "motorsport",
  tennis:           "tennis",
  fighting:         "fighting",
  "ice hockey":     "ice hockey",
  volleyball:       "volleyball",
  golf:             "golf",
  cycling:          "cycling",
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
const SINGLE_YEAR_SPORTS   = new Set(["motorsport", "baseball", "tennis", "fighting", "rugby", "golf", "cycling"]);

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

  // Agregar variantes alternas — cubrir temporada anterior y año simple
  if (primary.includes("-")) {
    // Split season: también probar temporada anterior y años simples
    const [startYear] = primary.split("-").map(Number);
    variants.push(`${startYear - 1}-${startYear}`); // temporada anterior (ej: 2024-2025)
    variants.push(`${year}`);
    variants.push(`${year - 1}`);
  } else {
    // Año simple: también probar split seasons
    if (month >= 8) {
      variants.push(`${year}-${year + 1}`);
    } else {
      variants.push(`${year - 1}-${year}`);
    }
    variants.push(`${year - 2}-${year - 1}`); // temporada anterior split
    variants.push(`${year - 1}`);
  }

  // Deduplicar manteniendo orden
  return [...new Set(variants)];
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

// Sincroniza los partidos de una liga específica.
//
// contador es OPCIONAL (lo pasan syncMatches y syncSport para el total de la corrida); el sync
// inmediato de server.js no lo pasa y funciona igual.
async function syncLeague(leagueId, sport, contador = nuevoContador()) {
  const provider        = getProvider("the_sports_db");
  const normalizedSport = normalizeSport(sport);
  const { fromDate, toDate } = getSyncDateRange();
  const llamadasAntes   = contador.llamadas;

  // ── Estrategia PRIMARIA: eventsseason.php, con las temporadas que decide reglaTemporadas ──
  // Devuelve la temporada completa y se recorta a la ventana hoy→+30d dentro del
  // provider. Evita el tope por cantidad (~15-20 eventos) de eventsnextleague, que
  // dejaba cortas a las ligas densas (p.ej. MLB cubría solo ~2 días).
  //
  // La lista de temporadas del proveedor evita pedir las que no existen y deja encontrar las
  // que no se adivinan ("2027"). Sin lista (falló o vino vacía) se adivina EXACTAMENTE como antes.
  const { lista, origen } = await obtenerListaDeTemporadas(provider, leagueId, contador);
  const busqueda = await buscarPorTemporadas({
    variantes:  getSeasonVariants(normalizedSport),
    lista,
    anioActual: Number(new Date().toISOString().slice(0, 4)),
    pedirTemporada: (season) => provider.getEventsByLeagueAndSeason({ leagueId, season, fromDate, toDate }),
    log: (msg) => console.log(`[sync] League ${leagueId} ${msg}`),
  });
  contador.llamadas += busqueda.llamadas;
  contador.errores  += busqueda.errores;
  let rawMatches = busqueda.eventos;

  // ── Estrategia FALLBACK: eventsnextleague.php, siempre que las variantes no dieron nada ──
  // Con la regla nueva corre también cuando una temporada extra sí trajo partidos, y se SUMA:
  // así nunca trae menos que antes, cuando el respaldo era lo único que corría en ese caso.
  let delRespaldo = 0;
  if (busqueda.camino !== "variante") {
    contador.llamadas += 1;
    try {
      const nextEvents = (await provider.getNextLeagueEvents(leagueId)).filter(e => {
        const d = e.dateEvent;
        if (!d) return false;
        return d >= fromDate && d <= toDate;
      });
      const yaEstan = new Set(rawMatches.map(e => e.idEvent));
      const nuevos  = nextEvents.filter(e => !yaEstan.has(e.idEvent));
      delRespaldo   = nuevos.length;
      rawMatches    = rawMatches.concat(nuevos);
    } catch (error) {
      contador.errores += 1;
      console.log(`[sync] League ${leagueId} eventsnextleague failed: ${error.message}`);
    }
  }

  // Un renglón por liga: por dónde llegaron los partidos, de dónde salió la lista y cuánto costó.
  const detalle = `lista: ${lista ? `${origen}, ${lista.length} temporadas` : `${origen} → se adivina como antes`} | ` +
    `llamadas: ${contador.llamadas - llamadasAntes}`;
  if (busqueda.camino === "variante") {
    console.log(`[sync] League ${leagueId} (${normalizedSport}): ${rawMatches.length} events via eventsseason (season "${busqueda.temporada}") [variante] | ${detalle}`);
  } else if (busqueda.camino === "extra") {
    console.log(`[sync] League ${leagueId} (${normalizedSport}): ${rawMatches.length} events via eventsseason (season "${busqueda.temporada}") [temporada extra de la lista] + ${delRespaldo} via eventsnextleague (fallback) | ${detalle}`);
  } else if (rawMatches.length > 0) {
    console.log(`[sync] League ${leagueId} (${normalizedSport}): ${rawMatches.length} events via eventsnextleague (fallback) | ${detalle}`);
  }

  if (rawMatches.length === 0) {
    console.log(`[sync] No matches found for league ${leagueId} (${normalizedSport}) in range ${fromDate} → ${toDate} | ${detalle}`);
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
//
// LIMITACIÓN CONOCIDA: getNextTeamEvents() usa eventsnext.php que TheSportsDB
// capa a ~20 eventos por respuesta. Para deportes densos (MLB, NBA, NHL) esto
// cubre solo 1-3 días por equipo. Aceptable mientras los usuarios solo sigan
// equipos de fútbol/F1/golf (~10+ semanas de cobertura). Se resolverá nativamente
// al migrar a un provider enterprise (SportRadar, Stats Perform, etc.).
async function syncTeam(teamName, sport, contador = nuevoContador()) {
  const provider        = getProvider("the_sports_db");
  const { fromDate, toDate } = getSyncDateRange();

  try {
    // Paso 1: buscar el teamId por nombre
    const team = await llamarContando(contador, () => provider.searchTeam(teamName));
    if (!team) {
      console.log(`[sync] Team "${teamName}" not found in TheSportsDB`);
      return [];
    }

    const teamId = team.idTeam;
    console.log(`[sync] Found team "${teamName}" → id ${teamId}`);

    // Paso 2: obtener próximos eventos del equipo
    let rawMatches = await llamarContando(contador, () => provider.getNextTeamEvents(teamId));

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

  // El tenis NO pasa por leagueMap ni por teamSubs: su proveedor es otro y un solo barrido
  // trae el circuito entero, así que se corre UNA vez y no una por suscripción.
  //
  // Este bloque es tan necesario como el de syncSport, y por eso está en los dos lados: el
  // ÚNICO llamador de syncSport es el cron de scheduler.js, mientras que syncMatches lo
  // llaman el sync de arranque (scheduler.js:87), server.js, runProductionSync y runSync.
  // Cablear solo syncSport dejaría el tenis muerto por esos cuatro caminos — mandando las
  // suscripciones de jugador a syncTeam contra TheSportsDB, que no devuelve nada, en silencio.
  let haySuscripcionesDeTenis = false;

  for (const sub of allSubscriptions) {
    if (normalizeSport(sub.sport) === "tennis") {
      haySuscripcionesDeTenis = true;
      continue;
    }
    if (esSuscripcionDeSelecciones(sub)) {
      for (const clave of competenciasDeSuscripcion(sub.competitionKey)) leagueMap.set(clave, normalizeSport(sub.sport));
    } else if (sub.competitionKey && !sub.competitionKey.startsWith("national_")) {
      leagueMap.set(sub.competitionKey, normalizeSport(sub.sport));
    } else if (sub.teamName && !sub.competitionKey) {
      teamSubs.push(sub);
    }
  }

  // El respaldo a La Liga solo aplica si NO hay nada que sincronizar, tenis incluido: con
  // suscripciones de tenis vivas hay trabajo real y meter La Liga sería inventarlo.
  if (leagueMap.size === 0 && teamSubs.length === 0 && !haySuscripcionesDeTenis) {
    console.log("[sync] No subscriptions found, using La Liga as fallback");
    leagueMap.set("4335", "football");
  }

  const allResults = [];
  const contador   = nuevoContador();

  // Tenis (proveedor propio). Si TENNIS_SYNC_ENABLED está apagado devuelve [] sin gastar
  // ni una petición, así que esta llamada es inofensiva mientras el interruptor esté abajo.
  if (haySuscripcionesDeTenis) {
    allResults.push(...await syncTennis());
  }

  // Sync por liga
  if (leagueMap.size > 0) {
    console.log(`[sync] Syncing ${leagueMap.size} leagues...`);
    for (const [leagueId, sport] of leagueMap) {
      const results = await syncLeague(leagueId, sport, contador);
      allResults.push(...results);
    }
  }

  // Sync por equipo
  if (teamSubs.length > 0) {
    const uniqueTeams = [...new Map(teamSubs.map(s => [s.teamName, s])).values()];
    console.log(`[sync] Syncing ${uniqueTeams.length} teams...`);
    for (const sub of uniqueTeams) {
      const results = await syncTeam(sub.teamName, sub.sport, contador);
      allResults.push(...results);
    }
  }

  console.log(`[sync] Full sync complete. Total changes: ${allResults.length} | ${resumenContador(contador)}`);
  return allResults;
}

// Sincroniza solo las ligas de un deporte específico
async function syncSport(sport) {
  console.log(`[sync] Syncing sport: ${sport}`);

  const normalizedTarget = normalizeSport(sport);

  // El tenis tiene proveedor propio: un solo barrido trae el circuito entero, sin importar a
  // qué ligas o jugadores esté suscrita la gente. Se atiende aquí y no se cae al camino de
  // TheSportsDB, que para tenis devuelve cero (comprobado el 29 ago 2026).
  if (normalizedTarget === "tennis") {
    return await syncTennis();
  }

  const allSubscriptions = await subscriptionRepository.getAll();
  const leagueIds        = [...new Set(
    allSubscriptions
      .filter(s => normalizeSport(s.sport) === normalizedTarget && s.competitionKey && !s.competitionKey.startsWith("national_"))
      .flatMap(s => esSuscripcionDeSelecciones(s) ? competenciasDeSuscripcion(s.competitionKey) : [s.competitionKey])
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
  const contador   = nuevoContador();
  for (const leagueId of leagueIds) {
    const results = await syncLeague(leagueId, sport, contador);
    allResults.push(...results);
  }
  for (const teamName of teamNames) {
    const results = await syncTeam(teamName, sport, contador);
    allResults.push(...results);
  }

  console.log(`[sync] Sport ${sport} complete. Total changes: ${allResults.length} | ${resumenContador(contador)}`);
  return allResults;
}

module.exports = { syncMatches, syncSport, syncLeague, syncTeam, normalizeSport, getSyncDateRange, nuevoContador };

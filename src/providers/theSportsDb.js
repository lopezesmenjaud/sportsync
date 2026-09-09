const axios = require("axios");
const { createMatch } = require("../domain/matchModel");
const { INTERNAL_STATUS } = require("../domain/statusMap");
const { getEnv } = require("../config/env");

// ─────────────────────────────────────────────────────────────────────────────
// Emparejamientos de sorteo sin calendario todavía
//
// TheSportsDB publica los cruces en cuanto se hace el sorteo, ANTES de que exista el
// calendario, y les pone a todos la misma fecha de relleno. El 8 sep 2026 eso metió 126
// partidos de Champions al mismo instante (2026-09-08T19:00:00Z, intRound "0") y de ahí
// salieron 308 eventos escritos en calendarios de usuarios reales.
//
// Este filtro vive EN EL PROVEEDOR DE THESPORTSDB y no en syncService a propósito: en
// syncService convergen los dos proveedores, y el tenis —que entra por syncTennis() y guarda
// intRound 0 en 2,417 de sus 2,484 partidos— quedaría atrapado por la regla. Aquí eso es
// imposible por construcción: LiveTennisApiProvider no pasa por esta clase.
//
// Las tres condiciones tienen que cumplirse JUNTAS. Cada una existe por un caso medido:
//
//  1. Solo the_sports_db. Un filtro por ronda cero a secas apagaría el tenis entero,
//     incluido el US Open con sus 408 partidos.
//
//  2. Solo dentro de competencias que SÍ usan ronda. En TheSportsDB el cero tampoco
//     significa siempre lo mismo: Liga Mexicana de Béisbol (21 de 21), Club Friendlies
//     (7 de 7) y NBA (3 de 3) están todos en cero y son partidos reales — ahí el proveedor
//     simplemente no llena el campo. Si ningún partido de la competencia trae ronda, la
//     competencia pasa COMPLETA. La Champions sí es distinta: 66 con ronda de verdad y 126
//     en cero, y ahí el cero sí significa "sin jornada asignada".
//
//  3. Y además compartir la fecha exacta con UMBRAL_SORTEO o más. Existen jornadas
//     simultáneas REALES de diez u once partidos (la última fecha de La Liga, el domingo de
//     NFL al mediodía) y ésas no se tocan. El caso malo son 126. Esta condición también es
//     la que protege a los 5 partidos sueltos con ronda 0 dentro de competencias que sí usan
//     ronda (3 de Leagues Cup, 1 de MLB, 1 de box): tienen fechas distintas entre sí.
// ─────────────────────────────────────────────────────────────────────────────

// Tamaño del grupo, no "20 además de éste": un grupo de exactamente 20 ya se descarta.
const UMBRAL_SORTEO = 20;

// ¿Este partido trae una ronda de verdad? null, vacío y 0 son "sin ronda asignada".
function tieneRondaReal(intRound) {
  if (intRound === null || intRound === undefined) return false;
  const s = String(intRound).trim();
  if (s === "") return false;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0;
}

/**
 * Quita de un LOTE los emparejamientos de sorteo sin calendario.
 *
 * Recibe eventos CRUDOS de TheSportsDB y necesita ver el lote entero de una competencia en
 * una sola pasada: la condición 2 se decide mirando a todos los hermanos, no al partido solo.
 *
 * `fechaDe` se inyecta para usar exactamente la misma fecha que acabaría guardada.
 */
function filtrarSorteosSinCalendario(events, fechaDe) {
  if (!Array.isArray(events) || events.length === 0) return events;

  const porLiga = new Map();
  for (const e of events) {
    const k = String(e.idLeague || "unknown");
    if (!porLiga.has(k)) porLiga.set(k, []);
    porLiga.get(k).push(e);
  }

  const descartar = new Set();

  for (const lote of porLiga.values()) {
    // Condición 2: ¿esta competencia usa ronda? Si no, pasa completa.
    if (!lote.some(e => tieneRondaReal(e.intRound))) continue;

    // Condición 3: agrupar SOLO los de ronda cero por fecha exacta.
    //
    // Se cuentan únicamente los de ronda cero, no todos los partidos a esa hora. Es la
    // lectura conservadora: un partido con ronda real que casualmente empiece al mismo
    // instante nunca ayuda a condenar a los demás.
    const porFecha = new Map();
    for (const e of lote) {
      if (tieneRondaReal(e.intRound)) continue;
      const fecha = fechaDe(e);
      if (!fecha) continue;
      if (!porFecha.has(fecha)) porFecha.set(fecha, []);
      porFecha.get(fecha).push(e);
    }

    for (const [fecha, grupo] of porFecha) {
      if (grupo.length < UMBRAL_SORTEO) continue;
      for (const e of grupo) descartar.add(e);
      // Este renglón es el punto de todo el ejercicio: si vuelve a pasar con la Europa
      // League o con la temporada que entra, hay que enterarse por el log y no porque un
      // usuario mande una captura.
      const liga = grupo[0].strLeague || `idLeague ${grupo[0].idLeague}`;
      console.warn(`[sorteo] ${grupo.length} partidos DESCARTADOS de "${liga}": todos con ronda 0 y la misma fecha de relleno ${fecha}. Emparejamientos publicados antes de que exista el calendario.`);
    }
  }

  if (descartar.size === 0) return events;
  return events.filter(e => !descartar.has(e));
}

class TheSportsDbProvider {
  constructor() {
    this.apiKey = getEnv("THE_SPORTS_DB_API_KEY");
    this.baseUrl = getEnv("THE_SPORTS_DB_BASE_URL");
  }

  async getEventsByLeagueAndSeason({ leagueId, season, fromDate, toDate }) {
    const url = `${this.baseUrl}/${this.apiKey}/eventsseason.php`;
    const response = await axios.get(url, {
      params: { id: leagueId, s: season },
      timeout: 15000
    });
    let events = response.data?.events || [];

    // ANTES de recortar por fechas, y el orden es lo que hace que funcione.
    //
    // Aquí `events` es la TEMPORADA COMPLETA. La condición 2 —"¿esta competencia usa
    // ronda?"— necesita ver a los 66 partidos de Champions que sí traen jornada. Si el filtro
    // corriera después del recorte a 30 días, la ventana podría contener SOLO los 126 de
    // relleno, la condición 2 diría "esta competencia no usa ronda" y pasarían todos: el
    // filtro fallaría justo en el caso para el que se escribió.
    events = filtrarSorteosSinCalendario(events, (e) => this.buildScheduledStartUtc(e));

    // Filtrar por rango de fechas si se proporcionan
    if (fromDate || toDate) {
      events = events.filter(e => {
        const d = e.dateEvent;
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }

    return events;
  }

  async searchTeam(teamName) {
    const url = `${this.baseUrl}/${this.apiKey}/searchteams.php`;
    const response = await axios.get(url, {
      params: { t: teamName },
      timeout: 15000
    });
    return response.data?.teams?.[0] || null;
  }

  async getNextTeamEvents(teamId) {
    const url = `${this.baseUrl}/${this.apiKey}/eventsnext.php`;
    const response = await axios.get(url, {
      params: { id: teamId },
      timeout: 15000
    });
    return response.data?.events || [];
  }

  async getLastTeamEvents(teamId) {
    const url = `${this.baseUrl}/${this.apiKey}/eventslast.php`;
    const response = await axios.get(url, {
      params: { id: teamId },
      timeout: 15000
    });
    return response.data?.results || [];
  }

  async getNextLeagueEvents(leagueId) {
    const url = `${this.baseUrl}/${this.apiKey}/eventsnextleague.php`;
    const response = await axios.get(url, {
      params: { id: leagueId },
      timeout: 15000
    });
    // Mismo filtro: es el camino de respaldo de syncLeague y trae el lote de UNA liga, así
    // que ve el conjunto que la regla necesita. Aquí el lote es chico (~15-20 eventos), así
    // que llegar al umbral es improbable — pero si el proveedor mandara el sorteo por aquí,
    // no habría por qué dejarlo pasar solo porque entró por la otra puerta.
    return filtrarSorteosSinCalendario(
      response.data?.events || [],
      (e) => this.buildScheduledStartUtc(e)
    );
  }

  normalizeSport(rawSport) {
    if (!rawSport) return "unknown";
    const normalized = String(rawSport).trim().toLowerCase();
    switch (normalized) {
      case "soccer":      return "football";
      case "motorsport":
      case "formula 1":
      case "f1":          return "motorsport";
      default:            return normalized;
    }
  }

  mapStatus(rawStatus) {
    if (!rawStatus) return INTERNAL_STATUS.UNKNOWN;
    const normalized = String(rawStatus).trim().toLowerCase();
    switch (normalized) {
      case "not started":
      case "scheduled":   return INTERNAL_STATUS.SCHEDULED;
      case "postponed":   return INTERNAL_STATUS.POSTPONED;
      case "cancelled":
      case "canceled":    return INTERNAL_STATUS.CANCELLED;
      case "delayed":     return INTERNAL_STATUS.DELAYED;
      case "in play":
      case "live":        return INTERNAL_STATUS.LIVE;
      case "match finished":
      case "finished":
      case "ft":          return INTERNAL_STATUS.FINISHED;
      default:            return INTERNAL_STATUS.UNKNOWN;
    }
  }

  buildScheduledStartUtc(rawEvent) {
    const eventDate = rawEvent.dateEvent || null;
    const eventTime = rawEvent.strTime || "00:00:00";
    if (!eventDate) return null;
    return `${eventDate}T${eventTime}Z`;
  }

  normalizeMatch(rawEvent) {
    const providerMatchId      = rawEvent.idEvent;
    const sport                = this.normalizeSport(rawEvent.strSport);
    const competitionKey       = rawEvent.idLeague || "unknown";
    const competitionName      = rawEvent.strLeague || "Unknown Competition";
    const eventName            = rawEvent.strEvent || null;
    const homeParticipantName  = rawEvent.strHomeTeam || null;
    const awayParticipantName  = rawEvent.strAwayTeam || null;
    const scheduledStartUtc    = this.buildScheduledStartUtc(rawEvent);
    const rawStatus            = rawEvent.strStatus || null;
    const status               = this.mapStatus(rawStatus);
    const venueName            = rawEvent.strVenue || null;
    const lastProviderUpdateUtc = new Date().toISOString();

    // ── Nuevos campos geográficos ──
    const city    = rawEvent.strCity    || null;
    const country = rawEvent.strCountry || null;

    // Ronda/fase cruda de TheSportsDB (código numérico: "400", "16", "200"...).
    // Se mapea a etiqueta legible en roundLabelService.
    const intRound = rawEvent.intRound != null ? String(rawEvent.intRound) : null;

    return createMatch({
      internalMatchId: `the_sports_db_${providerMatchId}`,
      provider: "the_sports_db",
      providerMatchId,
      sport,
      competitionKey,
      competitionName,
      eventName,
      homeParticipantName,
      awayParticipantName,
      scheduledStartUtc,
      currentStartUtc: scheduledStartUtc,
      status,
      rawStatus,
      venueName,
      city,
      country,
      intRound,
      lastProviderUpdateUtc
    });
  }
}

// filtrarSorteosSinCalendario y UMBRAL_SORTEO se exportan para poder probarlos con lotes
// armados a mano, sin pegarle a la red.
module.exports = { TheSportsDbProvider, filtrarSorteosSinCalendario, UMBRAL_SORTEO };
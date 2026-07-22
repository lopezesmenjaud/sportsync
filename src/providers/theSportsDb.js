const axios = require("axios");
const { createMatch } = require("../domain/matchModel");
const { INTERNAL_STATUS } = require("../domain/statusMap");
const { getEnv } = require("../config/env");

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
    return response.data?.events || [];
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

module.exports = { TheSportsDbProvider };
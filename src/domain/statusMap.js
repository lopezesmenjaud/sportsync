// Estados internos de SportSync (NUNCA cambiar)
const INTERNAL_STATUS = {
  SCHEDULED: "scheduled",
  DELAYED: "delayed",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
  LIVE: "live",
  FINISHED: "finished",
  UNKNOWN: "unknown"
};

// Mapeo de ejemplo (tipo API-Sports)
function mapApiSportsStatus(rawStatus) {
  switch (rawStatus) {
    case "NS":
        return INTERNAL_STATUS.SCHEDULED;

    case "TBD":
        return INTERNAL_STATUS.SCHEDULED;

    case "LIVE":
    case "1H":
    case "2H":
    case "HT":
        return INTERNAL_STATUS.LIVE;

    case "FT":
        return INTERNAL_STATUS.FINISHED;

    case "PST":
        return INTERNAL_STATUS.POSTPONED;

    case "CANC":
        return INTERNAL_STATUS.CANCELLED;

    case "DELAYED":
        return INTERNAL_STATUS.DELAYED;

    default:
        return INTERNAL_STATUS.UNKNOWN;
  }
}

module.exports = {
  INTERNAL_STATUS,
  mapApiSportsStatus
};
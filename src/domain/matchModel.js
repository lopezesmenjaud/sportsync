function createMatch({
  internalMatchId,
  provider,
  providerMatchId,
  sport,
  competitionKey,
  competitionName,
  eventName,
  homeParticipantName,
  awayParticipantName,
  scheduledStartUtc,
  currentStartUtc,
  status,
  rawStatus,
  venueName,
  city,
  country,
  intRound,
  lastProviderUpdateUtc
}) {
  return {
    internalMatchId,
    provider,
    providerMatchId,
    sport,
    competitionKey,
    competitionName,
    eventName:  eventName || null,
    homeParticipantName,
    awayParticipantName,
    scheduledStartUtc,
    currentStartUtc,
    status,
    rawStatus,
    venueName,
    city:    city    || null,
    country: country || null,
    intRound: intRound || null,
    lastProviderUpdateUtc
  };
}

module.exports = { createMatch };
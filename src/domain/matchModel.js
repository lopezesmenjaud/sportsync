function createMatch({
  internalMatchId,
  provider,
  providerMatchId,
  sport,
  competitionKey,
  competitionName,
  homeParticipantName,
  awayParticipantName,
  scheduledStartUtc,
  currentStartUtc,
  status,
  rawStatus,
  venueName,
  city,
  country,
  lastProviderUpdateUtc
}) {
  return {
    internalMatchId,
    provider,
    providerMatchId,
    sport,
    competitionKey,
    competitionName,
    homeParticipantName,
    awayParticipantName,
    scheduledStartUtc,
    currentStartUtc,
    status,
    rawStatus,
    venueName,
    city:    city    || null,
    country: country || null,
    lastProviderUpdateUtc
  };
}

module.exports = { createMatch };
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { normalizeSport } = require("./syncService");

function matchAppliesToSubscription(match, subscription) {
  if (subscription.sport && normalizeSport(subscription.sport) !== normalizeSport(match.sport)) {
    return false;
  }

  if (
    subscription.competitionKey &&
    match.competitionKey !== subscription.competitionKey
  ) {
    return false;
  }

  if (subscription.teamName) {
    const teamName = subscription.teamName.toLowerCase();
    const home = (match.homeParticipantName || "").toLowerCase();
    const away = (match.awayParticipantName || "").toLowerCase();

    if (home !== teamName && away !== teamName) {
      return false;
    }
  }

  return true;
}

async function getMatchesForUser(userId) {
  const subscriptions = await subscriptionRepository.getByUserId(userId);
  const matches = await matchRepository.getAll();

  const relevantMatches = matches.filter((match) =>
    subscriptions.some((subscription) =>
      matchAppliesToSubscription(match, subscription)
    )
  );

  return relevantMatches;
}

// Devuelve de qué lado juega el equipo que sigue el usuario: 'home' | 'away' | null.
// null si: sigue la liga (sin equipo), sigue a los DOS equipos, o no hay dos equipos (F1/ciclismo).
function getUserSide(match, subscriptions) {
  const home = (match.homeParticipantName || "").toLowerCase();
  const away = (match.awayParticipantName || "").toLowerCase();
  if (!home || !away) return null;
  const teams = (subscriptions || []).filter((s) => s.teamName).map((s) => s.teamName.toLowerCase());
  const followsHome = teams.includes(home);
  const followsAway = teams.includes(away);
  if (followsHome && !followsAway) return "home";
  if (followsAway && !followsHome) return "away";
  return null;
}

module.exports = {
  getMatchesForUser,
  matchAppliesToSubscription,
  getUserSide,
};
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchAppliesToSubscription } = require("./subscriptionMatchService");

async function getAffectedUserIdsForMatch(match) {
  const subscriptions = await subscriptionRepository.getAll();

  const matchingUserIds = subscriptions
    .filter((subscription) => matchAppliesToSubscription(match, subscription))
    .map((subscription) => subscription.userId);

  return [...new Set(matchingUserIds)];
}

module.exports = { getAffectedUserIdsForMatch };
const { getAffectedUserIdsForMatch } = require("./affectedUsersService");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const googleCalendarProvider = require("./googleCalendarProvider");

async function syncMatchToCalendars(match) {
  const affectedUserIds = await getAffectedUserIdsForMatch(match);

  const results = [];

  for (const userId of affectedUserIds) {
    try {
      const existingCalendarEvent =
        await calendarEventRepository.getByUserIdAndProviderMatchId(
          userId,
          match.providerMatchId
        );

      if (!existingCalendarEvent) {
        const created = await googleCalendarProvider.createEvent({
          userId,
          match
        });

        const link = await calendarEventRepository.create({
          userId,
          providerMatchId: match.providerMatchId,
          calendarProvider: "google",
          calendarEventId: created.calendarEventId
        });

        results.push({
          action: "created",
          userId,
          providerMatchId: match.providerMatchId,
          calendarEventId: link.calendarEventId,
          htmlLink: created.htmlLink
        });

        continue;
      }

      const updated = await googleCalendarProvider.updateEvent({
        userId,
        calendarEventId: existingCalendarEvent.calendarEventId,
        match
      });

      results.push({
        action: "updated",
        userId,
        providerMatchId: match.providerMatchId,
        calendarEventId: existingCalendarEvent.calendarEventId,
        htmlLink: updated.htmlLink
      });
    } catch (error) {
      console.error(`[calendar] Error syncing match ${match.providerMatchId} for user ${userId}:`, error.message);
    }
  }

  return results;
}

module.exports = { syncMatchToCalendars };
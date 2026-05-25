const { getAffectedUserIdsForMatch } = require("./affectedUsersService");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const googleCalendarProvider = require("./googleCalendarProvider");
const { createMutex } = require("./mutex");

// Lock global para serializar la sección crítica
// "verificar existencia → crear evento en Google → insertar fila".
// Sin esto, dos sincronizaciones concurrentes pueden ver "no existe" a la vez
// y ambas crear el evento, generando filas duplicadas en calendar_events.
const calendarEventCreateMutex = createMutex();

async function syncMatchToCalendars(match) {
  const affectedUserIds = await getAffectedUserIdsForMatch(match);

  const results = [];

  for (const userId of affectedUserIds) {
    try {
      const calendarId = await googleCalendarProvider.getOrCreateFanscheduleCalendar({ userId });

      const lockResult = await calendarEventCreateMutex(async () => {
        const existingCalendarEvent =
          await calendarEventRepository.getByUserIdAndProviderMatchId(
            userId,
            match.providerMatchId
          );

        if (existingCalendarEvent) {
          return { kind: "existing", existingCalendarEvent };
        }

        const created = await googleCalendarProvider.createEvent({
          userId,
          calendarId,
          match
        });

        const link = await calendarEventRepository.create({
          userId,
          providerMatchId: match.providerMatchId,
          calendarProvider: "google",
          calendarEventId: created.calendarEventId
        });

        return { kind: "created", created, link };
      });

      if (lockResult.kind === "created") {
        results.push({
          action: "created",
          userId,
          providerMatchId: match.providerMatchId,
          calendarEventId: lockResult.link.calendarEventId,
          htmlLink: lockResult.created.htmlLink
        });
        continue;
      }

      const existingCalendarEvent = lockResult.existingCalendarEvent;

      const updated = await googleCalendarProvider.updateEvent({
        userId,
        calendarId,
        calendarEventId: existingCalendarEvent.calendarEventId,
        match
      });

      // Si updateEvent cayó al fallback de insert, el calendarEventId nuevo difiere
      // del que teníamos guardado: persistirlo para no perder la referencia.
      if (updated.calendarEventId !== existingCalendarEvent.calendarEventId) {
        await calendarEventRepository.updateCalendarEventId(
          existingCalendarEvent.id,
          updated.calendarEventId
        );
      }

      results.push({
        action: "updated",
        userId,
        providerMatchId: match.providerMatchId,
        calendarEventId: updated.calendarEventId,
        htmlLink: updated.htmlLink
      });
    } catch (error) {
      console.error(`[calendar] Error syncing match ${match.providerMatchId} for user ${userId}:`, error.message);
    }
  }

  return results;
}

module.exports = { syncMatchToCalendars };

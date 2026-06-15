const { getAffectedUserIdsForMatch } = require("./affectedUsersService");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const googleCalendarProvider = require("./googleCalendarProvider");
const { createMutex } = require("./mutex");

// Detecta el error invalid_grant de Google (refresh token expirado/revocado).
// Puede llegar como message, como response.data.error o como código.
function isInvalidGrant(err) {
  const msg     = String(err?.message || "").toLowerCase();
  const respErr = String(err?.response?.data?.error || "").toLowerCase();
  const code    = String(err?.code || "").toLowerCase();
  return msg.includes("invalid_grant") || respErr === "invalid_grant" || code === "invalid_grant";
}

// Lock global para serializar la sección crítica
// "verificar existencia → crear evento en Google → insertar fila".
// Sin esto, dos sincronizaciones concurrentes pueden ver "no existe" a la vez
// y ambas crear el evento, generando filas duplicadas en calendar_events.
const calendarEventCreateMutex = createMutex();

// skipUserIds: Set compartido dentro de una misma corrida de sync. Un usuario que
// ya disparó invalid_grant se agrega ahí para no reintentarlo ni re-loguearlo en
// los partidos siguientes de esa corrida. Llamadas sueltas usan un Set vacío nuevo.
async function syncMatchToCalendars(match, skipUserIds = new Set()) {
  const affectedUserIds = await getAffectedUserIdsForMatch(match);

  const results = [];

  for (const userId of affectedUserIds) {
    // Ya marcado needsReauth en esta corrida: saltar sin intentar ni loguear.
    if (skipUserIds.has(userId)) continue;

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
      // Refresh token expirado/revocado: marcar al usuario para reconexión y saltar
      // el resto del sync para ESTE usuario. Los demás usuarios continúan normal.
      if (isInvalidGrant(error)) {
        try {
          await googleAccountRepository.markNeedsReauth(userId);
        } catch (markErr) {
          console.error(`[auth] Failed to mark needsReauth for ${userId}:`, markErr.message);
        }
        console.log(`[auth] User ${userId} refresh token invalid, marked needsReauth=true`);
        skipUserIds.add(userId);
        continue;
      }
      console.error(`[calendar] Error syncing match ${match.providerMatchId} for user ${userId}:`, error.message);
    }
  }

  return results;
}

module.exports = { syncMatchToCalendars };

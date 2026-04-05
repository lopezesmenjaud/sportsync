const { google } = require("googleapis");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");

// Lee credenciales OAuth una sola vez
const credentials = require("../config/google-oauth.json");
const { client_id, client_secret, redirect_uris } = credentials.web;

// Crea un OAuth2Client dedicado por usuario (evita race conditions)
function createOAuth2Client() {
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function getCalendarClientForUser(userId) {
  const account = await googleAccountRepository.getByUserId(userId);

  if (!account) {
    throw new Error(`No Google account found for userId: ${userId}`);
  }

  // Crear instancia dedicada para este usuario
  const userClient = createOAuth2Client();

  userClient.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    scope: account.scope,
    expiry_date: account.expiryDate,
  });

  // Persistir tokens renovados automáticamente
  userClient.on("tokens", async (newTokens) => {
    try {
      await googleAccountRepository.upsert({
        userId,
        googleEmail: account.googleEmail,
        accessToken: newTokens.access_token || account.accessToken,
        refreshToken: newTokens.refresh_token || null,
        scope: newTokens.scope || account.scope,
        expiryDate: newTokens.expiry_date || null,
      });
      console.log(`[google] Refreshed tokens persisted for ${userId}`);
    } catch (err) {
      console.error(`[google] Failed to persist refreshed tokens for ${userId}:`, err.message);
    }
  });

  return google.calendar({ version: "v3", auth: userClient });
}

function buildEventFromMatch(match) {
  const startDate = new Date(match.currentStartUtc || match.scheduledStartUtc);
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

  const description = [
    `${match.homeParticipantName} vs ${match.awayParticipantName}`,
    ``,
    `Competición: ${match.competitionName}`,
    `Deporte: ${match.sport}`,
    match.venueName ? `Estadio: ${match.venueName}` : null,
    ``,
    `Powered by SportSync`,
  ].filter(Boolean).join("\n");

  return {
    summary: `${match.homeParticipantName} vs ${match.awayParticipantName}`,
    location: match.venueName || undefined,
    description,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: "UTC",
    },
  };
}

async function createEvent({ userId, match }) {
  const calendar = await getCalendarClientForUser(userId);

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: buildEventFromMatch(match),
  });

  return {
    calendarEventId: response.data.id,
    htmlLink: response.data.htmlLink,
  };
}

async function updateEvent({ userId, calendarEventId, match }) {
  const calendar = await getCalendarClientForUser(userId);

  const response = await calendar.events.update({
    calendarId: "primary",
    eventId: calendarEventId,
    requestBody: buildEventFromMatch(match),
  });

  return {
    calendarEventId: response.data.id,
    htmlLink: response.data.htmlLink,
  };
}

async function deleteEvent({ userId, calendarEventId }) {
  const calendar = await getCalendarClientForUser(userId);

  await calendar.events.delete({
    calendarId: "primary",
    eventId: calendarEventId,
  });

  return { calendarEventId };
}

module.exports = {
  createEvent,
  updateEvent,
  deleteEvent,
};

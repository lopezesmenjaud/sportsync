const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");

// Lee credenciales OAuth: archivo local o variables de entorno
let client_id, client_secret, redirect_uri;
const credentialsPath = path.join(__dirname, "../config/google-oauth.json");
if (fs.existsSync(credentialsPath)) {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  client_id = credentials.web.client_id;
  client_secret = credentials.web.client_secret;
  redirect_uri = credentials.web.redirect_uris[0];
} else {
  client_id = process.env.GOOGLE_CLIENT_ID;
  client_secret = process.env.GOOGLE_CLIENT_SECRET;
  redirect_uri = process.env.GOOGLE_REDIRECT_URI;
}

// Crea un OAuth2Client dedicado por usuario (evita race conditions)
function createOAuth2Client() {
  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
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

  const isTeamVsTeam = match.homeParticipantName && match.awayParticipantName;
  const summary = isTeamVsTeam
    ? `${match.homeParticipantName} vs ${match.awayParticipantName}`
    : match.eventName || match.competitionName || "Evento deportivo";

  const matchUrl = `https://fanschedule.com/match/${match.providerMatchId}`;

  const description = [
    isTeamVsTeam ? `${match.homeParticipantName} vs ${match.awayParticipantName}` : (match.eventName || match.competitionName),
    ``,
    `Competición: ${match.competitionName}`,
    `Deporte: ${match.sport}`,
    match.venueName ? `Estadio: ${match.venueName}` : null,
    ``,
    `Ver partido: ${matchUrl}`,
    `Powered by FanSchedule`,
  ].filter(Boolean).join("\n");

  return {
    summary,
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
    source: {
      title: "Ver en FanSchedule",
      url: matchUrl
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
  getCalendarClientForUser,
};

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { createMutex } = require("./mutex");
const { getRoundLabel } = require("./roundLabelService");

// Lock global para serializar la sección check-then-insert que crea
// el calendario "FanSchedule" en la cuenta del usuario. Sin esto, dos flujos
// concurrentes pueden ver "no existe" y crear dos calendarios distintos.
const fanscheduleCalendarMutex = createMutex();

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

async function buildEventFromMatch(match) {
  const startDate = new Date(match.currentStartUtc || match.scheduledStartUtc);
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

  const isTeamVsTeam = match.homeParticipantName && match.awayParticipantName;
  const baseSummary = isTeamVsTeam
    ? `${match.homeParticipantName} vs ${match.awayParticipantName}`
    : match.eventName || match.competitionName || "Evento deportivo";

  // Etiqueta de fase (ej. "Cuartos"). Si no hay, el título queda igual que hoy.
  const roundLabel = await getRoundLabel(
    match.competitionKey, match.competitionName, match.intRound, match.sport
  );
  const summary = roundLabel ? `${baseSummary} (${roundLabel})` : baseSummary;

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

const FANSCHEDULE_CALENDAR_CACHE = new Map();
const FANSCHEDULE_CALENDAR_TTL_MS = 5 * 60 * 1000;

function invalidateFanscheduleCalendarCache(userId) {
  FANSCHEDULE_CALENDAR_CACHE.delete(userId);
}

function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

async function createEvent({ userId, calendarId, match }) {
  if (!calendarId) throw new Error("createEvent: calendarId is required");
  const calendar = await getCalendarClientForUser(userId);
  const requestBody = await buildEventFromMatch(match);

  try {
    const response = await calendar.events.insert({ calendarId, requestBody });
    return {
      calendarEventId: response.data.id,
      htmlLink: response.data.htmlLink,
      calendarId,
    };
  } catch (err) {
    if (!isGoneStatus(err)) throw err;

    console.log(`[google] Calendar ${calendarId} gone for ${userId} — recreating and retrying insert`);
    invalidateFanscheduleCalendarCache(userId);
    const newCalendarId = await getOrCreateFanscheduleCalendar({ userId });

    const response = await calendar.events.insert({ calendarId: newCalendarId, requestBody });
    return {
      calendarEventId: response.data.id,
      htmlLink: response.data.htmlLink,
      calendarId: newCalendarId,
    };
  }
}

async function updateEvent({ userId, calendarId, calendarEventId, match }) {
  if (!calendarId) throw new Error("updateEvent: calendarId is required");
  const calendar = await getCalendarClientForUser(userId);
  const requestBody = await buildEventFromMatch(match);

  try {
    const response = await calendar.events.update({
      calendarId,
      eventId: calendarEventId,
      requestBody,
    });
    return {
      calendarEventId: response.data.id,
      htmlLink: response.data.htmlLink,
      calendarId,
    };
  } catch (err) {
    if (!isGoneStatus(err)) throw err;

    console.log(`[google] Event ${calendarEventId} gone for ${userId} — recreating via insert`);
    return await createEvent({ userId, calendarId, match });
  }
}

async function deleteEvent({ userId, calendarId, calendarEventId }) {
  if (!calendarId) throw new Error("deleteEvent: calendarId is required");
  const calendar = await getCalendarClientForUser(userId);

  try {
    await calendar.events.delete({ calendarId, eventId: calendarEventId });
  } catch (err) {
    if (!isGoneStatus(err)) throw err;
    console.log(`[google] Event ${calendarEventId} already gone for ${userId} — treating delete as success`);
  }

  return { calendarEventId };
}

async function getOrCreateFanscheduleCalendar({ userId, skipCache = false } = {}) {
  if (!skipCache) {
    const cached = FANSCHEDULE_CALENDAR_CACHE.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.calendarId;
    }
  }

  return await fanscheduleCalendarMutex(async () => {
    // Re-chequear cache adentro del lock: si otro flujo ya creó el calendario
    // mientras esperábamos, lo tomamos sin volver a crear.
    if (!skipCache) {
      const cached = FANSCHEDULE_CALENDAR_CACHE.get(userId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.calendarId;
      }
    }

    const account = await googleAccountRepository.getByUserId(userId);
    if (!account) {
      throw new Error(`No Google account found for userId: ${userId}`);
    }

    const calendar = await getCalendarClientForUser(userId);
    const existingId = account.fanschedule_calendar_id;

    if (existingId) {
      try {
        await calendar.calendars.get({ calendarId: existingId });
        FANSCHEDULE_CALENDAR_CACHE.set(userId, { calendarId: existingId, expiresAt: Date.now() + FANSCHEDULE_CALENDAR_TTL_MS });
        return existingId;
      } catch (err) {
        if (!isGoneStatus(err)) throw err;
        console.log(`[google] FanSchedule calendar ${existingId} no longer exists for ${userId} — recreating`);
      }
    }

    const created = await calendar.calendars.insert({
      requestBody: { summary: "FanSchedule" },
    });
    const newId = created.data.id;

    await googleAccountRepository.setFanscheduleCalendarId(userId, newId);
    FANSCHEDULE_CALENDAR_CACHE.set(userId, { calendarId: newId, expiresAt: Date.now() + FANSCHEDULE_CALENDAR_TTL_MS });
    console.log(`[google] Created FanSchedule calendar ${newId} for ${userId}`);

    return newId;
  });
}

module.exports = {
  createEvent,
  updateEvent,
  deleteEvent,
  getCalendarClientForUser,
  getOrCreateFanscheduleCalendar,
  invalidateFanscheduleCalendarCache,
};

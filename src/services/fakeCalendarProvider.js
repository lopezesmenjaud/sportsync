function createEvent({ userId, match }) {
  const fakeEventId = `fake_google_event_${userId}_${match.providerMatchId}`;

  console.log("FAKE CREATE EVENT:");
  console.log(
    JSON.stringify(
      {
        userId,
        providerMatchId: match.providerMatchId,
        fakeEventId
      },
      null,
      2
    )
  );

  return {
    calendarEventId: fakeEventId
  };
}

function updateEvent({ userId, calendarEventId, match }) {
  console.log("FAKE UPDATE EVENT:");
  console.log(
    JSON.stringify(
      {
        userId,
        calendarEventId,
        providerMatchId: match.providerMatchId,
        currentStartUtc: match.currentStartUtc,
        status: match.status
      },
      null,
      2
    )
  );

  return {
    calendarEventId
  };
}

module.exports = {
  createEvent,
  updateEvent
};
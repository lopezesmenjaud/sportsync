const http = require("http");
const fs = require("fs");

function toICSDate(utcString) {
  return utcString
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace(".000", "");
}

function makeUID(index) {
  return `sportsync-event-${index}@sportsync.com`;
}

function generateICS(events) {
  let icsContent = "";

  icsContent += "BEGIN:VCALENDAR\r\n";
  icsContent += "VERSION:2.0\r\n";
  icsContent += "PRODID:-//SportSync//SportSync Calendar//EN\r\n";
  icsContent += "CALSCALE:GREGORIAN\r\n";
  icsContent += "METHOD:PUBLISH\r\n";

  events.forEach(function (event, index) {
    const startDate = toICSDate(event.start_time_utc);

    const startMs = new Date(event.start_time_utc).getTime();
    const endMs = startMs + 2 * 60 * 60 * 1000;
    const endDate = toICSDate(new Date(endMs).toISOString());

    const summary = event.title + " - " + event.round;
    const description =
      "Venue: " + event.venue + " | Competition: " + event.competition;

    icsContent += "BEGIN:VEVENT\r\n";
    icsContent += "UID:" + makeUID(index) + "\r\n";
    icsContent += "SUMMARY:" + summary + "\r\n";
    icsContent += "DTSTART:" + startDate + "\r\n";
    icsContent += "DTEND:" + endDate + "\r\n";
    icsContent += "DESCRIPTION:" + description + "\r\n";
    icsContent += "LOCATION:" + event.venue + "\r\n";
    icsContent += "END:VEVENT\r\n";
  });

  icsContent += "END:VCALENDAR\r\n";

  return icsContent;
}

const server = http.createServer((req, res) => {
  if (req.url === "/laliga.ics") {
    const raw = fs.readFileSync("data/events_laliga.json", "utf8");
    const events = JSON.parse(raw);

    const ics = generateICS(events);

    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="laliga.ics"',
    });

    res.end(ics);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("SportSync server running. Open /laliga.ics");
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`SportSync server running at http://localhost:${PORT}`);
});
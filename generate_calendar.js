// SportSync Calendar Generator
// Reads data/events_laliga.json and creates sportsync_calendar.ics

const fs = require("fs");

// Step 1: Read the JSON file
const raw = fs.readFileSync("data/events_laliga.json", "utf8");
const events = JSON.parse(raw);

// Step 2: Helper – format a UTC date string to ICS timestamp
// ICS format: YYYYMMDDTHHmmssZ
function toICSDate(utcString) {
  return utcString
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace(".000", "");
}

// Step 3: Helper – make a unique ID for each event
function makeUID(index) {
  return `sportsync-event-${index}@sportsync.com`;
}

// Step 4: Build the ICS content
let icsContent = "";

icsContent += "BEGIN:VCALENDAR\r\n";
icsContent += "VERSION:2.0\r\n";
icsContent += "PRODID:-//SportSync//SportSync Calendar//EN\r\n";
icsContent += "CALSCALE:GREGORIAN\r\n";
icsContent += "METHOD:PUBLISH\r\n";

events.forEach(function (event, index) {
  const startDate = toICSDate(event.start_time_utc);

  // End time = start + 2 hours
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

// Step 5: Write the output file
fs.writeFileSync("sportsync_calendar.ics", icsContent, "utf8");

console.log("Done! File created: sportsync_calendar.ics");
console.log("Events exported:", events.length);
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

let client_id, client_secret, redirect_uri;

const credentialsPath = path.join(__dirname, "google-oauth.json");
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

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

module.exports = { oauth2Client };

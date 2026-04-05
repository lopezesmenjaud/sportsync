const { google } = require("googleapis");
const credentials = require("./google-oauth.json");

const { client_id, client_secret, redirect_uris } = credentials.web;

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

module.exports = { oauth2Client };
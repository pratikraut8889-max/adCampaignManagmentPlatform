import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

const TOKEN_FILE = path.join(process.cwd(), "data", "google-token.json");
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
export const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
import { google } from "googleapis";
import { createReadStream } from "node:fs";


export async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}) {
  await fs.mkdir(path.dirname(TOKEN_FILE), {
    recursive: true,
  });

  cachedAccessToken = null; // new credentials: never serve an old token

  const existing = await loadTokens();

  const updated = {
    ...existing,
    ...tokens,
  };

  await fs.writeFile(TOKEN_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

export async function loadTokens(): Promise<any> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");

    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Access tokens last about an hour. Reuse one instead of asking Google for a
// new token (and rewriting the token file) on every API call.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60_000 > Date.now()) {
    return cachedAccessToken.token;
  }

  const tokens = await loadTokens();

  if (!tokens.refresh_token) {
    throw new Error("No refresh token found. Connect Google Ads first.");
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  client.setCredentials({
    refresh_token: tokens.refresh_token,
  });

  const { token, res: tokenResponse } = await client.getAccessToken();

  if (!token) {
    throw new Error("Unable to generate Google access token");
  }

  /*
    Save the latest access token/expiry time.
    Refresh token remains stored.
  */

  const expiryDate = tokenResponse?.data?.expiry_date;

  cachedAccessToken = {
    token,
    expiresAt:
      typeof expiryDate === "number" ? expiryDate : Date.now() + 50 * 60_000,
  };

  await saveTokens({
    access_token: token,
    expiry_date: expiryDate,
  });

  return token;
}


const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  // Do not crash the whole server: only the YouTube routes need this.
  console.warn("YouTube OAuth is not configured. YouTube routes will not work.");
}

export const youtubeOAuth = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);

youtubeOAuth.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});
export const youtube = google.youtube({
  version: "v3",
  auth: youtubeOAuth,
});



import fs from "node:fs/promises";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

const TOKEN_FILE = path.join(process.cwd(), "data", "google-token.json");
const {GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI} = process.env;
export const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

export async function saveTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}) {
  await fs.mkdir(path.dirname(TOKEN_FILE), {
    recursive: true,
  });

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

export async function getAccessToken(): Promise<string> {
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

  await saveTokens({
    access_token: token,
    expiry_date: tokenResponse?.data?.expiry_date,
  });

  return token;
}

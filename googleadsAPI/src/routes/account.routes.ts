import express, { application } from 'express';

import crypto from "node:crypto";
import { getAccessToken, saveTokens, oauth2Client, GOOGLE_ADS_SCOPE, youtubeOAuth } from '../google_config.js'

const router = express.Router()
const oauthStates = new Set<string>();

router.get("/auth/google", (_req, res) => {
    const state = crypto.randomBytes(32).toString("hex");

    oauthStates.add(state);

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [GOOGLE_ADS_SCOPE],
        include_granted_scopes: true,
        prompt: "consent",
        state,
    });

    res.redirect(authUrl);
});
router.get("/auth/google/callback", async (req, res) => {
    try {
        const code = req.query.code;
        const state = req.query.state;

        if (typeof code !== "string" || typeof state !== "string") {
            return res.status(400).json({
                message: "Invalid OAuth callback",
            });
        }

        if (!oauthStates.has(state)) {
            return res.status(400).json({
                message: "Invalid OAuth state",
            });
        }

        oauthStates.delete(state);

        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token) {
            return res.status(400).json({
                message: "No access token received",
            });
        }

        /*
          IMPORTANT:
    
          access_token is temporary.
          refresh_token is what allows us to
          get new access tokens later.
        */

        await saveTokens({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date,
        });

        return res.json({
            message: "Google OAuth successful",
            hasAccessToken: Boolean(tokens.access_token),
            hasRefreshToken: Boolean(tokens.refresh_token),
            saved: true,
        });
    } catch (error) {
        console.error("OAuth error:", error);

        return res.status(500).json({
            message: "OAuth failed",
        });
    }
});
router.get("/accounts", async (_req, res) => {
    try {
        const accessToken = await getAccessToken();

        const response = await fetch(
            "https://googleads.googleapis.com/v25/customers:listAccessibleCustomers",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },
            },
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            message: "Google Ads API successful",
            accessibleCustomers: data,
        });
    } catch (error) {
        console.error("Google Ads error:", error);

        return res.status(500).json({
            message: error instanceof Error ? error.message : "Google Ads API failed",
        });
    }
});

router.get("/youtube/auth", (_req, res) => {
    const authUrl = youtubeOAuth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/youtube.upload",
        ],
    });

    const parsedUrl = new URL(authUrl);

    console.log({
        clientIdInUrl: Boolean(
            parsedUrl.searchParams.get("client_id")
        ),
        clientIdMatches:
            parsedUrl.searchParams.get("client_id") ===
            process.env.YOUTUBE_CLIENT_ID,
        redirectUriInUrl:
            parsedUrl.searchParams.get("redirect_uri"),
    });

    return res.redirect(authUrl);
});

router.get("/youtube/oauth2callback", async (req, res) => {
    try {
        const code = String(req.query.code || "");

        if (!code) {
            return res.status(400).send(
                "Authorization code missing"
            );
        }

        const { tokens } = await youtubeOAuth.getToken(code);

        if (!tokens.refresh_token) {
            return res.status(400).send(
                "Refresh token was not returned. Try re-authorizing."
            );
        }

        // Development only. Tokens are never printed in production.
        if (process.env.NODE_ENV === "production") {
            return res.send(
                "YouTube authorization successful. The token is not displayed in production."
            );
        }

        console.log(
            "YOUTUBE_REFRESH_TOKEN=",
            tokens.refresh_token
        );

        return res.send(
            "YouTube authorization successful. Check your backend terminal."
        );
    } catch (error) {
        console.error("OAuth callback failed:", error);

        return res.status(500).send(
            "Failed to exchange authorization code for tokens."
        );
    }
});

export default router;


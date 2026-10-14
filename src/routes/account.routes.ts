import express, { application } from 'express';

import crypto from "node:crypto";
import { getAccessToken, saveTokens, oauth2Client, GOOGLE_ADS_SCOPE } from '../google_config.js'

const accountRoutes = express.Router()
const oauthStates = new Set<string>();

accountRoutes.get("/auth/google", (_req, res) => {
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
accountRoutes.get("/auth/google/callback", async (req, res) => {
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
accountRoutes.get("/google-ads/accounts", async (_req, res) => {
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


export default accountRoutes;


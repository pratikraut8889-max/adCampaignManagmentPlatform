import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

declare module "express-session" {
    interface SessionData {
        metaOauthState?: string;
        metaAccessToken?: string;
        metaTokenExpiresAt?: number;
    }
}

const router = Router();

const {
    META_APP_ID = "",
    META_APP_SECRET = "",
    META_LOGIN_CONFIG_ID = "",
    META_REDIRECT_URI = "",
    META_GRAPH_API_VERSION = "v25.0",
} = process.env;

// Step A: Start Facebook Login for Business.
router.get("/auth/meta", (req, res, next) => {
    req.session.metaOauthState = crypto.randomBytes(32).toString("hex");

    req.session.save((error) => {
        if (error) {
            return next(error);
        }

        const loginUrl = new URL(
            `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`,
        );

        loginUrl.searchParams.set("client_id", META_APP_ID);
        loginUrl.searchParams.set("redirect_uri", META_REDIRECT_URI);
        loginUrl.searchParams.set("config_id", META_LOGIN_CONFIG_ID);
        loginUrl.searchParams.set("response_type", "code");
        loginUrl.searchParams.set("state", req.session.metaOauthState!);

        // The Business Login configuration contains the selected permissions.
        res.redirect(loginUrl.toString());
    });
});

// Step B: Receive the authorization code and exchange it server-side.
router.get("/auth/meta/callback", async (req, res) => {
    try {
        const metaError =
            typeof req.query.error === "string" ? req.query.error : undefined;

        if (metaError) {
            return res
                .status(400)
                .send("Meta login was cancelled or denied. Return home and try again.");
        }

        const code =
            typeof req.query.code === "string" ? req.query.code : undefined;

        const returnedState =
            typeof req.query.state === "string" ? req.query.state : undefined;

        if (
            !code ||
            !returnedState ||
            !req.session.metaOauthState ||
            returnedState !== req.session.metaOauthState
        ) {
            return res
                .status(400)
                .send("Invalid OAuth response. Please start login again.");
        }

        delete req.session.metaOauthState;

        const tokenUrl = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`,
        );

        tokenUrl.searchParams.set("client_id", META_APP_ID);
        tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
        tokenUrl.searchParams.set("redirect_uri", META_REDIRECT_URI);
        tokenUrl.searchParams.set("code", code);

        const tokenResponse = await fetch(tokenUrl);
        const tokenData = (await tokenResponse.json()) as {
            access_token?: string;
            expires_in?: number;
            error?: { message?: string };
        };

        if (!tokenResponse.ok || !tokenData.access_token) {
            console.error(
                "Meta token exchange failed:",
                tokenData.error?.message ?? "Unknown Meta API error",
            );

            return res
                .status(502)
                .send("Meta did not return an access token. Check your terminal logs.");
        }

        // Keep the token server-side; never send it to the browser.
        req.session.metaAccessToken = tokenData.access_token;

        if (typeof tokenData.expires_in === "number") {
            req.session.metaTokenExpiresAt =
                Date.now() + tokenData.expires_in * 1000;
        } else {
            delete req.session.metaTokenExpiresAt;
        }

        const tokenFile = path.join(import.meta.dirname, "..", "data", "token.json");
        const payload = {
            id: crypto.randomUUID(),
            access_token: tokenData.access_token,
        };

        await fs.mkdir(path.dirname(tokenFile), { recursive: true });
        await fs.writeFile(tokenFile, JSON.stringify(payload, null, 2), "utf-8");

        await new Promise<void>((resolve, reject) => {
            req.session.save((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        res.send(`
      <h1>Meta OAuth login succeeded!</h1>
      <p>Your server received and stored an access token in this development session.</p>
      <p>The token has not been displayed in the browser.</p>
      <a href="/">Return home</a>
    `);
    } catch (error) {
        console.error(
            "OAuth callback failed:",
            error instanceof Error ? error.message : "Unknown error",
        );

        res.status(500).send("OAuth failed. Check the server terminal for details.");
    }
});

export default router;

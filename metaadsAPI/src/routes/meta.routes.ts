import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";

const router = Router();
const { META_GRAPH_API_VERSION = "v25.0" } = process.env;

async function readAccessToken(): Promise<string | undefined> {
    try {
        const tokenFile = path.join(import.meta.dirname, "..", "data", "token.json");
        const fileContents = await fs.readFile(tokenFile, "utf-8");
        const tokenData = JSON.parse(fileContents) as { access_token?: string };
        return tokenData.access_token;
    } catch {
        return undefined;
    }
}

router.get("/meta/ad-accounts", async (_req, res) => {
    const accessToken = await readAccessToken();

    if (!accessToken) {
        return res.status(401).send("Please connect Meta Ads first.");
    }

    try {
        const url = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/adaccounts`,
        );
        url.searchParams.set("fields", "id,name,account_status,currency");

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            console.error("Meta API request failed:", data);
            return res.status(response.status).json(data);
        }

        return res.json(data);
    } catch (error) {
        console.error(
            "Ad account request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(500).send("Could not retrieve ad accounts.");
    }
});

router.get("/meta/permissions", async (_req, res) => {
    const accessToken = await readAccessToken();

    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    try {
        const url = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/permissions`,
        );

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
            console.error("Meta permissions error:", data);
            return res.status(response.status).json({
                error: "Could not retrieve Meta permissions.",
            });
        }

        return res.json(data);
    } catch (error) {
        console.error(
            "Permissions request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});

export default router;

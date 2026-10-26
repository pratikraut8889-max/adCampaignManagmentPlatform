import { Router } from "express";
import readAccessToken from "../config.js";
const router = Router();
const { META_GRAPH_API_VERSION = "v25.0" } = process.env;


// Read campaigns for an ad account.
router.get("/meta/ad-accounts/:adAccountId/campaigns", async (req, res) => {
    const accessToken = await readAccessToken();
    const { adAccountId } = req.params;

    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    if (!/^act_\d+$/.test(adAccountId)) {
        return res.status(400).json({
            error: "Invalid ad account ID.",
        });
    }

    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/campaigns`,
    );
    url.searchParams.set("fields", "id,name,objective,status,effective_status");

    try {
        const metaResponse = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await metaResponse.json();

        if (!metaResponse.ok) {
            console.error("Meta campaigns API error:", data);
            return res.status(metaResponse.status).json({
                error: "Meta API request failed.",
                details: data,
            });
        }

        return res.json(data);
    } catch (error) {
        console.error(
            "Failed to reach Meta API:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});

// Create a campaign. New campaigns are created in PAUSED status.
router.post("/meta/ad-accounts/:adAccountId/campaigns", async (req, res) => {
    const accessToken = await readAccessToken();
    const { adAccountId } = req.params;

    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    if (!/^act_\d+$/.test(adAccountId)) {
        return res.status(400).json({
            error: "Invalid ad account ID.",
        });
    }

    const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";

    if (!name || name.length > 100) {
        return res.status(400).json({
            error: "Campaign name is required and must be at most 100 characters.",
        });
    }

    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/campaigns`,
    );
    const params = new URLSearchParams({
        name,
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        buyingType: "AUCTION",
        special_ad_categories: "NONE",
        is_adset_budget_sharing_enabled: "false",
    });

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });
        const data = await response.json();

        if (!response.ok) {
            console.error("Meta campaign creation error:", data);
            return res.status(response.status).json({
                error: "Meta campaign creation failed.",
                details: data,
            });
        }

        return res.status(201).json(data);
    } catch (error) {
        console.error(
            "Meta API request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});

// Pause or resume a campaign.
router.post("/meta/campaigns/:campaignId/status", async (req, res) => {
    const accessToken = await readAccessToken();
    const { campaignId } = req.params;
    const { status } = req.body ?? {};

    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    if (!/^\d+$/.test(campaignId)) {
        return res.status(400).json({
            error: "Invalid campaign ID.",
        });
    }

    if (status !== "PAUSED" && status !== "ACTIVE") {
        return res.status(400).json({
            error: "Status must be PAUSED or ACTIVE.",
        });
    }

    try {
        const url = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${campaignId}`,
        );

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ status }).toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Meta campaign status error:", data);

            return res.status(response.status).json({
                error: "Failed to update campaign status.",
                details: data,
            });
        }

        return res.json({
            message: `Campaign ${status === "PAUSED" ? "paused" : "activated"} successfully.`,
            data,
        });
    } catch (error) {
        console.error(
            "Campaign status request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );

        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});

// update a comapaign. 
router.post("/meta/campaigns/:campaignId/update", async (req, res) => {
    const accessToken = await readAccessToken();
    const { campaignId } = req.params;

    // 1. Check whether the user has connected Meta.
    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    // 2. Validate the campaign ID.
    if (!/^\d+$/.test(campaignId)) {
        return res.status(400).json({
            error: "Invalid campaign ID.",
        });
    }

    // 3. Validate the new campaign name.
    const name =
        typeof req.body?.name === "string"
            ? req.body.name.trim()
            : "";

    if (!name || name.length > 100) {
        return res.status(400).json({
            error: "Campaign name is required and must be at most 100 characters.",
        });
    }

    // 4. Send the update request to Meta Graph API.
    try {
        const url = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${campaignId}`,
        );

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ name }).toString(),
        });

        const data = await response.json();

        // 5. Handle Meta API errors.
        if (!response.ok) {
            console.error("Meta campaign update error:", data);

            return res.status(response.status).json({
                error: "Meta campaign update failed.",
                details: data,
            });
        }

        // 6. Return the successful response.
        return res.json({
            message: "Campaign name updated successfully.",
            data,
        });
    } catch (error) {
        console.error(
            "Meta campaign update request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );

        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});

// Delete a campaign.
router.delete("/meta/campaigns/:campaignId", async (req, res) => {
    const accessToken = await readAccessToken();
    const { campaignId } = req.params;

    if (!accessToken) {
        return res.status(401).json({
            error: "Connect your Meta account first.",
        });
    }

    if (!/^\d+$/.test(campaignId)) {
        return res.status(400).json({
            error: "Invalid campaign ID.",
        });
    }

    try {
        const url = new URL(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${campaignId}`,
        );

        const response = await fetch(url, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Meta campaign deletion error:", data);
            return res.status(response.status).json({
                error: "Meta campaign deletion failed.",
                details: data,
            });
        }

        return res.json({
            message: "Campaign deleted successfully.",
            data,
        });
    } catch (error) {
        console.error(
            "Meta campaign deletion request failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(502).json({
            error: "Could not reach Meta Graph API.",
        });
    }
});


export default router;

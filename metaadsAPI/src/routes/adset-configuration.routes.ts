
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

const router = express.Router();

function readAccessToken(): string {
    const tokenPath = path.resolve(process.cwd(), "data/token.json");
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

    const accessToken = tokenData.access_token;

    if (!accessToken || typeof accessToken !== "string") {
        throw new Error("Access token is missing from data/token.json");
    }

    return accessToken;
}

function getGraphApiBaseUrl(): string {
    const version = process.env.META_GRAPH_API_VERSION || "v25.0";
    return `https://graph.facebook.com/${version}`;
}

async function getAdSetConfigurationFromMeta(
    adSetId: string,
    accessToken: string
) {
    const fields = [
        "id",
        "name",
        "status",
        "campaign_id",
        "optimization_goal",
        "billing_event",
        "bid_strategy",
        "bid_amount",
        "daily_budget",
        "lifetime_budget"
    ].join(",");

    const url = new URL(
        `${getGraphApiBaseUrl()}/${encodeURIComponent(adSetId)}`
    );

    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(
            data.error?.message || "Failed to retrieve Ad Set configuration"
        );
    }

    return data;
}

async function getCampaignObjectiveFromMeta(
    campaignId: string,
    accessToken: string
) {
    const url = new URL(
        `${getGraphApiBaseUrl()}/${encodeURIComponent(campaignId)}`
    );

    url.searchParams.set("fields", "id,name,objective");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
        throw new Error(
            data.error?.message || "Failed to retrieve Campaign configuration"
        );
    }

    return data;
}

router.get(
    "/meta/adsets/:adSetId/configuration",
    async (req: Request, res: Response) => {
        try {
            const adSetId: any = req.params.adSetId;

            if (!adSetId || !/^\d+$/.test(adSetId)) {
                return res.status(400).json({
                    success: false,
                    message: "A valid numeric Ad Set ID is required."
                });
            }

            const accessToken = readAccessToken();

            const adSet = await getAdSetConfigurationFromMeta(
                adSetId,
                accessToken
            );

            if (!adSet.campaign_id) {
                return res.status(502).json({
                    success: false,
                    message: "Meta did not return a Campaign ID for this Ad Set."
                });
            }

            const campaign = await getCampaignObjectiveFromMeta(
                adSet.campaign_id,
                accessToken
            );

            return res.status(200).json({
                success: true,
                adSet: {
                    id: adSet.id,
                    name: adSet.name,
                    status: adSet.status,
                    campaign_id: adSet.campaign_id,
                    daily_budget: adSet.daily_budget ?? null,
                    lifetime_budget: adSet.lifetime_budget ?? null
                },
                campaign: {
                    id: campaign.id,
                    name: campaign.name,
                    objective: campaign.objective
                },
                configuration: {
                    optimization_goal: adSet.optimization_goal,
                    billing_event: adSet.billing_event,
                    bid_strategy: adSet.bid_strategy,
                    bid_amount: adSet.bid_amount ?? null
                }
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : "An unexpected error occurred.";

            console.error("Ad Set configuration error:", message);

            return res.status(500).json({
                success: false,
                message: "Failed to retrieve Ad Set configuration.",
                error: message
            });
        }
    }
);

export default router;





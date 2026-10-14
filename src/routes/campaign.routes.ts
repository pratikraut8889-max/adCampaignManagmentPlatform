import express from 'express';
import { getAccessToken } from '../google_config.js'
const router = express.Router();
type CampaignType =
    | "SEARCH"
    | "DISPLAY"
    | "SHOPPING"
    | "VIDEO"
    | "APP"
    | "DEMAND_GEN"
    | "PERFORMANCE_MAX";

type BiddingStrategy =
    | "MANUAL_CPC"
    | "MANUAL_CPM"
    | "MAXIMIZE_CLICKS"
    | "MAXIMIZE_CONVERSIONS"
    | "MAXIMIZE_CONVERSION_VALUE"
    | "TARGET_CPA"
    | "TARGET_ROAS"
    | "APP_GOAL_BASED";

type CampaignSetupConfig = {
    label: string;
    apiChannelType: string;
    canCreateViaApi: boolean;
    campaignStructure: "AD_GROUP" | "ASSET_GROUP";
    objectives: string[];
    biddingStrategies: BiddingStrategy[];
    requiredFields: string[];
    nextStep: string;
    limitation?: string;
};

const CAMPAIGN_SETUP: Record<
    CampaignType,
    CampaignSetupConfig
> = {
    SEARCH: {
        label: "Search",
        apiChannelType: "SEARCH",
        canCreateViaApi: true,
        campaignStructure: "AD_GROUP",
        objectives: ["SALES", "LEADS", "WEBSITE_TRAFFIC"],
        biddingStrategies: [
            "MANUAL_CPC",
            "MAXIMIZE_CLICKS",
            "MAXIMIZE_CONVERSIONS",
            "MAXIMIZE_CONVERSION_VALUE",
            "TARGET_CPA",
            "TARGET_ROAS",
        ],
        requiredFields: ["budgetResourceName"],
        nextStep: "Create an ad group, keywords and a Responsive Search Ad.",
    },

    DISPLAY: {
        label: "Display",
        apiChannelType: "DISPLAY",
        canCreateViaApi: true,
        campaignStructure: "AD_GROUP",
        objectives: [
            "SALES",
            "LEADS",
            "WEBSITE_TRAFFIC",
            "AWARENESS",
        ],
        biddingStrategies: [
            "MANUAL_CPC",
            "MANUAL_CPM",
            "MAXIMIZE_CLICKS",
            "MAXIMIZE_CONVERSIONS",
            "MAXIMIZE_CONVERSION_VALUE",
            "TARGET_CPA",
            "TARGET_ROAS",
        ],
        requiredFields: ["budgetResourceName"],
        nextStep: "Create a DISPLAY_STANDARD ad group and a Responsive Display Ad.",
    },

    SHOPPING: {
        label: "Shopping",
        apiChannelType: "SHOPPING",
        canCreateViaApi: true,
        campaignStructure: "AD_GROUP",
        objectives: ["SALES"],
        biddingStrategies: [
            "MANUAL_CPC",
            "MAXIMIZE_CLICKS",
            "MAXIMIZE_CONVERSIONS",
            "MAXIMIZE_CONVERSION_VALUE",
            "TARGET_CPA",
            "TARGET_ROAS",
        ],
        requiredFields: [
            "budgetResourceName",
            "merchantCenterId",
            "campaignPriority",
        ],
        nextStep: "Create a Shopping ad group and product listing groups.",
    },

    VIDEO: {
        label: "Video",
        apiChannelType: "VIDEO",
        canCreateViaApi: false,
        campaignStructure: "AD_GROUP",
        objectives: ["AWARENESS", "CONSIDERATION"],
        biddingStrategies: [],
        requiredFields: [],
        nextStep: "Use Demand Gen or Performance Max for supported API-managed video advertising.",
        limitation:
            "Existing Video campaigns can be retrieved and reported on, but normal Video campaign creation is not supported by Google Ads API v25.",
    },

    APP: {
        label: "App",
        apiChannelType: "MULTI_CHANNEL",
        canCreateViaApi: true,
        campaignStructure: "AD_GROUP",
        objectives: [
            "APP_INSTALLS",
            "APP_ENGAGEMENT",
            "APP_PRE_REGISTRATION",
            "IN_APP_ACTIONS",
            "IN_APP_VALUE",
        ],
        biddingStrategies: ["APP_GOAL_BASED"],
        requiredFields: [
            "budgetResourceName",
            "appStore",
            "appId",
            "appFocus",
        ],
        nextStep: "Create app campaign settings, targeting and app ad assets.",
    },

    DEMAND_GEN: {
        label: "Demand Gen",
        apiChannelType: "DEMAND_GEN",
        canCreateViaApi: true,
        campaignStructure: "AD_GROUP",
        objectives: [
            "SALES",
            "LEADS",
            "WEBSITE_TRAFFIC",
            "AWARENESS",
        ],
        biddingStrategies: [
            "MAXIMIZE_CLICKS",
            "TARGET_CPA",
            "MAXIMIZE_CONVERSIONS",
            "TARGET_ROAS",
        ],
        requiredFields: ["budgetResourceName"],
        nextStep: "Create an ad group, audience targeting and Demand Gen ads.",
    },

    PERFORMANCE_MAX: {
        label: "Performance Max",
        apiChannelType: "PERFORMANCE_MAX",
        canCreateViaApi: true,
        campaignStructure: "ASSET_GROUP",
        objectives: [
            "SALES",
            "LEADS",
            "WEBSITE_TRAFFIC",
        ],
        biddingStrategies: [
            "MAXIMIZE_CONVERSIONS",
            "MAXIMIZE_CONVERSION_VALUE",
        ],
        requiredFields: ["budgetResourceName"],
        nextStep: "Create an asset group and attach required creative assets.",
    },
};

router.get(
    "/google-ads/campaigns/setup-options",
    (req, res) => {
        const rawType = String(req.query.campaignType ?? "")
            .trim()
            .toUpperCase();

        if (rawType && !(rawType in CAMPAIGN_SETUP)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaign type",
                supportedTypes: Object.keys(CAMPAIGN_SETUP),
            });
        }

        const campaignTypes = Object.entries(
            CAMPAIGN_SETUP
        ).map(([value, config]) => ({
            value,
            ...config,
        }));

        if (!rawType) {
            return res.json({
                success: true,
                campaignTypes,
            });
        }

        const config =
            CAMPAIGN_SETUP[rawType as CampaignType];

        return res.json({
            success: true,
            campaignType: rawType,
            ...config,
        });
    }
);
router.post("/google-ads/campaigns/create", async (req, res) => {
    try {
        const accessToken = await getAccessToken();

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        const campaignType = String(
            req.body.campaignType ?? "SEARCH"
        ).toUpperCase() as CampaignType;

        const setup = CAMPAIGN_SETUP[campaignType];

        if (!setup) {
            return res.status(400).json({
                success: false,
                message: "Unsupported campaign type",
                supportedTypes: Object.keys(CAMPAIGN_SETUP),
            });
        }

        if (!setup.canCreateViaApi) {
            return res.status(400).json({
                success: false,
                campaignType,
                message: setup.limitation,
                alternatives: ["DEMAND_GEN", "PERFORMANCE_MAX"],
            });
        }
        const {
            budgetResourceName,
            campaignName,
            validateOnly = true,
        } = req.body;

        if (!budgetResourceName) {
            return res.status(400).json({
                message: "Missing budgetResourceName. Create a budget first.",
            });
        }

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },
                body: JSON.stringify({
                    operations: [
                        {
                            create: {
                                name: campaignName,
                                advertisingChannelType: setup.apiChannelType,
                                status: "PAUSED",
                                campaignBudget: budgetResourceName,
                                containsEuPoliticalAdvertising:
                                    "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
                            },
                        }
                    ],
                    validateOnly,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Create campaign error:", JSON.stringify(data, null, 2));

            return res.status(response.status).json(data);
        }

        return res.json({
            message: validateOnly
                ? "Campaign request is valid. Campaign was NOT created."
                : "Campaign created successfully.",
            validateOnly,
            campaignName: name,
            budgetResourceName,
            googleResponse: data,
        });
    } catch (error) {
        console.error("Create campaign error:", error);

        return res.status(500).json({
            message:
                error instanceof Error ? error.message : "Failed to create campaign",
        });
    }
});

router.get("/google-ads/campaigns", async (_req, res) => {
    try {
        const accessToken = await getAccessToken();
        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "GOOGLE_ADS_CUSTOMER_ID is missing",
            });
        }

        const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.campaign_budget
      FROM campaign
      ORDER BY campaign.id
    `;

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },
                body: JSON.stringify({
                    query,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            capaigns: data,
        });
    } catch (error) {
        console.error("Google Ads error:", error);

        return res.status(500).json({
            message: error instanceof Error ? error.message : "Google Ads API failed",
        });
    }
});

router.get("/google-ads/campaigns/report", async (_req, res) => {
    try {
        const accessToken = await getAccessToken();
        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "GOOGLE_ADS_CUSTOMER_ID is missing",
            });
        }

        const query = `
       SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    segments.date,
    metrics.impressions,
    metrics.clicks,
    metrics.ctr,
    metrics.average_cpc,
    metrics.cost_micros,
    metrics.conversions
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
  ORDER BY metrics.cost_micros DESC
    `;

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },
                body: JSON.stringify({
                    query,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const campaigns = (data.results ?? []).map((row: any) => ({
            id: row.campaign?.id,
            name: row.campaign?.name,
            status: row.campaign?.status,

            impressions: Number(row.metrics?.impressions ?? 0),
            clicks: Number(row.metrics?.clicks ?? 0),
            ctr: Number(row.metrics?.ctr ?? 0),

            averageCpc: Number(row.metrics?.averageCpc ?? 0) / 1_000_000,

            cost: Number(row.metrics?.costMicros ?? 0) / 1_000_000,

            conversions: Number(row.metrics?.conversions ?? 0),
        }));

        return res.json({
            customerId,
            dateRange: "LAST_30_DAYS",
            campaigns,
        });
    } catch (error) {
        console.error("Google Ads error:", error);

        return res.status(500).json({
            message: error instanceof Error ? error.message : "Google Ads API failed",
        });
    }
});

router.post("/google-ads/campaigns/campaign", async (req, res) => {
    try {
        const allowedStatuses = ["ENABLED", "PAUSED", "REMOVED"];
        const { campaignId, status } = req.body;
        console.log("bpody request: ", campaignId, status);
        if (
            typeof status !== "string" ||
            !allowedStatuses.includes(status.toUpperCase())
        ) {
            return res.status(400).json({
                message: "Invalid campaign status",
                allowedStatuses,
            });
        }
        const accessToken = await getAccessToken();

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        if (!campaignId) {
            return res.status(400).json({
                message: "Missing campaignId",
            });
        }

        // Default to safe validation mode.
        const validateOnly = req.body?.validateOnly ?? true;

        const newStatus = status.toUpperCase();

        const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
            {
                method: "POST",

                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },

                body: JSON.stringify({
                    operations: [
                        {
                            updateMask: "status",
                            update: {
                                resourceName: campaignResourceName,
                                status: newStatus,
                            },
                        },
                    ],

                    validateOnly,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Google Ads pause error:", JSON.stringify(data, null, 2));

            return res.status(response.status).json(data);
        }

        return res.json({
            message: validateOnly
                ? `${newStatus} request is valid. Campaign was NOT changed.`
                : `Campaign status changed to ${newStatus} successfully`,

            validateOnly,
            customerId,
            campaignId,
            campaignResourceName,
            googleResponse: data,
        });
    } catch (error) {
        console.error("Pause campaign error:", error);

        return res.status(500).json({
            message:
                error instanceof Error ? error.message : "Failed to pause campaign",
        });
    }
});

router.post("/google-ads/campaigns/rename", async (req, res) => {
    try {
        const { campaignId, name, validateOnly = true } = req.body;

        if (!campaignId) {
            return res.status(400).json({
                message: "Missing campaignId",
            });
        }

        if (typeof name !== "string" || name.trim().length === 0) {
            return res.status(400).json({
                message: "A valid campaign name is required",
            });
        }

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        const accessToken = await getAccessToken();

        const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
                },
                body: JSON.stringify({
                    operations: [
                        {
                            updateMask: "name",
                            update: {
                                resourceName,
                                name: name.trim(),
                            },
                        },
                    ],
                    validateOnly,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Rename campaign error:", JSON.stringify(data, null, 2));

            return res.status(response.status).json(data);
        }

        return res.json({
            message: validateOnly
                ? "Rename is valid. Campaign was NOT changed."
                : "Campaign renamed successfully.",
            validateOnly,
            campaignId,
            newName: name.trim(),
            googleResponse: data,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message:
                error instanceof Error ? error.message : "Failed to rename campaign",
        });
    }
});

router.post(
    "/google-ads/campaigns/:campaignId/target-cpa",
    async (req, res) => {
        try {
            const customerId =
                process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

            const { campaignId } = req.params;
            const { targetCpa } = req.body ?? {};

            if (!customerId) {
                return res.status(400).json({
                    message: "Missing GOOGLE_ADS_CUSTOMER_ID",
                });
            }

            if (!/^\d+$/.test(campaignId)) {
                return res.status(400).json({
                    message: "Invalid campaignId",
                });
            }

            if (
                typeof targetCpa !== "number" ||
                !Number.isFinite(targetCpa) ||
                targetCpa <= 0
            ) {
                return res.status(400).json({
                    message: "targetCpa must be a positive number",
                });
            }

            const accessToken = await getAccessToken();

            const targetCpaMicros = String(
                Math.round(targetCpa * 1_000_000)
            );

            const resourceName =
                `customers/${customerId}/campaigns/${campaignId}`;

            // Safety: validation only. No live changes.
            const validateOnly = req.body.validateOnly ?? true;

            const response = await fetch(
                `https://googleads.googleapis.com/v25/customers/${customerId}/campaigns:mutate`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        operations: [
                            {
                                updateMask:
                                    "maximizeConversions.targetCpaMicros",
                                update: {
                                    resourceName,
                                    maximizeConversions: {
                                        targetCpaMicros,
                                    },
                                },
                            },
                        ],
                        validateOnly,
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json(data);
            }

            return res.json({
                message:
                    "Target CPA request validated. No changes were applied.",
                validateOnly,
                campaignId,
                targetCpa,
                targetCpaMicros,
                googleResponse: data,
            });
        } catch (error) {
            console.error("Target CPA error:", error);

            return res.status(500).json({
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to validate Target CPA",
            });
        }
    }
);

router.get(
    "/google-ads/campaigns/setup-options",
    (req, res) => {
        const rawType = String(req.query.campaignType ?? "")
            .trim()
            .toUpperCase();

        if (rawType && !(rawType in CAMPAIGN_SETUP)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaign type",
                supportedTypes: Object.keys(CAMPAIGN_SETUP),
            });
        }

        const campaignTypes = Object.entries(
            CAMPAIGN_SETUP
        ).map(([value, config]) => ({
            value,
            ...config,
        }));

        if (!rawType) {
            return res.json({
                success: true,
                campaignTypes,
            });
        }

        const config =
            CAMPAIGN_SETUP[rawType as CampaignType];

        return res.json({
            success: true,
            campaignType: rawType,
            ...config,
        });
    }
);

export default router
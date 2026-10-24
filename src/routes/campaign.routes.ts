import express from 'express';
import { getAccessToken } from '../google_config.js'
import { parseMutationMode } from "../helper/safety.js";
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



function isValidIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

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
        } = req.body;
        const mode = parseMutationMode(req.body);
        if (mode.error) {
            return res.status(400).json({ message: mode.error });
        }
        const validateOnly = mode.validateOnly;

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
            campaigns: data,
            capaigns: data, // deprecated misspelling, kept so existing clients keep working
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

        // Validation only by default; live changes need two explicit flags.
        const mode = parseMutationMode(req.body);
        if (mode.error) {
            return res.status(400).json({ message: mode.error });
        }
        const validateOnly = mode.validateOnly;

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
        const { campaignId, name } = req.body;
        const mode = parseMutationMode(req.body);
        if (mode.error) {
            return res.status(400).json({ message: mode.error });
        }
        const validateOnly = mode.validateOnly;

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

router.post("/google-ads/campaigns/:campaignId/target-cpa", async (req, res) => {
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

        // Validation only by default; live changes need two explicit flags.
        const mode = parseMutationMode(req.body);
        if (mode.error) {
            return res.status(400).json({ message: mode.error });
        }
        const validateOnly = mode.validateOnly;

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
            message: validateOnly
                ? "Target CPA request validated. No changes were applied."
                : "Target CPA updated successfully.",
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
});

// (duplicate GET /google-ads/campaigns/setup-options registration removed)

router.get("/google-ads/reports/overview", async (_req, res) => {
    try {
        const accessToken = await getAccessToken();

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(
            /-/g,
            "",
        );

        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

        if (!customerId || !developerToken) {
            return res.status(400).json({
                message:
                    "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
            });
        }

        const query = `
            SELECT
                customer.id,
                metrics.impressions,
                metrics.clicks,
                metrics.ctr,
                metrics.cost_micros,
                metrics.average_cpc,
                metrics.conversions,
                metrics.conversions_from_interactions_rate,
                metrics.cost_per_conversion,
                metrics.conversions_value
            FROM customer
            WHERE segments.date DURING LAST_30_DAYS
        `;

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": developerToken,
                },
                body: JSON.stringify({ query }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const row = data.results?.[0];

        const metrics = row?.metrics;

        const microsToCurrency = (value: unknown) =>
            Number(value ?? 0) / 1_000_000;
        const cost = Number(metrics?.costMicros ?? 0) / 1_000_000;
        const conversionValue = Number(metrics?.conversionsValue ?? 0);

        const roas = cost > 0
            ? conversionValue / cost
            : 0;
        return res.json({
            customerId,
            dateRange: "LAST_30_DAYS",
            currencyCode: row?.customer?.currencyCode ?? null,

            kpis: {
                impressions: Number(metrics?.impressions ?? 0),
                clicks: Number(metrics?.clicks ?? 0),
                ctr: Number(metrics?.ctr ?? 0),

                cost: microsToCurrency(metrics?.costMicros),
                averageCpc: microsToCurrency(metrics?.averageCpc),

                conversions: Number(metrics?.conversions ?? 0),
                conversionRate: Number(
                    metrics?.conversionsFromInteractionsRate ?? 0,
                ),

                costPerConversion: microsToCurrency(
                    metrics?.costPerConversion,
                ),

                conversionValue: Number(
                    metrics?.conversionsValue ?? 0,
                ),

                roas,
            },
        });
    } catch (error) {
        console.error("Google Ads reporting error:", error);

        return res.status(500).json({
            message:
                error instanceof Error
                    ? error.message
                    : "Google Ads reporting failed",
        });
    }
});

router.get("/google-ads/reports/daily", async (req, res) => {
    try {
        const accessToken = await getAccessToken();

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
            ?.replace(/-/g, "");

        const developerToken =
            process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

        if (!customerId || !developerToken) {
            return res.status(400).json({
                message:
                    "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
            });
        }

        // Optional date: ?date=2026-10-15
        // If omitted, use the server's local date.
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
        ].join("-");

        const reportDate =
            typeof req.query.date === "string"
                ? req.query.date
                : today;

        // Validate date format and calendar validity.
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
            new Date(`${reportDate}T00:00:00.000Z`)
                .toISOString()
                .slice(0, 10) !== reportDate
        ) {
            return res.status(400).json({
                message: "Invalid date. Use YYYY-MM-DD.",
            });
        }

        const query = `
            SELECT
                customer.id,
                customer.currency_code,
                customer.descriptive_name,
                metrics.impressions,
                metrics.clicks,
                metrics.ctr,
                metrics.cost_micros,
                metrics.average_cpc,
                metrics.conversions,
                metrics.conversions_from_interactions_rate,
                metrics.cost_per_conversion,
                metrics.conversions_value
                FROM customer
                WHERE segments.date = '${reportDate}'
                `;
        // metrics.conversions_value_per_cost

        const response = await fetch(
            `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": developerToken,
                },
                body: JSON.stringify({ query }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const row = data.results?.[0];
        const metrics = row?.metrics;

        const toNumber = (value: unknown) =>
            Number(value ?? 0);

        const microsToCurrency = (value: unknown) =>
            toNumber(value) / 1_000_000;

        const cost = microsToCurrency(metrics?.costMicros);
        const conversionValue = toNumber(metrics?.conversionsValue);

        const roas = cost > 0
            ? conversionValue / cost
            : 0;

        return res.json({
            customerId,
            reportDate,
            currencyCode: row?.customer?.currencyCode ?? null,
            kpis: {
                impressions: toNumber(metrics?.impressions),
                clicks: toNumber(metrics?.clicks),
                ctr: toNumber(metrics?.ctr),
                cost: microsToCurrency(metrics?.costMicros),
                averageCpc: microsToCurrency(metrics?.averageCpc),
                conversions: toNumber(metrics?.conversions),
                conversionRate: toNumber(
                    metrics?.conversionsFromInteractionsRate
                ),
                costPerConversion: microsToCurrency(
                    metrics?.costPerConversion
                ),
                conversionValue: toNumber(
                    metrics?.conversionsValue
                ),
                roas
            },
        });
    } catch (error) {
        console.error("Google Ads daily report error:", error);

        return res.status(500).json({
            message:
                error instanceof Error
                    ? error.message
                    : "Google Ads daily report failed",
        });
    }
});


router.get("/google-ads/reports/campaigns", async (_req, res) => {
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
  segments.date,
  campaign.id,
  campaign.name,
  campaign.status,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.cost_micros,
  metrics.average_cpc,
  metrics.conversions
FROM campaign
WHERE campaign.status != 'REMOVED'
  AND segments.date DURING LAST_7_DAYS
ORDER BY segments.date DESC
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
        console.log(
            `response data:: `, data
        );


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
            dateRange: "LAST_7_DAYS",
            campaigns,
        });
    } catch (error) {
        console.error("Google Ads error:", error);

        return res.status(500).json({
            message: error instanceof Error ? error.message : "Google Ads API failed",
        });
    }
});


router.get(
    "/google-ads/reports/campaigns/range",
    async (req, res) => {
        try {
            const accessToken = await getAccessToken();

            const customerId =
                process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

            const developerToken =
                process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

            if (!customerId || !developerToken) {
                return res.status(400).json({
                    message:
                        "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
                });
            }

            const startDate = String(req.query.startDate ?? "");
            const endDate = String(req.query.endDate ?? "");

            if (
                !isValidIsoDate(startDate) ||
                !isValidIsoDate(endDate)
            ) {
                return res.status(400).json({
                    message: "Dates must be valid YYYY-MM-DD dates",
                });
            }

            if (startDate > endDate) {
                return res.status(400).json({
                    message: "startDate must be before or equal to endDate",
                });
            }

            const baseUrl =
                `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`;

            const headers = {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "developer-token": developerToken,
            };

            // Query 1: Campaign details, without requiring performance data.
            const campaignQuery = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type
          FROM campaign
          WHERE campaign.status != 'REMOVED'
          ORDER BY campaign.id
          `;
            //   campaign.start_date,

            // Query 2: Aggregate performance for the selected date range.
            // segments.date is intentionally NOT selected, so results
            // are aggregated per campaign rather than per day.
            const performanceQuery = `
        SELECT
          campaign.id,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.conversions,
          metrics.conversions_from_interactions_rate,
          metrics.conversions_value
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      `;

            const [campaignResponse, performanceResponse] =
                await Promise.all([
                    fetch(baseUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ query: campaignQuery }),
                    }),
                    fetch(baseUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ query: performanceQuery }),
                    }),
                ]);

            const [campaignData, performanceData] =
                await Promise.all([
                    campaignResponse.json(),
                    performanceResponse.json(),
                ]);

            if (!campaignResponse.ok) {
                return res.status(campaignResponse.status).json({
                    message: "Failed to fetch campaigns",
                    details: campaignData,
                });
            }

            if (!performanceResponse.ok) {
                return res.status(performanceResponse.status).json({
                    message: "Failed to fetch campaign performance",
                    details: performanceData,
                });
            }

            const performanceByCampaign = new Map<string, any>();

            for (const row of performanceData.results ?? []) {
                const campaignId = String(row.campaign.id);
                const metrics = row.metrics ?? {};

                const cost =
                    Number(metrics.costMicros ?? 0) / 1_000_000;

                const conversionValue =
                    Number(metrics.conversionsValue ?? 0);

                performanceByCampaign.set(campaignId, {
                    impressions: Number(metrics.impressions ?? 0),
                    clicks: Number(metrics.clicks ?? 0),

                    // Google Ads returns CTR as a ratio: 0.05 = 5%.
                    ctrPercent: Number(metrics.ctr ?? 0) * 100,

                    cost,
                    averageCpc:
                        Number(metrics.averageCpc ?? 0) / 1_000_000,

                    conversions: Number(metrics.conversions ?? 0),

                    conversionRatePercent:
                        Number(
                            metrics.conversionsFromInteractionsRate ?? 0
                        ) * 100,

                    conversionValue,

                    // ROAS = conversion value / ad cost.
                    roas: cost > 0 ? conversionValue / cost : 0,
                });
            }

            const campaigns = (campaignData.results ?? []).map(
                (row: any) => {
                    const campaign = row.campaign;
                    const campaignId = String(campaign.id);

                    const performance = performanceByCampaign.get(
                        campaignId
                    );

                    return {
                        id: campaignId,
                        name: campaign.name,
                        status: campaign.status,
                        startDate: campaign.startDate,
                        advertisingChannelType:
                            campaign.advertisingChannelType,

                        // A campaign without reportable activity still appears.
                        metrics: performance ?? {
                            impressions: 0,
                            clicks: 0,
                            ctrPercent: 0,
                            cost: 0,
                            averageCpc: 0,
                            conversions: 0,
                            conversionRatePercent: 0,
                            conversionValue: 0,
                            roas: 0,
                        },
                    };
                }
            );

            return res.json({
                customerId,
                startDate,
                endDate,
                totalCampaigns: campaigns.length,
                campaigns,
            });
        } catch (error) {
            console.error("Campaign range report error:", error);

            return res.status(500).json({
                message:
                    error instanceof Error
                        ? error.message
                        : "Campaign range report failed",
            });
        }
    }
);



type ReportMetrics = {
    impressions: number;
    clicks: number;
    ctrPercent: number;
    cost: number;
    averageCpc: number;
    conversions: number;
    conversionRatePercent: number;
    costPerConversion: number;
    conversionValue: number;
    roas: number;
};


function shiftDate(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function normalizeReportMetrics(metrics: any): ReportMetrics {
    const cost = Number(metrics?.costMicros ?? 0) / 1_000_000;
    const conversionValue = Number(metrics?.conversionsValue ?? 0);

    return {
        impressions: Number(metrics?.impressions ?? 0),
        clicks: Number(metrics?.clicks ?? 0),

        // CTR is returned as a ratio, e.g. 0.05 means 5%.
        ctrPercent: Number(metrics?.ctr ?? 0) * 100,

        cost,
        averageCpc:
            Number(metrics?.averageCpc ?? 0) / 1_000_000,

        conversions: Number(metrics?.conversions ?? 0),

        conversionRatePercent:
            Number(
                metrics?.conversionsFromInteractionsRate ?? 0
            ) * 100,

        costPerConversion:
            Number(metrics?.costPerConversion ?? 0) / 1_000_000,

        conversionValue,
        roas: cost > 0 ? conversionValue / cost : 0,
    };
}

function compareMetric(current: number, previous: number) {
    return {
        current,
        previous,
        difference: current - previous,

        // Percentage change is undefined when the baseline is zero.
        changePercent:
            previous !== 0
                ? ((current - previous) / Math.abs(previous)) * 100
                : null,
    };
}

router.get(
    "/google-ads/reports/campaigns/compare",
    async (req, res) => {
        try {
            const accessToken = await getAccessToken();

            const customerId =
                process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

            const developerToken =
                process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

            if (!customerId || !developerToken) {
                return res.status(400).json({
                    message:
                        "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
                });
            }

            const startDate = String(req.query.startDate ?? "");
            const endDate = String(req.query.endDate ?? "");

            if (
                !isValidIsoDate(startDate) ||
                !isValidIsoDate(endDate)
            ) {
                return res.status(400).json({
                    message: "Provide valid startDate and endDate in YYYY-MM-DD format",
                });
            }

            if (startDate > endDate) {
                return res.status(400).json({
                    message: "startDate must be before or equal to endDate",
                });
            }

            // Calculate an immediately preceding period of equal length.
            const millisecondsPerDay = 24 * 60 * 60 * 1000;

            const numberOfDays =
                (Date.parse(`${endDate}T00:00:00.000Z`) -
                    Date.parse(`${startDate}T00:00:00.000Z`)) /
                millisecondsPerDay +
                1;

            const previousEndDate = shiftDate(startDate, -1);
            const previousStartDate = shiftDate(
                startDate,
                -numberOfDays
            );

            const baseUrl =
                `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`;

            const headers = {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "developer-token": developerToken,
            };

            // No segments.date in SELECT means metrics are aggregated
            // across the entire requested date range.
            const buildQuery = (from: string, to: string) => `
        SELECT
          customer.id,
          customer.currency_code,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.conversions,
          metrics.conversions_from_interactions_rate,
          metrics.cost_per_conversion,
          metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${from}' AND '${to}'
      `;

            const [currentResponse, previousResponse] =
                await Promise.all([
                    fetch(baseUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            query: buildQuery(startDate, endDate),
                        }),
                    }),
                    fetch(baseUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            query: buildQuery(
                                previousStartDate,
                                previousEndDate
                            ),
                        }),
                    }),
                ]);

            const [currentData, previousData] = await Promise.all([
                currentResponse.json(),
                previousResponse.json(),
            ]);

            if (!currentResponse.ok) {
                return res.status(currentResponse.status).json({
                    message: "Failed to fetch current-period metrics",
                    details: currentData,
                });
            }

            if (!previousResponse.ok) {
                return res.status(previousResponse.status).json({
                    message: "Failed to fetch previous-period metrics",
                    details: previousData,
                });
            }

            const currentRow = currentData.results?.[0];
            const previousRow = previousData.results?.[0];

            // Empty results are treated as zero metrics for comparison.
            const current = normalizeReportMetrics(
                currentRow?.metrics
            );

            const previous = normalizeReportMetrics(
                previousRow?.metrics
            );

            const metricNames: (keyof ReportMetrics)[] = [
                "impressions",
                "clicks",
                "ctrPercent",
                "cost",
                "averageCpc",
                "conversions",
                "conversionRatePercent",
                "costPerConversion",
                "conversionValue",
                "roas",
            ];

            const comparison = Object.fromEntries(
                metricNames.map((name) => [
                    name,
                    compareMetric(current[name], previous[name]),
                ])
            );

            return res.json({
                customerId,
                currencyCode:
                    currentRow?.customer?.currencyCode ??
                    previousRow?.customer?.currencyCode ??
                    null,

                currentPeriod: {
                    startDate,
                    endDate,
                    metrics: current,
                },

                previousPeriod: {
                    startDate: previousStartDate,
                    endDate: previousEndDate,
                    metrics: previous,
                },

                comparison,
            });
        } catch (error) {
            console.error("Campaign comparison report error:", error);

            return res.status(500).json({
                message:
                    error instanceof Error
                        ? error.message
                        : "Campaign comparison report failed",
            });
        }
    }
);


router.get(
    "/google-ads/reports/top-campaigns",
    async (req, res) => {
        try {
            // STEP 1: Get authentication and configuration.
            const accessToken = await getAccessToken();

            const customerId =
                process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

            const developerToken =
                process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

            if (!customerId || !developerToken) {
                return res.status(400).json({
                    message:
                        "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
                });
            }

            // STEP 2: Validate the date range.
            const startDate = String(req.query.startDate ?? "");
            const endDate = String(req.query.endDate ?? "");

            const isValidDate = (value: string): boolean => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    return false;
                }

                const date = new Date(`${value}T00:00:00.000Z`);

                return (
                    Number.isFinite(date.getTime()) &&
                    date.toISOString().slice(0, 10) === value
                );
            };

            if (!isValidDate(startDate) || !isValidDate(endDate)) {
                return res.status(400).json({
                    message:
                        "Provide valid startDate and endDate in YYYY-MM-DD format",
                });
            }

            if (startDate > endDate) {
                return res.status(400).json({
                    message: "startDate must be before or equal to endDate",
                });
            }

            // STEP 3: Validate sorting and result limit.
            const allowedSortFields = [
                "clicks",
                "conversions",
                "cost",
                "roas",
            ] as const;

            type SortField = (typeof allowedSortFields)[number];

            const requestedSort = String(req.query.sortBy ?? "conversions");

            if (
                !allowedSortFields.includes(requestedSort as SortField)
            ) {
                return res.status(400).json({
                    message: "sortBy must be clicks, conversions, cost, or roas",
                });
            }

            const sortBy = requestedSort as SortField;

            const rawLimit = String(req.query.limit ?? "10");
            const limit = Number(rawLimit);

            if (
                !/^\d+$/.test(rawLimit) ||
                !Number.isSafeInteger(limit) ||
                limit < 1 ||
                limit > 100
            ) {
                return res.status(400).json({
                    message: "limit must be an integer between 1 and 100",
                });
            }

            // STEP 4: Prepare the Google Ads API request.
            const apiUrl =
                `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`;

            const headers = {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "developer-token": developerToken,
            };

            // Query A: Fetch all non-removed campaigns.
            // This lets us include campaigns with zero activity.
            const campaignQuery = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type
        FROM campaign
        WHERE campaign.status != 'REMOVED'
        ORDER BY campaign.id
      `;

            // Query B: Fetch metrics aggregated over the date range.
            // Do not select segments.date: we want one metrics row
            // per campaign, not one row per day.
            const performanceQuery = `
        SELECT
          campaign.id,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.conversions,
          metrics.conversions_from_interactions_rate,
          metrics.cost_per_conversion,
          metrics.conversions_value
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      `;

            // STEP 5: Fetch campaign details and metrics in parallel.
            const [campaignResponse, performanceResponse] =
                await Promise.all([
                    fetch(apiUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ query: campaignQuery }),
                    }),
                    fetch(apiUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ query: performanceQuery }),
                    }),
                ]);

            const [campaignData, performanceData] =
                await Promise.all([
                    campaignResponse.json(),
                    performanceResponse.json(),
                ]);

            if (!campaignResponse.ok) {
                return res.status(campaignResponse.status).json({
                    message: "Failed to fetch campaigns",
                    details: campaignData,
                });
            }

            if (!performanceResponse.ok) {
                return res.status(performanceResponse.status).json({
                    message: "Failed to fetch campaign metrics",
                    details: performanceData,
                });
            }

            // STEP 6: Index performance metrics by campaign ID.
            const performanceMap = new Map<string, any>();

            for (const row of performanceData.results ?? []) {
                const campaignId = String(row.campaign.id);
                const raw = row.metrics ?? {};

                const cost =
                    Number(raw.costMicros ?? 0) / 1_000_000;

                const conversionValue =
                    Number(raw.conversionsValue ?? 0);

                performanceMap.set(campaignId, {
                    impressions: Number(raw.impressions ?? 0),
                    clicks: Number(raw.clicks ?? 0),
                    ctrPercent: Number(raw.ctr ?? 0) * 100,
                    cost,
                    averageCpc:
                        Number(raw.averageCpc ?? 0) / 1_000_000,
                    conversions: Number(raw.conversions ?? 0),
                    conversionRatePercent:
                        Number(
                            raw.conversionsFromInteractionsRate ?? 0
                        ) * 100,
                    costPerConversion:
                        Number(raw.costPerConversion ?? 0) / 1_000_000,
                    conversionValue,
                    roas: cost > 0 ? conversionValue / cost : 0,
                });
            }

            // STEP 7: Merge campaigns with their performance metrics.
            const campaigns = (campaignData.results ?? []).map(
                (row: any) => {
                    const campaign = row.campaign;
                    const campaignId = String(campaign.id);

                    const metrics = performanceMap.get(campaignId) ?? {
                        impressions: 0,
                        clicks: 0,
                        ctrPercent: 0,
                        cost: 0,
                        averageCpc: 0,
                        conversions: 0,
                        conversionRatePercent: 0,
                        costPerConversion: 0,
                        conversionValue: 0,
                        roas: 0,
                    };

                    return {
                        id: campaignId,
                        name: campaign.name,
                        status: campaign.status,
                        startDate: campaign.startDate,
                        advertisingChannelType:
                            campaign.advertisingChannelType,
                        metrics,
                    };
                }
            );

            // STEP 8: Rank highest to lowest by the chosen metric.
            campaigns.sort((a: any, b: any) => {
                return b.metrics[sortBy] - a.metrics[sortBy];
            });

            // STEP 9: Return only the requested number of campaigns.
            const topCampaigns = campaigns.slice(0, limit);

            return res.json({
                customerId,
                dateRange: {
                    startDate,
                    endDate,
                },
                sortBy,
                limit,
                totalCampaigns: campaigns.length,
                returnedCampaigns: topCampaigns.length,
                campaigns: topCampaigns,
            });
        } catch (error) {
            console.error("Top campaigns report error:", error);

            return res.status(500).json({
                message:
                    error instanceof Error
                        ? error.message
                        : "Top campaigns report failed",
            });
        }
    }
);



function isValidDailyReportDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function nextDailyReportDate(value: string): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

type DailyReportMetrics = {
    impressions: number;
    clicks: number;
    interactions: number;
    ctrPercent: number;
    cost: number;
    averageCpc: number;
    conversions: number;
    conversionRatePercent: number;
    costPerConversion: number;
    conversionValue: number;
    roas: number;
};

function zeroDailyMetrics(): DailyReportMetrics {
    return {
        impressions: 0,
        clicks: 0,
        interactions: 0,
        ctrPercent: 0,
        cost: 0,
        averageCpc: 0,
        conversions: 0,
        conversionRatePercent: 0,
        costPerConversion: 0,
        conversionValue: 0,
        roas: 0,
    };
}

router.get(
    "/google-ads/reports/daily-trends",
    async (req, res) => {
        try {
            // STEP 1: Authentication and configuration.
            const accessToken = await getAccessToken();

            const customerId =
                process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

            const developerToken =
                process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

            if (!customerId || !developerToken) {
                return res.status(400).json({
                    message:
                        "GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN is missing",
                });
            }

            // STEP 2: Read dates supplied by the user.
            const startDate = String(req.query.startDate ?? "");
            const endDate = String(req.query.endDate ?? "");

            if (
                !isValidDailyReportDate(startDate) ||
                !isValidDailyReportDate(endDate)
            ) {
                return res.status(400).json({
                    message:
                        "Provide valid startDate and endDate in YYYY-MM-DD format",
                });
            }

            if (startDate > endDate) {
                return res.status(400).json({
                    message: "startDate must be before or equal to endDate",
                });
            }

            // Keep this endpoint bounded to avoid unexpectedly large reports.
            const dayCount =
                (Date.parse(`${endDate}T00:00:00.000Z`) -
                    Date.parse(`${startDate}T00:00:00.000Z`)) /
                (24 * 60 * 60 * 1000) +
                1;

            if (dayCount > 366) {
                return res.status(400).json({
                    message: "The maximum supported date range is 366 days",
                });
            }

            // STEP 3: Build the GAQL query.
            // segments.date gives us one result row per date.
            const query = `
        SELECT
          customer.id,
          customer.currency_code,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.interactions,
          metrics.ctr,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.conversions,
          metrics.conversions_from_interactions_rate,
          metrics.cost_per_conversion,
          metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ORDER BY segments.date ASC
      `;

            // STEP 4: Call Google Ads API.
            const apiUrl =
                `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`;

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "developer-token": developerToken,
                },
                body: JSON.stringify({ query }),
            });

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({
                    message: "Failed to fetch daily performance trends",
                    details: data,
                });
            }

            // STEP 5: Index the returned metrics by date.
            const metricsByDate = new Map<
                string,
                DailyReportMetrics
            >();

            for (const row of data.results ?? []) {
                const date = row.segments?.date;
                const raw = row.metrics ?? {};

                if (!date) continue;

                const cost =
                    Number(raw.costMicros ?? 0) / 1_000_000;

                const conversionValue =
                    Number(raw.conversionsValue ?? 0);

                metricsByDate.set(date, {
                    impressions: Number(raw.impressions ?? 0),
                    clicks: Number(raw.clicks ?? 0),
                    interactions: Number(raw.interactions ?? 0),
                    ctrPercent: Number(raw.ctr ?? 0) * 100,
                    cost,
                    averageCpc:
                        Number(raw.averageCpc ?? 0) / 1_000_000,
                    conversions: Number(raw.conversions ?? 0),
                    conversionRatePercent:
                        Number(
                            raw.conversionsFromInteractionsRate ?? 0
                        ) * 100,
                    costPerConversion:
                        Number(raw.costPerConversion ?? 0) / 1_000_000,
                    conversionValue,
                    roas: cost > 0 ? conversionValue / cost : 0,
                });
            }

            // STEP 6: Fill missing dates with zero metrics.
            // This makes chart data continuous even when a date
            // has no reportable activity.
            const dailyRows: Array<{
                date: string;
                metrics: DailyReportMetrics;
            }> = [];

            let currentDate = startDate;

            while (currentDate <= endDate) {
                dailyRows.push({
                    date: currentDate,
                    metrics:
                        metricsByDate.get(currentDate) ??
                        zeroDailyMetrics(),
                });

                currentDate = nextDailyReportDate(currentDate);
            }

            // STEP 7: Calculate totals and overall ratios.
            const totals = dailyRows.reduce(
                (sum, row) => {
                    sum.impressions += row.metrics.impressions;
                    sum.clicks += row.metrics.clicks;
                    sum.interactions += row.metrics.interactions;
                    sum.cost += row.metrics.cost;
                    sum.conversions += row.metrics.conversions;
                    sum.conversionValue += row.metrics.conversionValue;

                    return sum;
                },
                {
                    impressions: 0,
                    clicks: 0,
                    interactions: 0,
                    cost: 0,
                    conversions: 0,
                    conversionValue: 0,
                }
            );

            const overallMetrics: DailyReportMetrics = {
                ...zeroDailyMetrics(),
                ...totals,

                ctrPercent:
                    totals.impressions > 0
                        ? (totals.clicks / totals.impressions) * 100
                        : 0,

                averageCpc:
                    totals.clicks > 0
                        ? totals.cost / totals.clicks
                        : 0,

                conversionRatePercent:
                    totals.interactions > 0
                        ? (totals.conversions / totals.interactions) * 100
                        : 0,

                costPerConversion:
                    totals.conversions > 0
                        ? totals.cost / totals.conversions
                        : 0,

                roas:
                    totals.cost > 0
                        ? totals.conversionValue / totals.cost
                        : 0,
            };

            return res.json({
                customerId,
                currencyCode:
                    data.results?.[0]?.customer?.currencyCode ?? null,
                dateRange: {
                    startDate,
                    endDate,
                    days: dayCount,
                },
                totals: overallMetrics,
                dailyRows,
            });
        } catch (error) {
            console.error("Daily trends report error:", error);

            return res.status(500).json({
                message:
                    error instanceof Error
                        ? error.message
                        : "Daily trends report failed",
            });
        }
    }
);


export default router
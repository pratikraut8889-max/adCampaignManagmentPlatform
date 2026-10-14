import express from 'express';
import { getAccessToken } from '../google_config.js'
const router = express.Router();


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

router.post("/google-ads/campaigns/create", async (req, res) => {
    try {
        const accessToken = await getAccessToken();

        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

        if (!customerId) {
            return res.status(400).json({
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        const {
            name = `SaaS Test Campaign ${Date.now()}`,
            budgetResourceName,
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
                                name,
                                advertisingChannelType: "SEARCH",
                                status: "PAUSED",
                                manualCpc: {},
                                campaignBudget: budgetResourceName,
                                networkSettings: {
                                    targetGoogleSearch: true,
                                    targetSearchNetwork: true,
                                    targetContentNetwork: false,
                                    targetPartnerSearchNetwork: false,
                                },
                                containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
                            },
                        },
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

export default router
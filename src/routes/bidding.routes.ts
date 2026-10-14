import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";

const router = Router();
const API_VERSION = "v25";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

function getCustomerId() {
    return process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
}

function getHeaders(accessToken: string) {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!developerToken) {
        throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN");
    }

    return {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "developer-token": developerToken,
    };
}

async function googleAdsPost(
    url: string,
    accessToken: string,
    body: unknown
) {
    const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(accessToken),
        body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error("Google Ads API request failed");
        Object.assign(error, {
            status: response.status,
            details: data,
        });
        throw error;
    }

    return data;
}

function handleError(res: Response, error: unknown) {
    const e = error as {
        message?: string;
        status?: number;
        details?: unknown;
    };

    return res.status(e.status ?? 500).json({
        message: e.message ?? "Request failed",
        ...(e.details !== undefined && { details: e.details }),
    });
}

function isPositiveNumber(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0
    );
}

function microsFromCurrency(value: number) {
    return String(Math.round(value * 1_000_000));
}

function validId(value: unknown): value is string {
    return typeof value === "string" && /^\d+$/.test(value);
}

function validateMutationFlag(body: any) {
    const validateOnly = body?.validateOnly !== false;

    // Real mutations require explicit confirmation.
    if (!validateOnly && body?.confirm !== true) {
        throw new Error(
            'Real changes require both "validateOnly": false and "confirm": true'
        );
    }

    return validateOnly;
}

async function mutateCampaign(
    customerId: string,
    accessToken: string,
    campaignId: string,
    update: Record<string, unknown>,
    updateMask: string,
    validateOnly: boolean
) {
    return googleAdsPost(
        `${BASE_URL}/customers/${customerId}/campaigns:mutate`,
        accessToken,
        {
            operations: [
                {
                    updateMask,
                    update: {
                        resourceName:
                            `customers/${customerId}/campaigns/${campaignId}`,
                        ...update,
                    },
                },
            ],
            validateOnly,
        }
    );
}

async function runGaql(
    customerId: string,
    accessToken: string,
    query: string
) {
    return googleAdsPost(
        `${BASE_URL}/customers/${customerId}/googleAds:search`,
        accessToken,
        { query }
    );
}


// 1. READ: Campaign bidding configuration
router.get(
    "/campaigns/:campaignId/bidding",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;

            if (!customerId) {
                return res.status(400).json({
                    message: "Missing GOOGLE_ADS_CUSTOMER_ID",
                });
            }

            if (!validId(campaignId)) {
                return res.status(400).json({
                    message: "Invalid campaignId",
                });
            }

            const token = await getAccessToken();

            const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type,
          campaign.bidding_strategy,
          campaign.campaign_budget,
          campaign.manual_cpc.enhanced_cpc_enabled,
          campaign.maximize_conversions.target_cpa_micros,
          campaign.maximize_conversion_value.target_roas,
          campaign.target_spend.cpc_bid_ceiling_micros,
          campaign.target_spend.target_spend_micros
        FROM campaign
        WHERE campaign.id = ${campaignId}
      `;

            const data = await runGaql(customerId, token, query);
            const row = data.results?.[0];

            if (!row) {
                return res.status(404).json({
                    message: "Campaign not found",
                    campaignId,
                });
            }

            return res.json({
                message: "Bidding configuration retrieved",
                customerId,
                campaign: row.campaign,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 2. MANUAL CPC: Set campaign bidding strategy
router.post(
    "/campaigns/:campaignId/bidding/manual-cpc",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    message: "Valid customerId configuration and campaignId required",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                { manualCpc: {} },
                "manualCpc",
                validateOnly
            );

            return res.json({
                message: validateOnly
                    ? "Manual CPC validated; no change applied"
                    : "Manual CPC strategy updated",
                validateOnly,
                campaignId,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 3. MAXIMIZE CLICKS: Uses TargetSpend
router.post(
    "/campaigns/:campaignId/bidding/maximize-clicks",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    message: "Valid customerId configuration and campaignId required",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const update: Record<string, unknown> = {
                targetSpend: {},
            };

            const maskParts = ["targetSpend"];

            if (req.body?.cpcBidCeiling !== undefined) {
                if (!isPositiveNumber(req.body.cpcBidCeiling)) {
                    return res.status(400).json({
                        message: "cpcBidCeiling must be a positive number",
                    });
                }

                update.targetSpend = {
                    cpcBidCeilingMicros:
                        microsFromCurrency(req.body.cpcBidCeiling),
                };

                maskParts.push("targetSpend.cpcBidCeilingMicros");
            }

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                update,
                maskParts.join(","),
                validateOnly
            );

            return res.json({
                message: validateOnly
                    ? "Maximize Clicks validated; no change applied"
                    : "Maximize Clicks strategy updated",
                validateOnly,
                campaignId,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 4. MAXIMIZE CONVERSIONS: Optional target CPA
router.post(
    "/campaigns/:campaignId/bidding/maximize-conversions",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    message: "Valid customerId configuration and campaignId required",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const update: Record<string, unknown> = {
                maximizeConversions: {},
            };

            let updateMask = "maximizeConversions";

            if (req.body?.targetCpa !== undefined) {
                if (!isPositiveNumber(req.body.targetCpa)) {
                    return res.status(400).json({
                        message: "targetCpa must be a positive number",
                    });
                }

                update.maximizeConversions = {
                    targetCpaMicros:
                        microsFromCurrency(req.body.targetCpa),
                };

                updateMask = "maximizeConversions.targetCpaMicros";
            }

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                update,
                updateMask,
                validateOnly
            );

            return res.json({
                message: validateOnly
                    ? "Maximize Conversions validated; no change applied"
                    : "Maximize Conversions strategy updated",
                validateOnly,
                campaignId,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 5. MAXIMIZE CONVERSION VALUE: Optional target ROAS
router.post(
    "/campaigns/:campaignId/bidding/maximize-conversion-value",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    message: "Valid customerId configuration and campaignId required",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const update: Record<string, unknown> = {
                maximizeConversionValue: {},
            };

            let updateMask = "maximizeConversionValue";

            if (req.body?.targetRoas !== undefined) {
                if (
                    typeof req.body.targetRoas !== "number" ||
                    !Number.isFinite(req.body.targetRoas) ||
                    req.body.targetRoas <= 0
                ) {
                    return res.status(400).json({
                        message: "targetRoas must be a positive number",
                    });
                }

                update.maximizeConversionValue = {
                    targetRoas: req.body.targetRoas,
                };

                updateMask = "maximizeConversionValue.targetRoas";
            }

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                update,
                updateMask,
                validateOnly
            );

            return res.json({
                message: validateOnly
                    ? "Maximize Conversion Value validated; no change applied"
                    : "Maximize Conversion Value strategy updated",
                validateOnly,
                campaignId,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 6. PORTFOLIO: Create a Maximize Conversions portfolio strategy
router.post(
    "/bidding/portfolio/maximize-conversions",
    async (req, res) => {
        try {
            const customerId = getCustomerId();

            if (!customerId) {
                return res.status(400).json({
                    message: "Missing GOOGLE_ADS_CUSTOMER_ID",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const strategy: Record<string, unknown> = {
                name:
                    typeof req.body?.name === "string" &&
                        req.body.name.trim()
                        ? req.body.name.trim()
                        : `SaaS Portfolio ${Date.now()}`,
                type: "MAXIMIZE_CONVERSIONS",
                maximizeConversions: {},
            };

            if (req.body?.targetCpa !== undefined) {
                if (!isPositiveNumber(req.body.targetCpa)) {
                    return res.status(400).json({
                        message: "targetCpa must be a positive number",
                    });
                }

                strategy.maximizeConversions = {
                    targetCpaMicros:
                        microsFromCurrency(req.body.targetCpa),
                };
            }

            const data = await googleAdsPost(
                `${BASE_URL}/customers/${customerId}/biddingStrategies:mutate`,
                token,
                {
                    operations: [{ create: strategy }],
                    validateOnly,
                }
            );

            return res.json({
                message: validateOnly
                    ? "Portfolio strategy validated; none created"
                    : "Portfolio strategy created",
                validateOnly,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 7. ASSIGN EXISTING PORTFOLIO STRATEGY TO A CAMPAIGN
router.post(
    "/campaigns/:campaignId/bidding/portfolio",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;
            const { strategyResourceName } = req.body ?? {};

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    message: "Valid customer configuration and campaignId required",
                });
            }

            if (
                typeof strategyResourceName !== "string" ||
                !new RegExp(
                    `^customers/${customerId}/biddingStrategies/\\d+$`
                ).test(strategyResourceName)
            ) {
                return res.status(400).json({
                    message:
                        "strategyResourceName must be a BiddingStrategy resource in this customer",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                { biddingStrategy: strategyResourceName },
                "biddingStrategy",
                validateOnly
            );

            return res.json({
                message: validateOnly
                    ? "Portfolio assignment validated; no change applied"
                    : "Portfolio strategy assigned",
                validateOnly,
                campaignId,
                strategyResourceName,
                googleResponse: data,
            });
        } catch (error) {
            return handleError(res, error);
        }
    }
);

// 8. READ-ONLY: Query a portfolio strategy
router.get("/bidding/portfolio/:strategyId", async (req, res) => {
    try {
        const customerId = getCustomerId();
        const { strategyId } = req.params;

        if (!customerId || !validId(strategyId)) {
            return res.status(400).json({
                message: "Valid customer configuration and strategyId required",
            });
        }

        const token = await getAccessToken();

        const query = `
      SELECT
        bidding_strategy.id,
        bidding_strategy.name,
        bidding_strategy.type,
        bidding_strategy.status,
        bidding_strategy.campaign_count
      FROM bidding_strategy
      WHERE bidding_strategy.id = ${strategyId}
    `;

        const data = await runGaql(customerId, token, query);

        return res.json({
            message: "Portfolio strategy retrieved",
            count: data.results?.length ?? 0,
            strategies: data.results ?? [],
        });
    } catch (error) {
        return handleError(res, error);
    }
});

export default router;
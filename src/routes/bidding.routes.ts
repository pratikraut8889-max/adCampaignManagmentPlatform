import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";
import {
    BiddingConfigurationError,
    buildBiddingConfig,
    getBiddingUpdateMask,
    type BiddingOptions,
    type BiddingStrategy,
} from "../helper/bidding.helpers.js";

const router = Router();
const API_VERSION = "v25";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

type GoogleAdsApiError = Error & {
    status?: number;
    details?: unknown;
};

type CampaignData = {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    biddingStrategyType?: string;
    biddingStrategy?: string;
    campaignBudget?: string;
};

function getCustomerId(): string | undefined {
    return process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
}

function getHeaders(accessToken: string): Record<string, string> {
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
): Promise<any> {
    const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(accessToken),
        body: JSON.stringify(body),
    });

    const text = await response.text();
    let data: any;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { rawResponse: text };
    }

    if (!response.ok) {
        const error = new Error("Google Ads API request failed") as GoogleAdsApiError;
        error.status = response.status;
        error.details = data;
        throw error;
    }

    return data;
}

function handleError(res: Response, error: unknown) {
    if (error instanceof BiddingConfigurationError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
        });
    }

    const e = error as GoogleAdsApiError;
    return res.status(e.status ?? 500).json({
        success: false,
        message: e.message ?? "Request failed",
        ...(e.details !== undefined && { details: e.details }),
    });
}

function validId(value: unknown): value is string {
    return typeof value === "string" && /^\d+$/.test(value);
}

function isPositiveNumber(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0
    );
}

function microsFromCurrency(value: number): string {
    return String(Math.round(value * 1_000_000));
}

/**
 * Mutations are validation-only by default. Real updates require the literal
 * JSON boolean values validateOnly:false and confirm:true.
 */
function validateMutationFlag(body: any): boolean {
    const validateOnly = body?.validateOnly !== false;
    if (!validateOnly && body?.confirm !== true) {
        throw new BiddingConfigurationError(
            'Real mutations require both "validateOnly": false and "confirm": true'
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
                        resourceName: `customers/${customerId}/campaigns/${campaignId}`,
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

async function getCampaignBiddingDetails(
    customerId: string,
    accessToken: string,
    campaignId: string
): Promise<CampaignData | null> {
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
      campaign.target_cpc.target_cpc_micros
    FROM campaign
    WHERE campaign.id = ${campaignId}
  `;

    const data = await runGaql(customerId, accessToken, query);
    return data.results?.[0]?.campaign ?? null;
}

async function updateCampaignBidding(
    req: Request,
    res: Response,
    fixedStrategy?: BiddingStrategy
) {
    try {
        const customerId = getCustomerId();
        const { campaignId } = req.params;

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        if (!validId(campaignId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaignId",
            });
        }

        const validateOnly = validateMutationFlag(req.body);
        const strategy = fixedStrategy ?? String(req.body?.strategy ?? "")
            .trim()
            .toUpperCase() as BiddingStrategy;

        if (!strategy) {
            return res.status(400).json({
                success: false,
                message: "Provide a bidding strategy",
                supportedStrategies: [
                    "MANUAL_CPC",
                    "MANUAL_CPM",
                    "MAXIMIZE_CLICKS",
                    "MAXIMIZE_CONVERSIONS",
                    "MAXIMIZE_CONVERSION_VALUE",
                    "TARGET_CPA",
                    "TARGET_ROAS",
                    "TARGET_CPC",
                ],
            });
        }

        const token = await getAccessToken();
        const campaign = await getCampaignBiddingDetails(
            customerId,
            token,
            campaignId
        );

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
                campaignId,
            });
        }

        const options: BiddingOptions = {};
        if (req.body?.targetCpa !== undefined) {
            if (!isPositiveNumber(req.body.targetCpa)) {
                return res.status(400).json({
                    success: false,
                    message: "targetCpa must be a positive number",
                });
            }
            options.targetCpa = req.body.targetCpa;
        }

        if (req.body?.targetRoas !== undefined) {
            if (
                typeof req.body.targetRoas !== "number" ||
                !Number.isFinite(req.body.targetRoas) ||
                req.body.targetRoas < 0.01 ||
                req.body.targetRoas > 1000
            ) {
                return res.status(400).json({
                    success: false,
                    message: "targetRoas must be between 0.01 and 1000",
                });
            }
            options.targetRoas = req.body.targetRoas;
        }

        if (req.body?.cpcBidCeiling !== undefined) {
            if (!isPositiveNumber(req.body.cpcBidCeiling)) {
                return res.status(400).json({
                    success: false,
                    message: "cpcBidCeiling must be a positive number",
                });
            }
            options.cpcBidCeiling = req.body.cpcBidCeiling;
        }

        if (req.body?.targetCpc !== undefined) {
            if (!isPositiveNumber(req.body.targetCpc)) {
                return res.status(400).json({
                    success: false,
                    message: "targetCpc must be a positive number",
                });
            }
            options.targetCpc = req.body.targetCpc;
        }

        const biddingConfig = buildBiddingConfig(
            strategy,
            options,
            campaign.advertisingChannelType
        );
        const updateMask = getBiddingUpdateMask(biddingConfig);

        const data = await mutateCampaign(
            customerId,
            token,
            campaignId,
            biddingConfig,
            updateMask,
            validateOnly
        );

        return res.status(200).json({
            success: true,
            message: validateOnly
                ? "Bidding configuration validated; no change applied"
                : "Campaign bidding strategy updated",
            validateOnly,
            customerId,
            campaignId,
            campaignType: campaign.advertisingChannelType,
            strategy,
            biddingConfig,
            googleResponse: data,
        });
    } catch (error) {
        return handleError(res, error);
    }
}

// Exported for use by your campaign-creation route.
// Example: const create = { ...baseCampaign, ...buildBiddingConfig(strategy, options, campaignType) };
export { buildBiddingConfig };

// 1. READ: Campaign bidding configuration
router.get("/campaigns/:campaignId/bidding", async (req, res) => {
    try {
        const customerId = getCustomerId();
        const { campaignId } = req.params;

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        if (!validId(campaignId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid campaignId",
            });
        }

        const token = await getAccessToken();
        const campaign = await getCampaignBiddingDetails(
            customerId,
            token,
            campaignId
        );

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
                campaignId,
            });
        }

        return res.json({
            success: true,
            message: "Bidding configuration retrieved",
            customerId,
            campaign,
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// 2. GENERIC UPDATE: lets the UI send a strategy and its options.
// POST /campaigns/:campaignId/bidding
// Body examples: { strategy: "MAXIMIZE_CONVERSIONS", targetCpa: 25, validateOnly: true }
router.post("/campaigns/:campaignId/bidding", async (req, res) => {
    await updateCampaignBidding(req, res);
});

// 3. Backwards-compatible strategy-specific endpoints.
router.post("/campaigns/:campaignId/bidding/manual-cpc", async (req, res) => {
    await updateCampaignBidding(req, res, "MANUAL_CPC");
});

router.post("/campaigns/:campaignId/bidding/manual-cpm", async (req, res) => {
    await updateCampaignBidding(req, res, "MANUAL_CPM");
});

router.post("/campaigns/:campaignId/bidding/maximize-clicks", async (req, res) => {
    await updateCampaignBidding(req, res, "MAXIMIZE_CLICKS");
});

router.post("/campaigns/:campaignId/bidding/maximize-conversions", async (req, res) => {
    await updateCampaignBidding(req, res, "MAXIMIZE_CONVERSIONS");
});

router.post(
    "/campaigns/:campaignId/bidding/maximize-conversion-value",
    async (req, res) => {
        await updateCampaignBidding(req, res, "MAXIMIZE_CONVERSION_VALUE");
    }
);

router.post("/campaigns/:campaignId/bidding/target-cpa", async (req, res) => {
    await updateCampaignBidding(req, res, "TARGET_CPA");
});

router.post("/campaigns/:campaignId/bidding/target-roas", async (req, res) => {
    await updateCampaignBidding(req, res, "TARGET_ROAS");
});

router.post("/campaigns/:campaignId/bidding/target-cpc", async (req, res) => {
    await updateCampaignBidding(req, res, "TARGET_CPC");
});

// 4. PORTFOLIO: Create a Maximize Conversions portfolio strategy.
// `type` is output-only for BiddingStrategy; set the scheme itself instead.
router.post("/bidding/portfolio/maximize-conversions", async (req, res) => {
    try {
        const customerId = getCustomerId();
        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Missing GOOGLE_ADS_CUSTOMER_ID",
            });
        }

        const validateOnly = validateMutationFlag(req.body);
        const token = await getAccessToken();
        const strategyName =
            typeof req.body?.name === "string" && req.body.name.trim()
                ? req.body.name.trim()
                : `Maximize Conversions Portfolio ${Date.now()}`;

        const strategy: Record<string, unknown> = {
            name: strategyName,
            maximizeConversions: {},
        };

        if (req.body?.targetCpa !== undefined) {
            if (!isPositiveNumber(req.body.targetCpa)) {
                return res.status(400).json({
                    success: false,
                    message: "targetCpa must be a positive number",
                });
            }
            strategy.maximizeConversions = {
                targetCpaMicros: microsFromCurrency(req.body.targetCpa),
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

        return res.status(validateOnly ? 200 : 201).json({
            success: true,
            message: validateOnly
                ? "Portfolio strategy validated; none was created"
                : "Portfolio strategy created",
            validateOnly,
            strategyName,
            googleResponse: data,
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// 5. ASSIGN AN EXISTING PORTFOLIO STRATEGY TO A CAMPAIGN.
router.post(
    "/campaigns/:campaignId/bidding/portfolio",
    async (req, res) => {
        try {
            const customerId = getCustomerId();
            const { campaignId } = req.params;
            const { strategyResourceName } = req.body ?? {};

            if (!customerId || !validId(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid customer configuration and campaignId are required",
                });
            }

            if (
                typeof strategyResourceName !== "string" ||
                !new RegExp(
                    `^customers/${customerId}/biddingStrategies/\\d+$`
                ).test(strategyResourceName)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "strategyResourceName must be a BiddingStrategy resource in this customer",
                });
            }

            const validateOnly = validateMutationFlag(req.body);
            const token = await getAccessToken();
            const campaign = await getCampaignBiddingDetails(
                customerId,
                token,
                campaignId
            );

            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    message: "Campaign not found",
                    campaignId,
                });
            }

            const data = await mutateCampaign(
                customerId,
                token,
                campaignId,
                { biddingStrategy: strategyResourceName },
                "biddingStrategy",
                validateOnly
            );

            return res.status(200).json({
                success: true,
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

// 6. READ: Query a portfolio bidding strategy.
router.get("/bidding/portfolio/:strategyId", async (req, res) => {
    try {
        const customerId = getCustomerId();
        const { strategyId } = req.params;

        if (!customerId || !validId(strategyId)) {
            return res.status(400).json({
                success: false,
                message: "Valid customer configuration and strategyId are required",
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
            success: true,
            message: "Portfolio strategy retrieved",
            count: data.results?.length ?? 0,
            strategies: data.results ?? [],
        });
    } catch (error) {
        return handleError(res, error);
    }
});

export default router;
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";

const TOKEN_FILE_PATH = path.join(process.cwd(), "data", "token.json");

type BidStrategy =
    | "LOWEST_COST_WITHOUT_CAP"
    | "COST_CAP"
    | "LOWEST_COST_WITH_BID_CAP";

function readAccessToken(): string {
    if (!fs.existsSync(TOKEN_FILE_PATH)) {
        throw new Error("Meta token file was not found.");
    }

    const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE_PATH, "utf-8"));

    if (!tokenData.access_token) {
        throw new Error("The token file does not contain access_token.");
    }

    return tokenData.access_token;
}

async function metaRequest(
    adSetId: string,
    accessToken: string,
    method: "GET" | "POST",
    params?: Record<string, string>,
) {
    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(adSetId)}`,
    );

    url.searchParams.set("access_token", accessToken);

    if (method === "GET" && params) {
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
    }

    const headers: Record<string, string> = method === "POST"
        ? {
            "Content-Type": "application/x-www-form-urlencoded",
        }
        : {};

    const body = method === "POST" && params
        ? new URLSearchParams({
            ...params,
            access_token: accessToken,
        }).toString()
        : new URLSearchParams().toString();

    const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: body,
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        const error = new Error(
            data.error?.message || "Meta API request failed.",
        ) as Error & { details?: unknown };

        error.details = data;
        throw error;
    }

    return data;
}

// GET current bidding settings
router.get(
    "/meta/adsets/:adSetId/bidding",
    async (req: Request, res: Response) => {
        try {
            const accessToken = readAccessToken();
            const { adSetId }: any = req.params;

            const data = await metaRequest(adSetId, accessToken, "GET", {
                fields:
                    "id,name,status,campaign_id,bid_strategy,bid_amount,bid_constraints,optimization_goal,billing_event",
            });

            return res.status(200).json({
                message: "Ad Set bidding settings retrieved successfully.",
                data,
            });
        } catch (error) {
            const err = error as Error & { details?: unknown };

            return res.status(500).json({
                error: "Failed to read Ad Set bidding settings.",
                message: err.message,
                details: err.details,
            });
        }
    },
);

// Update bidding settings. Ad Set must already be paused.
router.post(
    "/meta/adsets/:adSetId/bidding",
    async (req: Request, res: Response) => {
        try {
            const accessToken = readAccessToken();
            const { adSetId }: any  = req.params;

            const { bidStrategy, bidAmountRupees } = req.body as {
                bidStrategy?: BidStrategy;
                bidAmountRupees?: number;
            };

            const supportedStrategies: BidStrategy[] = [
                "LOWEST_COST_WITHOUT_CAP",
                "COST_CAP",
                "LOWEST_COST_WITH_BID_CAP",
            ];

            if (!supportedStrategies.includes(bidStrategy as BidStrategy)) {
                return res.status(400).json({
                    error: "Unsupported bidStrategy.",
                    supportedStrategies,
                });
            }

            const needsBidAmount =
                bidStrategy === "COST_CAP" ||
                bidStrategy === "LOWEST_COST_WITH_BID_CAP";

            if (needsBidAmount) {
                if (
                    typeof bidAmountRupees !== "number" ||
                    !Number.isFinite(bidAmountRupees) ||
                    bidAmountRupees <= 0 ||
                    Math.round(bidAmountRupees * 100) !== bidAmountRupees * 100
                ) {
                    return res.status(400).json({
                        error:
                            "For this strategy, provide a positive bidAmountRupees with at most 2 decimal places.",
                    });
                }
            }

            const current = await metaRequest(adSetId, accessToken, "GET", {
                fields: "id,name,status,bid_strategy,bid_amount",
            });

            if (current.status !== "PAUSED") {
                return res.status(409).json({
                    error:
                        "For learning, the Ad Set must be PAUSED before changing its bidding settings.",
                    currentStatus: current.status,
                });
            }

            const updateParams: Record<string, string> = {
                bid_strategy: bidStrategy as string,
                status: "PAUSED",
            };

            if (needsBidAmount) {
                // This project is configured for INR:
                // ₹1.00 = 100 paise.
                updateParams.bid_amount = String(
                    Math.round((bidAmountRupees as number) * 100),
                );
            }

            const data = await metaRequest(
                adSetId,
                accessToken,
                "POST",
                updateParams,
            );

            return res.status(200).json({
                message: "Bidding settings update submitted. Ad Set remains PAUSED.",
                strategyRequested: bidStrategy,
                bidAmountRupees: needsBidAmount ? bidAmountRupees : null,
                data,
            });
        } catch (error) {
            const err = error as Error & { details?: unknown };

            return res.status(400).json({
                error: "Failed to update Ad Set bidding settings.",
                message: err.message,
                details: err.details,
            });
        }
    },
);

export default router;

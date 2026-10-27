import { Router, type Request, type Response } from "express";

// Adjust this import path to your existing token helper.
import readAccessToken from "../config.js";

const router = Router();

router.get(
    "/meta/ad-accounts/:adAccountId/audiences",
    async (req: Request, res: Response) => {
        try {
            // Step 1: Validate Ad Account ID
            const adAccountId = String(
                req.params.adAccountId
            ).replace(/^act_/, "");

            if (!/^\d+$/.test(adAccountId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid Ad Account ID",
                });
            }

            // Step 2: Validate limit
            const rawLimit = req.query.limit ?? "25";

            if (
                typeof rawLimit !== "string" ||
                !/^\d+$/.test(rawLimit)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "limit must be a positive integer",
                });
            }

            const limit = Number(rawLimit);

            if (
                !Number.isSafeInteger(limit) ||
                limit < 1 ||
                limit > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message: "limit must be between 1 and 100",
                });
            }

            // Step 3: Read Meta access token
            const accessToken = await readAccessToken();

            if (!accessToken) {
                return res.status(401).json({
                    success: false,
                    message: "Meta access token not found",
                });
            }

            // Step 4: Prepare Graph API request
            const graphApiVersion =
                process.env.META_GRAPH_API_VERSION || "v25.0";

            const params = new URLSearchParams({
                fields: "id,name,description,subtype",
                limit: String(limit),
            });

            const url =
                `https://graph.facebook.com/${graphApiVersion}` +
                `/act_${adAccountId}/customaudiences?${params.toString()}`;

            // Step 5: Call Meta
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const result = await response.json();

            // Step 6: Handle API errors
            if (!response.ok) {
                return res.status(502).json({
                    success: false,
                    message:
                        result.error?.message ||
                        "Failed to retrieve Custom Audiences",
                    metaError: {
                        type: result.error?.type,
                        code: result.error?.code,
                        subcode: result.error?.error_subcode,
                        fbtraceId: result.error?.fbtrace_id,
                    },
                });
            }

            // Step 7: Return a clean response
            const audiences = result.data ?? [];

            const hasNextPage = Boolean(result.paging?.next);

            return res.status(200).json({
                success: true,
                adAccountId: `act_${adAccountId}`,
                audienceType: "custom",
                count: audiences.length,
                audiences,
                pagination: {
                    hasNextPage,
                    nextCursor: hasNextPage
                        ? result.paging?.cursors?.after ?? null
                        : null,
                },
            });
        } catch (error) {
            console.error("List Custom Audiences Error:", error);

            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    }
);

router.get(
    "/meta/ad-accounts/:adAccountId/saved-audiences",
    async (req: Request, res: Response) => {
        try {
            const adAccountId = String(
                req.params.adAccountId
            ).replace(/^act_/, "");

            if (!/^\d+$/.test(adAccountId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid Ad Account ID",
                });
            }

            const rawLimit = req.query.limit ?? "25";

            if (
                typeof rawLimit !== "string" ||
                !/^\d+$/.test(rawLimit) ||
                Number(rawLimit) < 1 ||
                Number(rawLimit) > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message: "limit must be between 1 and 100",
                });
            }

            const after = req.query.after;

            if (
                after !== undefined &&
                (typeof after !== "string" ||
                    !after.length ||
                    after.length > 2048)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid pagination cursor",
                });
            }

            const accessToken = await readAccessToken();

            if (!accessToken) {
                return res.status(401).json({
                    success: false,
                    message: "Meta access token not found",
                });
            }

            const version =
                process.env.META_GRAPH_API_VERSION || "v25.0";

            const params = new URLSearchParams({
                fields: "id,name,description,targeting",
                limit: rawLimit,
            });

            if (typeof after === "string") {
                params.set("after", after);
            }

            const url =
                `https://graph.facebook.com/${version}` +
                `/act_${adAccountId}/saved_audiences?` +
                params.toString();

            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const result = await response.json();

            if (!response.ok) {
                return res.status(502).json({
                    success: false,
                    message:
                        result.error?.message ||
                        "Failed to retrieve Saved Audiences",
                    metaError: {
                        type: result.error?.type,
                        code: result.error?.code,
                        subcode: result.error?.error_subcode,
                        fbtraceId: result.error?.fbtrace_id,
                    },
                });
            }

            const audiences = result.data ?? [];
            const hasNextPage = Boolean(result.paging?.next);

            return res.json({
                success: true,
                adAccountId: `act_${adAccountId}`,
                count: audiences.length,
                audiences,
                pagination: {
                    limit: Number(rawLimit),
                    hasNextPage,
                    nextCursor: hasNextPage
                        ? result.paging?.cursors?.after ?? null
                        : null,
                },
            });
        } catch (error) {
            console.error("List Saved Audiences Error:", error);

            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    }
);


router.get(
    "/meta/saved-audiences/:savedAudienceId",
    async (req: Request, res: Response) => {
        try {
            const savedAudienceId = String(
                req.params.savedAudienceId
            );

            if (!/^\d+$/.test(savedAudienceId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid Saved Audience ID",
                });
            }

            const accessToken = await readAccessToken();

            if (!accessToken) {
                return res.status(401).json({
                    success: false,
                    message: "Meta access token not found",
                });
            }

            const version =
                process.env.META_GRAPH_API_VERSION || "v25.0";

            const params = new URLSearchParams({
                fields: "id,name,description,targeting",
            });

            const url =
                `https://graph.facebook.com/${version}` +
                `/${savedAudienceId}?${params.toString()}`;

            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const result = await response.json();

            if (!response.ok) {
                return res.status(502).json({
                    success: false,
                    message:
                        result.error?.message ||
                        "Failed to retrieve Saved Audience",
                    metaError: {
                        type: result.error?.type,
                        code: result.error?.code,
                        subcode: result.error?.error_subcode,
                        fbtraceId: result.error?.fbtrace_id,
                    },
                });
            }

            return res.json({
                success: true,
                savedAudience: result,
            });
        } catch (error) {
            console.error("Saved Audience Details Error:", error);

            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    }
);


export default router;

import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();

const GRAPH_API_VERSION =
    process.env.META_GRAPH_API_VERSION || "v25.0";

interface MetaAdResponse {
    id?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

function readAccessToken(): string {
    const tokenPath = path.join(
        process.cwd(),
        "data",
        "token.json"
    );

    const tokenData = JSON.parse(
        fs.readFileSync(tokenPath, "utf8")
    );

    if (!tokenData.access_token) {
        throw new Error("Access token missing from token.json");
    }

    return tokenData.access_token;
}

router.post(
    "/meta/ad-accounts/:adAccountId/ads",
    async (req: Request, res: Response) => {
        try {
            const { adAccountId } = req.params;
            const { name, adSetId, creativeId } = req.body;

            // 1. Validate required fields
            if (
                typeof name !== "string" ||
                !name.trim() ||
                typeof adSetId !== "string" ||
                typeof creativeId !== "string"
            ) {
                return res.status(400).json({
                    success: false,
                    error: "name, adSetId and creativeId are required.",
                });
            }

            // 2. Validate Meta IDs
            if (
                !/^\d+$/.test(adSetId) ||
                !/^\d+$/.test(creativeId)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "adSetId and creativeId must be numeric IDs.",
                });
            }

            // 3. Normalize the ad account ID
            const normalizedAccountId = adAccountId.startsWith("act_")
                ? adAccountId
                : `act_${adAccountId}`;

            if (!/^act_\d+$/.test(normalizedAccountId)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid ad account ID.",
                });
            }

            // 4. Read the access token
            const accessToken = readAccessToken();

            // 5. Prepare the request for Meta
            const formData = new URLSearchParams();

            formData.set("access_token", accessToken);
            formData.set("name", name.trim());
            formData.set("adset_id", adSetId);
            formData.set(
                "creative",
                JSON.stringify({
                    creative_id: creativeId,
                })
            );
            formData.set("status", "PAUSED");

            // 6. Send the request to Meta
            const url =
                `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
                `${normalizedAccountId}/ads`;

            const metaResponse = await fetch(url, {
                method: "POST",
                body: formData,
            });

            const result =
                (await metaResponse.json()) as MetaAdResponse;

            // 7. Handle Meta API errors
            if (!metaResponse.ok || result.error || !result.id) {
                return res.status(502).json({
                    success: false,
                    error: result.error?.message || "Ad creation failed.",
                    metaErrorType: result.error?.type,
                    metaErrorCode: result.error?.code,
                    metaErrorSubcode: result.error?.error_subcode,
                    fbtraceId: result.error?.fbtrace_id,
                });
            }

            // 8. Return the new Ad ID
            return res.status(200).json({
                success: true,
                adId: result.id,
                status: "PAUSED",
                message: "Ad created successfully.",
            });
        } catch (error) {
            console.error("Create Ad error:", error);

            return res.status(500).json({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected server error.",
            });
        }
    }
);

export default router;

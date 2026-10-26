
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
            const { adAccountId }: any = req.params;
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


interface MetaAdDetails {
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    adset_id?: string;
    campaign_id?: string;
    creative?: {
        id?: string;
    };
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}


router.get(
    "/meta/ads/:adId",
    async (req: Request, res: Response) => {
        try {
            // 1. Read the Ad ID from the URL
            const { adId } = req.params;

            // 2. Validate the Ad ID
            if (
                typeof adId !== "string" ||
                !/^\d+$/.test(adId)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "adId must be a numeric Meta Ad ID.",
                });
            }

            // 3. Read the access token
            const accessToken = readAccessToken();

            // 4. Prepare the fields we want from Meta
            const params = new URLSearchParams();

            params.set("access_token", accessToken);
            params.set(
                "fields",
                "id,name,status,effective_status,adset_id,campaign_id,creative{id}"
            );

            // 5. Build the Meta Graph API URL
            const url =
                `https://graph.facebook.com/` +
                `${GRAPH_API_VERSION}/${adId}?${params.toString()}`;

            // 6. Send a read-only GET request to Meta
            const metaResponse = await fetch(url, {
                method: "GET",
            });

            const result =
                (await metaResponse.json()) as MetaAdDetails;

            // 7. Handle Meta API errors
            if (!metaResponse.ok || result.error || !result.id) {
                return res.status(502).json({
                    success: false,
                    error:
                        result.error?.message ||
                        "Failed to read Ad details from Meta.",
                    metaErrorType: result.error?.type,
                    metaErrorCode: result.error?.code,
                    metaErrorSubcode:
                        result.error?.error_subcode,
                    fbtraceId: result.error?.fbtrace_id,
                });
            }

            // 8. Return the Ad details
            return res.status(200).json({
                success: true,
                ad: {
                    id: result.id,
                    name: result.name,
                    status: result.status,
                    effectiveStatus: result.effective_status,
                    adSetId: result.adset_id,
                    campaignId: result.campaign_id,
                    creativeId: result.creative?.id,
                },
            });
        } catch (error) {
            console.error("Read Ad details error:", error);

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



interface MetaAdStatusCheck {
    status?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

interface MetaAdNameUpdateResponse {
    success?: boolean;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

router.post(
    "/meta/ads/:adId/name",
    async (req: Request, res: Response) => {
        try {
            // 1. Get Ad ID and new name
            const { adId } = req.params;
            const { name } = req.body;

            // 2. Validate input
            if (
                typeof adId !== "string" ||
                !/^\d+$/.test(adId)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid Meta Ad ID.",
                });
            }

            if (
                typeof name !== "string" ||
                !name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error: "A non-empty name is required.",
                });
            }

            // 3. Read the existing access token
            const accessToken = readAccessToken();

            // 4. Read the current Ad status first
            const checkParams = new URLSearchParams();
            checkParams.set("access_token", accessToken);
            checkParams.set("fields", "status");

            const baseUrl =
                `https://graph.facebook.com/` +
                `${GRAPH_API_VERSION}/${adId}`;

            const checkResponse = await fetch(
                `${baseUrl}?${checkParams.toString()}`,
                { method: "GET" }
            );

            const currentAd =
                (await checkResponse.json()) as MetaAdStatusCheck;

            if (!checkResponse.ok || currentAd.error) {
                return res.status(502).json({
                    success: false,
                    error:
                        currentAd.error?.message ||
                        "Could not check the Ad status.",
                    metaErrorCode: currentAd.error?.code,
                    metaErrorSubcode:
                        currentAd.error?.error_subcode,
                    fbtraceId: currentAd.error?.fbtrace_id,
                    updateAttempted: false,
                });
            }

            // 5. Allow name updates only for PAUSED Ads
            if (currentAd.status !== "PAUSED") {
                return res.status(409).json({
                    success: false,
                    error:
                        "For this learning route, the Ad must be PAUSED.",
                    currentStatus: currentAd.status,
                    updateAttempted: false,
                });
            }

            // 6. Prepare the update request
            const formData = new URLSearchParams();
            formData.set("access_token", accessToken);
            formData.set("name", name.trim());
            formData.set("status", "PAUSED");

            // 7. Update the Ad through Meta
            const updateResponse = await fetch(baseUrl, {
                method: "POST",
                body: formData,
            });

            const updateResult =
                (await updateResponse.json()) as MetaAdNameUpdateResponse;

            if (
                !updateResponse.ok ||
                updateResult.error ||
                updateResult.success !== true
            ) {
                return res.status(502).json({
                    success: false,
                    error:
                        updateResult.error?.message ||
                        "Meta could not update the Ad name.",
                    metaErrorCode: updateResult.error?.code,
                    metaErrorSubcode:
                        updateResult.error?.error_subcode,
                    fbtraceId: updateResult.error?.fbtrace_id,
                });
            }

            // 8. Return the result
            return res.status(200).json({
                success: true,
                adId,
                name: name.trim(),
                status: "PAUSED",
                message: "Ad name updated successfully.",
            });
        } catch (error) {
            console.error("Update Ad name error:", error);

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


interface MetaAdStatusCheck {
    status?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

interface MetaAdNameUpdateResponse {
    success?: boolean;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

router.post(
    "/meta/ads/:adId/name",
    async (req: Request, res: Response) => {
        try {
            // 1. Get Ad ID and new name
            const { adId } = req.params;
            const { name } = req.body;

            // 2. Validate input
            if (
                typeof adId !== "string" ||
                !/^\d+$/.test(adId)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid Meta Ad ID.",
                });
            }

            if (
                typeof name !== "string" ||
                !name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error: "A non-empty name is required.",
                });
            }

            // 3. Read the existing access token
            const accessToken = readAccessToken();

            // 4. Read the current Ad status first
            const checkParams = new URLSearchParams();
            checkParams.set("access_token", accessToken);
            checkParams.set("fields", "status");

            const baseUrl =
                `https://graph.facebook.com/` +
                `${GRAPH_API_VERSION}/${adId}`;

            const checkResponse = await fetch(
                `${baseUrl}?${checkParams.toString()}`,
                { method: "GET" }
            );

            const currentAd =
                (await checkResponse.json()) as MetaAdStatusCheck;

            if (!checkResponse.ok || currentAd.error) {
                return res.status(502).json({
                    success: false,
                    error:
                        currentAd.error?.message ||
                        "Could not check the Ad status.",
                    metaErrorCode: currentAd.error?.code,
                    metaErrorSubcode:
                        currentAd.error?.error_subcode,
                    fbtraceId: currentAd.error?.fbtrace_id,
                    updateAttempted: false,
                });
            }

            // 5. Allow name updates only for PAUSED Ads
            if (currentAd.status !== "PAUSED") {
                return res.status(409).json({
                    success: false,
                    error:
                        "For this learning route, the Ad must be PAUSED.",
                    currentStatus: currentAd.status,
                    updateAttempted: false,
                });
            }

            // 6. Prepare the update request
            const formData = new URLSearchParams();
            formData.set("access_token", accessToken);
            formData.set("name", name.trim());
            formData.set("status", "PAUSED");

            // 7. Update the Ad through Meta
            const updateResponse = await fetch(baseUrl, {
                method: "POST",
                body: formData,
            });

            const updateResult =
                (await updateResponse.json()) as MetaAdNameUpdateResponse;

            if (
                !updateResponse.ok ||
                updateResult.error ||
                updateResult.success !== true
            ) {
                return res.status(502).json({
                    success: false,
                    error:
                        updateResult.error?.message ||
                        "Meta could not update the Ad name.",
                    metaErrorCode: updateResult.error?.code,
                    metaErrorSubcode:
                        updateResult.error?.error_subcode,
                    fbtraceId: updateResult.error?.fbtrace_id,
                });
            }

            // 8. Return the result
            return res.status(200).json({
                success: true,
                adId,
                name: name.trim(),
                status: "PAUSED",
                message: "Ad name updated successfully.",
            });
        } catch (error) {
            console.error("Update Ad name error:", error);

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



interface MetaAdPauseStatusResponse {
    status?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

interface MetaAdPauseUpdateResponse {
    success?: boolean;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
}

router.post(
    "/meta/ads/:adId/pause",
    async (req: Request, res: Response) => {
        try {
            // 1. Read and validate the Ad ID
            const { adId } = req.params;

            if (
                typeof adId !== "string" ||
                !/^\d+$/.test(adId)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid Meta Ad ID.",
                });
            }

            // 2. Read the existing access token
            const accessToken = readAccessToken();

            const url =
                `https://graph.facebook.com/` +
                `${GRAPH_API_VERSION}/${adId}`;

            // 3. Check the current status
            const checkParams = new URLSearchParams();
            checkParams.set("access_token", accessToken);
            checkParams.set("fields", "id,status");

            const checkResponse = await fetch(
                `${url}?${checkParams.toString()}`,
                { method: "GET" }
            );

            const currentAd =
                (await checkResponse.json()) as MetaAdPauseStatusResponse;

            if (!checkResponse.ok || currentAd.error) {
                return res.status(502).json({
                    success: false,
                    error:
                        currentAd.error?.message ||
                        "Could not read the current Ad status.",
                    metaErrorCode: currentAd.error?.code,
                    metaErrorSubcode:
                        currentAd.error?.error_subcode,
                    fbtraceId: currentAd.error?.fbtrace_id,
                    pauseAttempted: false,
                });
            }

            // 4. If already paused, no update is needed
            if (currentAd.status === "PAUSED") {
                return res.status(200).json({
                    success: true,
                    adId,
                    status: "PAUSED",
                    message: "Ad is already paused.",
                });
            }

            // 5. Send only the PAUSED status to Meta
            const formData = new URLSearchParams();
            formData.set("access_token", accessToken);
            formData.set("status", "PAUSED");

            const updateResponse = await fetch(url, {
                method: "POST",
                body: formData,
            });

            const updateResult =
                (await updateResponse.json()) as MetaAdPauseUpdateResponse;

            if (
                !updateResponse.ok ||
                updateResult.error ||
                updateResult.success !== true
            ) {
                return res.status(502).json({
                    success: false,
                    error:
                        updateResult.error?.message ||
                        "Meta could not pause the Ad.",
                    metaErrorCode: updateResult.error?.code,
                    metaErrorSubcode:
                        updateResult.error?.error_subcode,
                    fbtraceId: updateResult.error?.fbtrace_id,
                });
            }

            // 6. Return the result
            return res.status(200).json({
                success: true,
                adId,
                status: "PAUSED",
                message: "Pause request succeeded.",
            });
        } catch (error) {
            console.error("Pause Ad error:", error);

            return res.status(500).json({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected server error.",
            });
        }
    });

export default router;


import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();

const GRAPH_API_VERSION =
    process.env.META_GRAPH_API_VERSION || "v25.0";

function readAccessToken(): string {
    const tokenPath = path.join(
        process.cwd(),
        "data",
        "token.json"
    );

    if (!fs.existsSync(tokenPath)) {
        throw new Error("Token file not found");
    }

    const parsed: unknown = JSON.parse(
        fs.readFileSync(tokenPath, "utf-8")
    );

    if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
    }

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Invalid token file format");
    }

    const tokenData = parsed as {
        access_token?: unknown;
        accessToken?: unknown;
        token?: unknown;
    };

    const token =
        tokenData.access_token ??
        tokenData.accessToken ??
        tokenData.token;

    if (typeof token !== "string" || !token.trim()) {
        throw new Error("Access token not found");
    }

    return token.trim();
}

interface MetaCreativeResponse {
    id?: string;
    error?: {
        message?: string;
        code?: number;
        error_subcode?: number;
    };
}

async function createAdCreativeInMeta(
    adAccountId: string,
    accessToken: string,
    pageId: string,
    imageHash: string,
    destinationUrl: string,
    message: string,
    headline: string,
    callToActionType: string
): Promise<MetaCreativeResponse> {

    const objectStorySpec = {
        page_id: pageId,
        link_data: {
            image_hash: imageHash,
            link: destinationUrl,
            message,
            name: headline,
            call_to_action: {
                type: callToActionType,
            },
        },
    };

    const formData = new URLSearchParams();

    formData.set("access_token", accessToken);
    formData.set("name", headline);
    formData.set(
        "object_story_spec",
        JSON.stringify(objectStorySpec)
    );

    const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}` +
        `/${adAccountId}/adcreatives`;

    const response = await fetch(url, {
        method: "POST",
        body: formData,
    });

    const result =
        (await response.json()) as MetaCreativeResponse;

    return result;
}

router.post(
    "/meta/ad-accounts/:adAccountId/adcreatives",
    async (req: Request, res: Response) => {
        try {
            const { adAccountId } = req.params;

            const {
                pageId,
                imageHash,
                destinationUrl,
                message,
                headline,
                callToActionType,
            } = req.body ?? {};

            if (
                !pageId ||
                !imageHash ||
                !destinationUrl ||
                !message ||
                !headline ||
                !callToActionType
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "pageId, imageHash, destinationUrl, message, headline and callToActionType are required",
                });
            }

            if (!/^\d+$/.test(String(pageId))) {
                return res.status(400).json({
                    success: false,
                    error: "pageId must be a numeric Facebook Page ID",
                });
            }

            const supportedCtas = [
                "LEARN_MORE",
                "SHOP_NOW",
                "SIGN_UP",
                "BOOK_NOW",
                "CONTACT_US",
                "GET_OFFER",
                "SUBSCRIBE",
                "DOWNLOAD",
            ];

            if (!supportedCtas.includes(callToActionType)) {
                return res.status(400).json({
                    success: false,
                    error: "Unsupported callToActionType",
                    supportedValues: supportedCtas,
                });
            }

            let parsedUrl: URL;

            try {
                parsedUrl = new URL(destinationUrl);
            } catch {
                return res.status(400).json({
                    success: false,
                    error: "destinationUrl must be a valid URL",
                });
            }

            if (parsedUrl.protocol !== "https:") {
                return res.status(400).json({
                    success: false,
                    error: "destinationUrl must use HTTPS",
                });
            }

            const validAccountId =
                /^act_\d+$/.test(adAccountId) ||
                /^\d+$/.test(adAccountId);

            if (!validAccountId) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid ad account ID",
                });
            }

            const metaAdAccountId = adAccountId.startsWith("act_")
                ? adAccountId
                : `act_${adAccountId}`;

            const accessToken = readAccessToken();

            const result = await createAdCreativeInMeta(
                metaAdAccountId,
                accessToken,
                String(pageId),
                String(imageHash),
                parsedUrl.toString(),
                String(message),
                String(headline),
                String(callToActionType)
            );

            if (result.error) {
                return res.status(502).json({
                    success: false,
                    error: result.error.message ?? "Meta request failed",
                    metaErrorType: result.error.type,
                    metaErrorCode: result.error.code,
                    metaErrorSubcode: result.error.error_subcode,
                    fbtraceId: result.error.fbtrace_id,
                });
            }

            if (!result.id) {
                return res.status(502).json({
                    success: false,
                    error: "Meta did not return a creative ID",
                });
            }

            return res.status(201).json({
                success: true,
                message: "Ad Creative created successfully",
                adAccountId: metaAdAccountId,
                creativeId: result.id,
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unexpected Ad Creative error";

            console.error("Ad Creative creation failed:", message);

            return res.status(502).json({
                success: false,
                error: message,
            });
        }
    }
);

export default router;
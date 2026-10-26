import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// Receive the image in memory; do not save it to disk.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 30 * 1024 * 1024, // 30 MB
    },
});

const GRAPH_API_VERSION =
    process.env.META_GRAPH_API_VERSION || "v25.0";

// Read the token from the existing token file.
// Supports common property names without returning the token to the client.
function readAccessToken(): string {
    const tokenPath = path.join(
        process.cwd(),
        "data",
        "token.json"
    );

    if (!fs.existsSync(tokenPath)) {
        throw new Error("Token file not found: data/token.json");
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
        throw new Error(
            "Access token not found in data/token.json"
        );
    }

    return token.trim();
}

interface MetaImageUploadResponse {
    images?: Record<
        string,
        {
            hash?: string;
            url?: string;
        }
    >;
    error?: {
        message?: string;
        code?: number;
        error_subcode?: number;
    };
}

async function uploadImageToMeta(
    adAccountId: string,
    accessToken: string,
    file: Express.Multer.File
): Promise<MetaImageUploadResponse> {
    const formData = new FormData();

    // Meta expects the uploaded file under the "filename" field.
    const imageBytes = Uint8Array.from(file.buffer);

    formData.append(
        "filename",
        new Blob([imageBytes.buffer as ArrayBuffer], {
            type: file.mimetype,
        }),
        file.originalname
    );

    formData.append("access_token", accessToken);

    const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}` +
        `/${adAccountId}/adimages`;

    const response = await fetch(url, {
        method: "POST",
        body: formData,
    });

    const result =
        (await response.json()) as MetaImageUploadResponse;

    if (!response.ok || result.error) {
        throw new Error(
            result.error?.message || "Meta image upload failed"
        );
    }

    return result;
}

// POST /meta/ad-accounts/:adAccountId/adimages
router.post(
    "/meta/ad-accounts/:adAccountId/adimages",
    upload.single("image"),
    async (req: Request, res: Response) => {
        try {
            const { adAccountId }: any = req.params;
            const file = req.file;

            if (!file) {
                return res.status(400).json({
                    success: false,
                    error: "Please upload an image using the 'image' field",
                });
            }

            const supportedTypes = [
                "image/jpeg",
                "image/png",
            ];

            if (!supportedTypes.includes(file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    error: "Only JPG and PNG images are supported",
                });
            }

            // Accept either a numeric ID or an ID starting with act_.
            const metaAdAccountId: any = adAccountId.startsWith("act_")
                ? adAccountId
                : `act_${adAccountId}`;

            const accessToken = readAccessToken();

            const result = await uploadImageToMeta(
                metaAdAccountId,
                accessToken,
                file
            );

            const uploadedImage = Object.values(
                result.images ?? {}
            )[0];

            if (!uploadedImage?.hash) {
                return res.status(502).json({
                    success: false,
                    error: "Meta did not return an image hash",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Image uploaded to Meta successfully",
                adAccountId: metaAdAccountId,
                imageHash: uploadedImage.hash,
                imageUrl: uploadedImage.url ?? null,
                fileName: file.originalname,
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unexpected image upload error";

            console.error("Ad image upload failed:", message);

            return res.status(502).json({
                success: false,
                error: message,
            });
        }
    }
);

export default router;
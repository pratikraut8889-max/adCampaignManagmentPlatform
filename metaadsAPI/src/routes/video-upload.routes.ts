
import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

const router = Router();

const upload = multer({
    dest: path.join(process.cwd(), "tmp"),
    limits: {
        fileSize: 100 * 1024 * 1024, // Example: 100 MB local limit
    },
});

const GRAPH_API_VERSION =
    process.env.META_GRAPH_API_VERSION || "v25.0";

interface MetaVideoResponse {
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

    // Adjust this property if your token.json uses another shape.
    if (!tokenData.access_token) {
        throw new Error("Access token missing from token.json");
    }

    return tokenData.access_token;
}

router.post(
    "/meta/ad-accounts/:adAccountId/advideos",
    upload.single("video"),
    async (req: Request, res: Response) => {
        let tempFilePath: string | undefined;

        try {
            const { adAccountId }: any = req.params;
            const video = req.file;

            tempFilePath = video?.path;

            if (!video) {
                return res.status(400).json({
                    success: false,
                    error: 'Video file is required in form field "video".',
                });
            }

            if (
                !video.mimetype.startsWith("video/")
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Please upload a video file.",
                });
            }

            const accessToken = readAccessToken();

            const normalizedAccountId = adAccountId.startsWith("act_")
                ? adAccountId
                : `act_${adAccountId}`;

            const formData = new FormData();

            formData.set("access_token", accessToken);

            const videoBytes = fs.readFileSync(video.path);

            formData.set(
                "source",
                new Blob([videoBytes], { type: video.mimetype }),
                video.originalname
            );

            const url =
                `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
                `${normalizedAccountId}/advideos`;

            const metaResponse = await fetch(url, {
                method: "POST",
                body: formData,
            });

            const result =
                (await metaResponse.json()) as MetaVideoResponse;

            if (!metaResponse.ok || result.error || !result.id) {
                return res.status(502).json({
                    success: false,
                    error: result.error?.message || "Video upload failed",
                    metaErrorType: result.error?.type,
                    metaErrorCode: result.error?.code,
                    metaErrorSubcode: result.error?.error_subcode,
                    fbtraceId: result.error?.fbtrace_id,
                });
            }

            return res.status(200).json({
                success: true,
                videoId: result.id,
                message: "Meta accepted the video upload request.",
            });
        } catch (error) {
            console.error("Video upload error:", error);

            return res.status(500).json({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Unexpected server error",
            });
        } finally {
            if (tempFilePath) {
                fs.promises.unlink(tempFilePath).catch(() => { });
            }
        }
    }
);

router.get(
    "/meta/videos/:videoId/status",
    async (req: Request, res: Response) => {
        try {
            const { videoId }: any = req.params;

            if (!/^\d+$/.test(videoId)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid video ID.",
                });
            }

            const accessToken = readAccessToken();

            const params = new URLSearchParams({
                fields: "id,status",
                access_token: accessToken,
            });

            const url =
                `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
                `${videoId}?${params.toString()}`;

            const metaResponse = await fetch(url);
            const result = await metaResponse.json();

            if (!metaResponse.ok || result.error) {
                return res.status(502).json({
                    success: false,
                    error: result.error?.message || "Could not read video status.",
                    metaErrorCode: result.error?.code,
                    metaErrorSubcode: result.error?.error_subcode,
                });
            }

            return res.status(200).json({
                success: true,
                video: result,
            });
        } catch (error) {
            console.error("Video status error:", error);

            return res.status(500).json({
                success: false,
                error: "Unexpected server error.",
            });
        }
    }
);


export default router;

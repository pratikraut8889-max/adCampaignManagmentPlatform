import { Router } from "express";
import {
  getGoogleAdsConfig,
  getErrorMessage,
  googleAdsRequest,
  GOOGLE_ADS_BASE_URL,
  buildAssetCreate,
  AssetValidationError,
  createGoogleAdsVideoAsset,
  createAssetAssociation
} from "../helper/shared.js";
import { getAccessToken, youtube } from "../google_config.js";
import { imageSize } from "image-size";
import { Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";

const router = Router();
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200 MB for learning

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },

  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPG and PNG images are supported"));
    }

    cb(null, true);
  },
});

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, callback) => {
      callback(
        null,
        `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`
      );
    },
  }),
  limits: {
    fileSize: MAX_VIDEO_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("video/")) {
      return callback(new Error("Please select a video file"));
    }

    callback(null, true);
  },
});

// Assets Manangement 
router.post("/assets", async (req, res) => {
  try {
    const type = String(req.body.type ?? "").toUpperCase();
    const input = req.body.asset;

    const allowedTypes = [
      "SITELINK",
      "CALLOUT",
      "STRUCTURED_SNIPPET",
      "CALL",
      "IMAGE",
      "BUSINESS_NAME",
      "BUSINESS_LOGO",
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported asset type",
        allowedTypes,
      });
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return res.status(400).json({
        success: false,
        message: "asset must be an object",
      });
    }

    const validateOnly = req.body.validateOnly !== false;

    if (!validateOnly && req.body.confirm !== true) {
      return res.status(400).json({
        success: false,
        message: "Set confirm: true for live creation",
      });
    }

    const create = buildAssetCreate(type, input);

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);
    if (!config) return;

    const { customerId, developerToken } = config;

    const rawResponse: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/assets:mutate`,
      accessToken,
      developerToken,
      {
        operations: [{ create }],
        validateOnly,
      }
    );

    const apiData =
      rawResponse?.data?.data ??
      rawResponse?.data ??
      rawResponse;

    return res.status(200).json({
      success: true,
      type,
      validateOnly,
      results: apiData?.results ?? [],
    });
  } catch (error) {
    if (error instanceof AssetValidationError) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});
router.get("/assets", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const { customerId, developerToken } = config;

    const type = req.query.type?.toString().toUpperCase();

    const allowedTypes = [
      "TEXT",
      "SITELINK",
      "CALLOUT",
      "STRUCTURED_SNIPPET",
      "CALL",
      "IMAGE",
      "YOUTUBE_VIDEO"

    ];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset type",
        allowedTypes,
      });
    }

    let query = `
  SELECT
    asset.id,
    asset.name,
    asset.resource_name,
    asset.type,
    asset.text_asset.text,
    asset.sitelink_asset.link_text,
    asset.sitelink_asset.description1,
    asset.sitelink_asset.description2,
    asset.callout_asset.callout_text,
    asset.structured_snippet_asset.header,
    asset.structured_snippet_asset.values,
    asset.call_asset.phone_number,
    asset.image_asset.file_size,
    asset.image_asset.mime_type,
    asset.image_asset.full_size.width_pixels,
    asset.image_asset.full_size.height_pixels
    FROM asset
`;

    if (type) {
      query += ` WHERE asset.type = '${type}'`;
    }

    const responseData: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
      accessToken,
      developerToken,
      { query },
    );


    // Your helper wraps Google's response under "data".
    const rows = responseData?.data?.results ?? [];

    const assets = rows.map((row: any) => row.asset).filter(Boolean);

    return res.status(200).json({
      success: true,
      total: assets.length,
      assets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});
router.get("/assets/:assetId", async (req, res) => {
  try {
    const { assetId } = req.params;

    if (!/^\d+$/.test(assetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID",
      });
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const { customerId, developerToken } = config;

    // 1. Retrieve the asset itself
    const assetQuery = `
      SELECT
        asset.id,
        asset.name,
        asset.resource_name,
        asset.type
      FROM asset
      WHERE asset.id = ${assetId}
    `;

    const assetResponse: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
      accessToken,
      developerToken,
      { query: assetQuery }
    );

    const assetResults = assetResponse?.data?.results ?? [];
    const asset = assetResults[0]?.asset;

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    const assetResourceName =
      asset.resourceName ??
      `customers/${customerId}/assets/${assetId}`;

    // 2. Retrieve ad group associations and their statuses
    const adGroupQuery = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group_asset.asset,
        ad_group_asset.field_type,
        ad_group_asset.status,
        ad_group_asset.primary_status
      FROM ad_group_asset
      WHERE ad_group_asset.asset = '${assetResourceName}'
    `;

    // 3. Retrieve campaign associations and their statuses
    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign_asset.asset,
        campaign_asset.field_type,
        campaign_asset.status,
        campaign_asset.primary_status
      FROM campaign_asset
      WHERE campaign_asset.asset = '${assetResourceName}'
    `;

    const assetGroupQuery = `
  SELECT
    asset_group.id,
    asset_group.name,
    asset_group_asset.asset,
    asset_group_asset.field_type,
    asset_group_asset.status,
    asset_group_asset.primary_status
  FROM asset_group_asset
  WHERE asset_group_asset.asset = '${assetResourceName}'
`;

    const [
      adGroupResponse,
      campaignResponse,
      assetGroupResponse,
    ]: any = await Promise.all([
      googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query: adGroupQuery }
      ),
      googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query: campaignQuery }
      ),
      googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query: assetGroupQuery }
      ),
    ]);
    const adGroupResults =
      adGroupResponse?.data?.results ?? [];

    const campaignResults =
      campaignResponse?.data?.results ?? [];
    const assetGroupResults =
      assetGroupResponse?.data?.results ?? [];

    return res.status(200).json({
      success: true,
      asset,
      associations: {
        adGroups: adGroupResults.map((row: any) => ({
          adGroup: row.adGroup,
          fieldType: row.adGroupAsset.fieldType,
          status: row.adGroupAsset.status,
          primaryStatus: row.adGroupAsset.primaryStatus,
        })),
        campaigns: campaignResults.map((row: any) => ({
          campaign: row.campaign,
          fieldType: row.campaignAsset.fieldType,
          status: row.campaignAsset.status,
          primaryStatus: row.campaignAsset.primaryStatus,
        })),
        assetGroups: assetGroupResults.map((row: any) => ({
          assetGroup: row.assetGroup,
          fieldType: row.assetGroupAsset.fieldType,
          status: row.assetGroupAsset.status,
          primaryStatus: row.assetGroupAsset.primaryStatus,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

router.post("/images/upload", (req, res, next) => {
  imageUpload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    next();
  });
},

  async (req, res) => {
    try {
      const file = req.file;
      console.log("Content-Type:", req.headers["content-type"]);
      console.log("Uploaded file:", req.file);
      console.log("Body fields:", req.body);

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Please upload an image using the 'image' field",
        });
      }

      // Read and verify the actual image
      let dimensions: ReturnType<typeof imageSize>;

      try {
        dimensions = imageSize(file.buffer);
      } catch {
        return res.status(400).json({
          success: false,
          message: "The uploaded file is not a valid image",
        });
      }

      const { width, height, type } = dimensions;

      if (
        !width ||
        !height ||
        !["jpg", "png"].includes(type ?? "")
      ) {
        return res.status(400).json({
          success: false,
          message: "Only valid JPG and PNG images are supported",
        });
      }

      const mimeType =
        type === "jpg" ? "IMAGE_JPEG" : "IMAGE_PNG";

      // Google Ads asset names should be descriptive and unique
      const suppliedName =
        typeof req.body?.name === "string"
          ? req.body.name.trim()
          : "";

      const originalName = file.originalname.replace(
        /\.[^/.]+$/,
        ""
      );

      const cleanName = (
        suppliedName || originalName || "Uploaded Image"
      )
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .slice(0, 60) || "Uploaded Image";

      const assetName = `${cleanName} ${Date.now()}`;

      // Safe by default: validate without creating the asset
      const validateOnly =
        String(req.body?.validateOnly).toLowerCase() !== "false";

      const confirm =
        String(req.body?.confirm).toLowerCase() === "true";

      if (!validateOnly && !confirm) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live asset creation",
        });
      }

      const accessToken = await getAccessToken();

      const config = getGoogleAdsConfig(res);
      if (!config) return;

      const { customerId, developerToken } = config;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/assets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              create: {
                name: assetName,
                imageAsset: {
                  data: file.buffer.toString("base64"),
                  fileSize: String(file.size),
                  mimeType,
                  fullSize: {
                    heightPixels: String(height),
                    widthPixels: String(width),
                  },
                },
              },
            },
          ],
          validateOnly,
        }
      );

      const data =
        response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly,
        message: validateOnly
          ? "Image asset validation passed; asset not created"
          : "Image asset created successfully",
        results: data?.results ?? [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

router.post("/videos/upload", videoUpload.single("video"), async (req: Request, res: Response) => {
  let tempFilePath: string | undefined;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Select a video using the "video" form-data field',
      });
    }

    tempFilePath = req.file.path;

    const videoTitle =
      String(req.body.videoTitle || "").trim() ||
      path.parse(req.file.originalname).name;

    const videoDescription =
      String(req.body.videoDescription || "").trim();

    if (videoTitle.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Video title must not exceed 100 characters",
      });
    }

    if (videoDescription.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Video description must not exceed 5000 characters",
      });
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const customerId = String(config.customerId).replace(/-/g, "");
    const { developerToken } = config;

    const fileSize = req.file.size;

    // 1. Initiate the resumable upload session.
    const startUrl =
      `https://googleads.googleapis.com/resumable/upload/v25/` +
      `customers/${customerId}/youTubeVideoUploads:create`;

    const startResponse = await fetch(startUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
      },
      body: JSON.stringify({
        customer_id: customerId,
        you_tube_video_upload: {
          video_title: videoTitle,
          video_description: videoDescription,
          video_privacy: "UNLISTED",
        },
      }),
    });

    const startText = await startResponse.text();

    if (!startResponse.ok) {
      return res.status(502).json({
        success: false,
        step: "initiate_upload",
        message: "Google Ads could not initiate the video upload",
        details: parseGoogleResponse(startText),
      });
    }

    const uploadUrl =
      startResponse.headers.get("x-goog-upload-url");

    if (!uploadUrl) {
      return res.status(502).json({
        success: false,
        message: "Google Ads did not return an upload URL",
      });
    }

    // The upload URL comes from Google. Require HTTPS.
    if (new URL(uploadUrl).protocol !== "https:") {
      return res.status(502).json({
        success: false,
        message: "Google returned an invalid upload URL",
      });
    }

    // 2. Stream the local video file and finalize the upload.
    const videoStream = createReadStream(tempFilePath);

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(fileSize),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: videoStream as any,
      duplex: "half",
    } as RequestInit);

    const uploadText = await uploadResponse.text();

    if (!uploadResponse.ok) {
      return res.status(502).json({
        success: false,
        step: "upload_video",
        message: "Google Ads video upload failed",
        details: parseGoogleResponse(uploadText),
      });
    }

    const result = parseGoogleResponse(uploadText) as {
      resourceName?: string;
    };

    if (
      !result ||
      typeof result !== "object" ||
      !result.resourceName
    ) {
      return res.status(502).json({
        success: false,
        message: "Upload completed without a resource name",
        details: result,
      });
    }

    // 3. Return the upload resource for status checking.
    return res.status(201).json({
      success: true,
      message: "Video uploaded; processing may still be in progress",
      uploadResourceName: result.resourceName,
      videoTitle,
      fileSize,
      nextStep: "Check YouTube video upload state using GAQL",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  } finally {
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => undefined);
    }
  }
}
);

router.get(
  "/videos/upload-status/:uploadId",
  async (req, res) => {
    try {
      const { uploadId } = req.params;
      const createAsset = req.query.createAsset === "true";

      if (!/^\d+$/.test(uploadId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid upload ID",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const customerId = String(config.customerId).replace(/-/g, "");
      const { developerToken } = config;

      const resourceName =
        `customers/${customerId}/youTubeVideoUploads/${uploadId}`;

      const query = `
        SELECT
          you_tube_video_upload.resource_name,
          you_tube_video_upload.video_id,
          you_tube_video_upload.state
        FROM you_tube_video_upload
        WHERE you_tube_video_upload.resource_name = '${resourceName}'
      `;

      const rawResponse: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query }
      );

      const googleData =
        rawResponse?.data?.data ??
        rawResponse?.data ??
        rawResponse;

      if (googleData?.error) {
        return res.status(502).json({
          success: false,
          message: googleData.error.message,
          details: googleData.error.details ?? [],
        });
      }

      const result = googleData?.results?.[0];
      const videoUpload = result?.youTubeVideoUpload;

      if (!videoUpload) {
        return res.status(404).json({
          success: false,
          message: "Video upload resource was not found",
          resourceName,
        });
      }

      const state = videoUpload.state;
      const videoId = videoUpload.videoId || null;

      if (state !== "PROCESSED") {
        return res.status(200).json({
          success: true,
          resourceName: videoUpload.resourceName,
          videoId,
          state,
          readyToCreateAsset: false,
          message: "Google Ads video upload is not processed yet",
        });
      }

      // Status-only request: do not create an asset.
      if (!createAsset) {
        return res.status(200).json({
          success: true,
          resourceName: videoUpload.resourceName,
          videoId,
          state,
          readyToCreateAsset: true,
          message: "Video is processed and ready for asset creation",
        });
      }

      if (!videoId) {
        return res.status(422).json({
          success: false,
          message: "Processed upload has no video ID",
        });
      }

      // IMPORTANT:
      // Use the actual YouTube title, not the upload resource ID.
      const videoTitle = String(req.query.videoTitle ?? "").trim();

      if (!videoTitle) {
        return res.status(400).json({
          success: false,
          message: "Provide videoTitle when createAsset=true",
        });
      }

      const asset = await createGoogleAdsVideoAsset({
        customerId,
        accessToken,
        developerToken,
        videoId,
        videoTitle,
        assetName: videoTitle,
      });

      return res.status(201).json({
        success: true,
        message: "Video processed and Google Ads asset created",
        resourceName: videoUpload.resourceName,
        state,
        videoId,
        readyToCreateAsset: true,
        asset,
      });
    } catch (error) {
      console.error("Video upload status check failed:", error);

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);
router.post(
  "/youtube/videos/upload",
  videoUpload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select a video file",
        });
      }

      const title =
        String(req.body.videoTitle || "").trim() ||
        req.file.originalname;

      const description =
        String(req.body.videoDescription || "").trim();

      // Uploads publish to a real YouTube channel and have no validate-only
      // mode, so they need an explicit confirmation. Form fields arrive as
      // strings, so accept "true" as well as true.
      const confirmed =
        req.body.confirm === true || req.body.confirm === "true";

      if (!confirmed) {
        await unlink(req.file.path).catch(() => undefined);

        return res.status(400).json({
          success: false,
          message:
            "Uploading creates a real YouTube video. Send confirm=true to continue.",
        });
      }

      // Default to private. Only publish publicly when asked.
      const requestedPrivacy = String(req.body.privacyStatus || "private");
      const privacyStatus = ["private", "unlisted", "public"].includes(
        requestedPrivacy,
      )
        ? requestedPrivacy
        : "private";

      const response = await youtube.videos.insert({
        part: ["snippet", "status"],

        requestBody: {
          snippet: {
            title,
            description,
          },

          status: {
            privacyStatus,
          },
        },

        media: {
          body: createReadStream(req.file.path),
        },
      });

      const videoId = response.data.id;

      if (!videoId) {
        return res.status(502).json({
          success: false,
          message: "YouTube did not return a video ID",
        });
      }

      // Step 1: Check video processing status.
      const statusResponse = await youtube.videos.list({
        part: ["status", "processingDetails"],
        id: videoId,
      });

      const uploadedVideo = statusResponse.data.items?.[0];

      const processingStatus =
        uploadedVideo?.processingDetails?.processingStatus;

      // Step 2: Handle failed processing.
      if (
        processingStatus === "failed" ||
        processingStatus === "terminated"
      ) {
        return res.status(502).json({
          success: false,
          videoUploaded: true,
          googleAdsAssetCreated: false,
          videoId,
          processingStatus,
          message: "YouTube video processing failed",
        });
      }

      // Step 3: Do NOT create the asset until processing succeeds.
      if (processingStatus !== "succeeded") {
        return res.status(202).json({
          success: true,
          videoUploaded: true,
          googleAdsAssetCreated: false,
          message:
            "Video uploaded. Wait until YouTube processing completes.",
          video: {
            videoId,
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          },
          processingStatus: processingStatus ?? "unknown",
        });
      }

      // Step 4: Processing succeeded. Create the Google Ads asset.
      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const asset = await createGoogleAdsVideoAsset({
        customerId: String(config.customerId).replace(/-/g, ""),
        accessToken,
        developerToken: config.developerToken,
        videoId,
        videoTitle: title,
        assetName: title,
      });

      // Step 5: Return both results.
      return res.status(201).json({
        success: true,
        message: "YouTube video uploaded and Google Ads asset created",
        videoUploaded: true,
        googleAdsAssetCreated: true,
        video: {
          videoId,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          privacyStatus: response.data.status?.privacyStatus,
          processingStatus,
        },
        asset,
      });
    } catch (error) {
      console.error("YouTube upload failed:", error);

      return res.status(500).json({
        success: false,
        message: "YouTube video upload failed",
      });
    }
  }
);
router.post("/assets/associations/campaign", (req, res) =>
  createAssetAssociation(req, res, "campaign")
);

router.post("/assets/associations/ad-group", (req, res) =>
  createAssetAssociation(req, res, "adGroup")
);

router.post("/assets/associations/asset-group", (req, res) =>
  createAssetAssociation(req, res, "assetGroup")
);

function parseGoogleResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}


const ASSOCIATION_LIST_QUERIES = {
  campaign: (id: string) => `
    SELECT
      campaign.id,
      campaign.name,
      campaign_asset.resource_name,
      campaign_asset.asset,
      campaign_asset.field_type,
      campaign_asset.status,
      campaign_asset.primary_status,
      asset.id,
      asset.name,
      asset.type
    FROM campaign_asset
    WHERE campaign.id = ${id}
  `,

  adGroup: (id: string) => `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group_asset.resource_name,
      ad_group_asset.asset,
      ad_group_asset.field_type,
      ad_group_asset.status,
      ad_group_asset.primary_status,
      asset.id,
      asset.name,
      asset.type
    FROM ad_group_asset
    WHERE ad_group.id = ${id}
  `,

  assetGroup: (id: string) => `
    SELECT
      asset_group.id,
      asset_group.name,
      asset_group_asset.resource_name,
      asset_group_asset.asset,
      asset_group_asset.field_type,
      asset_group_asset.status,
      asset_group_asset.primary_status,
      asset.id,
      asset.name,
      asset.type
    FROM asset_group_asset
    WHERE asset_group.id = ${id}
  `,
};

router.get(
  "/assets/associations/:level/:targetId",
  async (req, res) => {
    try {
      const level = req.params.level as
        | "campaign"
        | "adGroup"
        | "assetGroup";

      const { targetId } = req.params;

      if (!/^\d+$/.test(targetId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid target ID",
        });
      }

      if (!(level in ASSOCIATION_LIST_QUERIES)) {
        return res.status(400).json({
          success: false,
          message: "Invalid association level",
          allowedLevels: [
            "campaign",
            "adGroup",
            "assetGroup",
          ],
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const customerId = String(config.customerId).replace(
        /-/g,
        ""
      );

      const query = ASSOCIATION_LIST_QUERIES[level](targetId);

      const raw: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        config.developerToken,
        { query }
      );

      const rows =
        raw?.data?.results ??
        raw?.data?.data?.results ??
        raw?.results ??
        [];

      const relationKey = {
        campaign: "campaignAsset",
        adGroup: "adGroupAsset",
        assetGroup: "assetGroupAsset",
      }[level];

      return res.status(200).json({
        success: true,
        level,
        targetId,
        total: rows.length,
        associations: rows.map((row: any) => {
          const relation = row[relationKey];

          return {
            resourceName: relation?.resourceName,
            target:
              row.campaign ??
              row.adGroup ??
              row.assetGroup,
            asset: row.asset,
            fieldType: relation?.fieldType,
            status: relation?.status,
            primaryStatus: relation?.primaryStatus,
          };
        }),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

const ASSOCIATION_SERVICES = {
  campaign: {
    service: "campaignAssets",
    resource: "campaignAssets",
    idKey: "campaignId",
  },
  adGroup: {
    service: "adGroupAssets",
    resource: "adGroupAssets",
    idKey: "adGroupId",
  },
  assetGroup: {
    service: "assetGroupAssets",
    resource: "assetGroupAssets",
    idKey: "assetGroupId",
  },
} as const;



router.patch(
  "/assets/associations/status",
  async (req, res) => {
    try {
      const {
        level,
        targetId,
        assetId,
        fieldType,
        status,
      } = req.body;

      if (
        !["campaign", "adGroup", "assetGroup"].includes(level)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid association level",
        });
      }

      if (
        !/^\d+$/.test(String(targetId ?? "")) ||
        !/^\d+$/.test(String(assetId ?? ""))
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid targetId and assetId are required",
        });
      }

      if (!["ENABLED", "PAUSED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "status must be ENABLED or PAUSED",
        });
      }

      const validateOnly =
        String(req.body.validateOnly ?? "true").toLowerCase()
        !== "false";

      const confirm =
        req.body.confirm === true ||
        String(req.body.confirm ?? "").toLowerCase() === "true";

      if (!validateOnly && !confirm) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live updates",
        });
      }

      const associationConfig =
        ASSOCIATION_SERVICES[
        level as keyof typeof ASSOCIATION_SERVICES
        ];

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const customerId = String(config.customerId).replace(
        /-/g,
        ""
      );

      const resourceName =
        `customers/${customerId}/` +
        `${associationConfig.resource}/` +
        `${targetId}~${assetId}~${fieldType}`;

      const raw: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/` +
        `${associationConfig.service}:mutate`,
        accessToken,
        config.developerToken,
        {
          operations: [
            {
              update: {
                resourceName,
                status,
              },
              updateMask: "status",
            },
          ],
          validateOnly,
        }
      );

      // Do not treat a nested Google Ads API error as success.
      const googleError =
        raw?.data?.data?.error ??
        raw?.data?.error ??
        raw?.error ??
        raw?.data?.results?.data?.error;

      if (googleError) {
        return res.status(502).json({
          success: false,
          message:
            googleError.message ??
            "Google Ads association update failed",
          details: googleError.details ?? [],
        });
      }

      return res.status(validateOnly ? 200 : 200).json({
        success: true,
        resourceName,
        status,
        validateOnly,
        message: validateOnly
          ? "Validation passed; status was not changed"
          : "Association status updated",
        googleResponse: raw?.data?.data ?? raw?.data ?? raw,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

router.post(
  "/assets/associations/remove",
  async (req, res) => {
    try {
      const {
        level,
        targetId,
        assetId,
        fieldType,
      } = req.body;

      if (
        !["campaign", "adGroup", "assetGroup"].includes(level)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid association level",
        });
      }

      if (
        !/^\d+$/.test(String(targetId ?? "")) ||
        !/^\d+$/.test(String(assetId ?? ""))
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid targetId and assetId are required",
        });
      }

      if (typeof fieldType !== "string" || !fieldType.trim()) {
        return res.status(400).json({
          success: false,
          message: "fieldType is required",
        });
      }

      const validateOnly =
        String(req.body.validateOnly ?? "true").toLowerCase()
        !== "false";

      const confirm =
        req.body.confirm === true ||
        String(req.body.confirm ?? "").toLowerCase() === "true";

      if (!validateOnly && !confirm) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live removal",
        });
      }

      const associationConfig =
        ASSOCIATION_SERVICES[
        level as keyof typeof ASSOCIATION_SERVICES
        ];

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const customerId = String(config.customerId).replace(
        /-/g,
        ""
      );

      const resourceName =
        `customers/${customerId}/` +
        `${associationConfig.resource}/` +
        `${targetId}~${assetId}~${fieldType}`;

      const raw: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/` +
        `${associationConfig.service}:mutate`,
        accessToken,
        config.developerToken,
        {
          operations: [{ remove: resourceName }],
          validateOnly,
        }
      );

      const googleError =
        raw?.data?.data?.error ??
        raw?.data?.error ??
        raw?.error ??
        raw?.data?.results?.data?.error;

      if (googleError) {
        return res.status(502).json({
          success: false,
          message:
            googleError.message ??
            "Google Ads association removal failed",
          details: googleError.details ?? [],
        });
      }

      return res.status(200).json({
        success: true,
        resourceName,
        validateOnly,
        message: validateOnly
          ? "Validation passed; association was not removed"
          : "Association removed",
        googleResponse: raw?.data?.data ?? raw?.data ?? raw,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);
export default router;

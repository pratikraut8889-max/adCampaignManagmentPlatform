import { Router, type Request, type Response } from "express";
import readAccessToken from "../config.js";
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



interface MetaAdListResponse {
    data?: Array<{
        id: string;
        name: string;
        status: string;
        effective_status: string;
        adset_id: string;
        campaign_id: string;
        creative?: {
            id: string;
        };
    }>;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
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

router.get(
  "/meta/ad-accounts/:adAccountId/ads",
  async (req, res) => {
    try {
      const { adAccountId } = req.params;

      const rawLimit = Number(req.query.limit ?? 25);

      if (
        !Number.isInteger(rawLimit) ||
        rawLimit < 1 ||
        rawLimit > 100
      ) {
        return res.status(400).json({
          success: false,
          error: "limit must be between 1 and 100",
        });
      }

      const limit = rawLimit;

      const after =
        typeof req.query.after === "string"
          ? req.query.after
          : undefined;

      const accountId = adAccountId.startsWith("act_")
        ? adAccountId
        : `act_${adAccountId}`;

      // Use your existing token-loading helper here.
      const accessToken = readAccessToken();

      const graphVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";
      const params = new URLSearchParams();
            params.set("access_token", accessToken);
            params.set(
                "fields",
                "id,name,status,effective_status,adset_id,campaign_id"
            );
            // params.set("limit", ...(after ? { after } : {}));
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${accountId}/ads?${params.toString()}`,{method: "GET"});

            const result: any = (await response.json());

            if (!response.ok || result.error) {
                return res.status(502).json({
                    success: false,
                    error: result.error?.message || "Failed to fetch ad creatives from Meta.",
                    metaErrorType: result.error?.type,
                    metaErrorCode: result.error?.code,
                    metaErrorSubcode: result.error?.error_subcode,
                    fbtraceId: result.error?.fbtrace_id,
                });
            }

            return res.status(200).json({
                success: true,
                ads: result.data || [],
            });
    } catch (error: any) {
        const metaError = error.response?.data?.error;
        console.log("Error of Failed API",  error);    
        return res.status(error.response?.status || 500).json({
            success: false,
            error: metaError?.message || "Failed to fetch ads",
            metaErrorCode: metaError?.code,
            metaErrorSubcode: metaError?.error_subcode,
        });
    }
  }
);

// GET ADS BY AD SET ID
router.get("/meta/adsets/:adSetId/ads", async (req, res) => {
  try {
    const { adSetId } = req.params;

    // Validate Ad Set ID
    if (!/^\d+$/.test(adSetId)) {
      return res.status(400).json({
        success: false,
        error: "Valid numeric Ad Set ID is required",
      });
    }

    // Validate limit
    const limit = Number(req.query.limit ?? 25);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: "limit must be between 1 and 100",
      });
    }

    // Pagination
    const after =
      typeof req.query.after === "string"
        ? req.query.after
        : undefined;

    const accessToken = readAccessToken();

    const graphVersion =
      process.env.META_GRAPH_API_VERSION || "v25.0";

    // Build Meta API parameters
    const params = new URLSearchParams();

    params.set(
      "fields",
      "id,name,status,effective_status,adset_id,campaign_id"
    );

    params.set("limit", String(limit));

    if (after) {
      params.set("after", after);
    }

    // Call Meta Graph API
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${adSetId}/ads?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const result: any = await response.json();

    // Meta API error handling
    if (!response.ok || result.error) {
      return res.status(502).json({
        success: false,
        error: result.error?.message || "Failed to fetch Ads",
        metaErrorType: result.error?.type,
        metaErrorCode: result.error?.code,
        metaErrorSubcode: result.error?.error_subcode,
        fbtraceId: result.error?.fbtrace_id,
      });
    }

    // Success response
    return res.status(200).json({
      success: true,
      adSetId,
      count: result.data?.length ?? 0,
      ads: result.data ?? [],
      pagination: {
        hasNextPage: Boolean(result.paging?.next),
        nextCursor: result.paging?.next
          ? result.paging?.cursors?.after ?? null
          : null,
      },
    });

  } catch (error: any) {
    console.error("Get Ad Set Ads error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});


// GET AD PREVIEW
router.get("/meta/ads/:adId/preview", async (req, res) => {
  try {
    const { adId } = req.params;

    if (!/^\d+$/.test(adId)) {
      return res.status(400).json({
        success: false,
        error: "Valid numeric Ad ID is required",
      });
    }

    const allowedFormats = [
      "MOBILE_FEED_STANDARD",
      "DESKTOP_FEED_STANDARD",
      "INSTAGRAM_STANDARD",
      "INSTAGRAM_STORY",
      "INSTAGRAM_REELS",
    ];

    const adFormat = String(
      req.query.ad_format ?? "MOBILE_FEED_STANDARD"
    );

    if (!allowedFormats.includes(adFormat)) {
      return res.status(400).json({
        success: false,
        error: "Unsupported ad_format",
        allowedFormats,
      });
    }

    const accessToken = readAccessToken();

    const graphVersion =
      process.env.META_GRAPH_API_VERSION || "v25.0";

    const params = new URLSearchParams();
    params.set("ad_format", adFormat);

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${adId}/previews?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const result: any = await response.json();

    if (!response.ok || result.error) {
      return res.status(502).json({
        success: false,
        error: result.error?.message || "Failed to get ad preview",
        metaErrorType: result.error?.type,
        metaErrorCode: result.error?.code,
        metaErrorSubcode: result.error?.error_subcode,
        fbtraceId: result.error?.fbtrace_id,
      });
    }

    return res.status(200).json({
      success: true,
      adId,
      adFormat,
      previews: result.data ?? [],
    });

  } catch (error: any) {
    console.error("Ad preview error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch ad preview",
    });
  }
});

export default router;
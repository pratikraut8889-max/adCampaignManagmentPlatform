import { Router } from "express";
import {
  getGoogleAdsConfig,
  getErrorMessage,
  googleAdsRequest,
  GOOGLE_ADS_BASE_URL,
  buildAssetCreate,
  AssetValidationError
} from "../helper/shared.js";
import { getAccessToken } from "../google_config.js";
import multer from "multer";
import { imageSize } from "image-size";

const router = Router();
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

// Assets Manangement 
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
    asset.call_asset.phone_number
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
router.get("/assets/roles", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const { customerId, developerToken } = config;

    const endpoint =
      `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`;

    const assetIds = [
      "429571439538",
      "429571439541",
      "429571439544",
      "429571439547",
      "429571439550",
    ];

    const ids = assetIds.join(", ");

    const queries = {
      customer: `
        SELECT
          asset.id,
          asset.text_asset.text,
          customer_asset.field_type,
          customer_asset.status
        FROM customer_asset
        WHERE asset.id IN (${ids})
          AND customer_asset.status != 'REMOVED'
      `,
      campaign: `
        SELECT
          asset.id,
          asset.text_asset.text,
          campaign.id,
          campaign.name,
          campaign_asset.field_type,
          campaign_asset.status
        FROM campaign_asset
        WHERE asset.id IN (${ids})
          AND campaign_asset.status != 'REMOVED'
      `,
      adGroup: `
        SELECT
          asset.id,
          asset.text_asset.text,
          ad_group.id,
          ad_group.name,
          ad_group_asset.field_type,
          ad_group_asset.status
        FROM ad_group_asset
        WHERE asset.id IN (${ids})
          AND ad_group_asset.status != 'REMOVED'
      `,
    };

    const [customerData, campaignData, adGroupData] =
      await Promise.all([
        googleAdsRequest(endpoint, accessToken, developerToken, {
          query: queries.customer,
        }),
        googleAdsRequest(endpoint, accessToken, developerToken, {
          query: queries.campaign,
        }),
        googleAdsRequest(endpoint, accessToken, developerToken, {
          query: queries.adGroup,
        }),
      ]);

    const getResults = (data: any) =>
      data?.data?.results ?? [];

    const normalize = (
      rows: any[],
      associationKey: string,
      scope: string
    ) =>
      rows.map((row: any) => {
        const association = row[associationKey];

        return {
          assetId: row.asset?.id,
          text: row.asset?.textAsset?.text,
          scope,
          role: association?.fieldType,
          status: association?.status,
          campaignId: row.campaign?.id,
          campaignName: row.campaign?.name,
          adGroupId: row.adGroup?.id,
          adGroupName: row.adGroup?.name,
        };
      });

    const assets = [
      ...normalize(
        getResults(customerData),
        "customerAsset",
        "CUSTOMER"
      ),
      ...normalize(
        getResults(campaignData),
        "campaignAsset",
        "CAMPAIGN"
      ),
      ...normalize(
        getResults(adGroupData),
        "adGroupAsset",
        "AD_GROUP"
      ),
    ];

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

    const [adGroupResponse, campaignResponse] =
      await Promise.all([
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
      ]);

    const adGroupResults =
      adGroupResponse?.data?.results ?? [];

    const campaignResults =
      campaignResponse?.data?.results ?? [];

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
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

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


// Campaign Association Assets Manangement 


router.post(
  "/campaigns/:campaignId/assets",
  async (req, res) => {
    try {
      const { campaignId } = req.params;
      const { assetId, fieldType, validateOnly, confirm } =
        req.body;

      if (
        !/^\d+$/.test(campaignId) ||
        !/^\d+$/.test(String(assetId ?? ""))
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaignId or assetId",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
        "AD_IMAGE",
      ];
      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live association",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);
      if (!config) return;

      const { customerId, developerToken } = config;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/campaignAssets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              create: {
                campaign:
                  `customers/${customerId}/campaigns/${campaignId}`,
                asset:
                  `customers/${customerId}/assets/${assetId}`,
                fieldType,
                status: "ENABLED",
              },
            },
          ],
          validateOnly: isValidateOnly,
        }
      );

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Campaign asset association validated"
          : "Campaign asset association created",
        results:
          response?.data?.results ??
          response?.data?.data?.results ??
          [],
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);


router.get(
  "/campaigns/:campaignId/assets",
  async (req, res) => {
    try {
      const { campaignId } = req.params;

      if (!/^\d+$/.test(campaignId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaign ID",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const query = `
        SELECT
  campaign_asset.resource_name,
  campaign_asset.campaign,
  campaign_asset.asset,
  campaign_asset.field_type,
  campaign_asset.status,
  asset.id,
  asset.type
FROM campaign_asset
WHERE campaign.id = 24326130621
  AND asset.id = 429618491423
        `;
      // AND campaign_asset.status != 'REMOVED'

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query }
      );

      const results = response?.data?.results ?? [];

      const assets = results.map((row: any) => ({
        campaign: row.campaign,
        asset: row.asset,
        association: {
          resourceName: row.campaignAsset.resourceName,
          fieldType: row.campaignAsset.fieldType,
          status: row.campaignAsset.status,
          primaryStatus: row.campaignAsset.primaryStatus,
        },
      }));

      return res.status(200).json({
        success: true,
        campaignId,
        total: assets.length,
        assets,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

router.patch(
  "/campaigns/:campaignId/assets/:assetId/:fieldType",
  async (req, res) => {
    try {
      const { campaignId, assetId, fieldType } = req.params;
      const { status, validateOnly, confirm } = req.body;

      if (!/^\d+$/.test(campaignId) ||
        !/^\d+$/.test(assetId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaignId or assetId",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
      ];

      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      if (!["ENABLED", "PAUSED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be ENABLED or PAUSED",
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live updates",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);
      if (!config) return;

      const { customerId, developerToken } = config;

      const resourceName =
        `customers/${customerId}/campaignAssets/` +
        `${campaignId}~${assetId}~${fieldType}`;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/campaignAssets:mutate`,
        accessToken,
        developerToken,
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
          validateOnly: isValidateOnly,
        }
      );

      const data = response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Campaign asset status update validated"
          : "Campaign asset status updated",
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



router.delete(
  "/campaigns/:campaignId/assets/:assetId/:fieldType",
  async (req, res) => {
    try {
      const { campaignId, assetId, fieldType } = req.params;
      const { validateOnly, confirm } = req.body ?? {};

      if (
        !/^\d+$/.test(campaignId) ||
        !/^\d+$/.test(assetId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaignId or assetId",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
      ];

      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true to remove the association",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const resourceName =
        `customers/${customerId}/campaignAssets/` +
        `${campaignId}~${assetId}~${fieldType}`;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/campaignAssets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              remove: resourceName,
            },
          ],
          validateOnly: isValidateOnly,
        }
      );

      const data =
        response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Asset association removal validated"
          : "Asset association removed from campaign",
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


router.get(
  "/ad-groups/:adGroupId/assets",
  async (req, res) => {
    try {
      const { adGroupId } = req.params;

      if (!/^\d+$/.test(adGroupId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ad group ID",
        });
      }

      const readFilter = (key: string): string | undefined => {
        const value = req.query[key];

        if (value === undefined) return undefined;

        if (typeof value !== "string") {
          throw new Error(`${key} must be a single value`);
        }

        return value.trim().toUpperCase();
      };

      const type = readFilter("type");
      const fieldType = readFilter("fieldType");
      const status = readFilter("status");

      const allowedTypes = [
        "CALL",
        "CALLOUT",
        "IMAGE",
        "TEXT",
        "SITELINK",
        "STRUCTURED_SNIPPET",
        "LEAD_FORM",
        "PROMOTION",
        "PRICE",
        "MOBILE_APP",
        "BUSINESS_MESSAGE",
        "LOGO",
        "LONG_HEADLINE",
        "MARKETING_IMAGE",
        "CALL_TO_ACTION",

      ];

      const allowedFieldTypes = [
        "CALL",
        "CALLOUT",
        "SITELINK",
        "STRUCTURED_SNIPPET",
        "PROMOTION",
        "PRICE",
        "MOBILE_APP",
        "LEAD_FORM",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
        "LOGO",
        "IMAGE",
        "AD_IMAGE"
      ];

      const allowedStatuses = [
        "ENABLED",
        "PAUSED",
        "REMOVED",
        "ALL",
      ];

      if (type && !allowedTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid asset type",
          allowedTypes,
        });
      }

      if (
        fieldType &&
        !allowedFieldTypes.includes(fieldType)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid asset field type",
          allowedFieldTypes,
        });
      }

      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
          allowedStatuses,
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const conditions = [
        `ad_group.id = ${adGroupId}`,
      ];

      if (type) {
        conditions.push(`asset.type = '${type}'`);
      }

      if (fieldType) {
        conditions.push(
          `ad_group_asset.field_type = '${fieldType}'`
        );
      }

      if (status && status !== "ALL") {
        conditions.push(
          `ad_group_asset.status = '${status}'`
        );
      } else if (!status) {
        conditions.push(
          "ad_group_asset.status != 'REMOVED'"
        );
      }

      const query = `
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
        WHERE ${conditions.join("\n          AND ")}
      `;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
        accessToken,
        developerToken,
        { query }
      );

      const results = response?.data?.results ?? [];

      const assets = results.map((row: any) => ({
        adGroup: row.adGroup,
        asset: row.asset,
        association: {
          resourceName: row.adGroupAsset.resourceName,
          fieldType: row.adGroupAsset.fieldType,
          status: row.adGroupAsset.status,
          primaryStatus: row.adGroupAsset.primaryStatus,
        },
      }));

      return res.status(200).json({
        success: true,
        adGroupId,
        total: assets.length,
        filters: {
          type: type ?? null,
          fieldType: fieldType ?? null,
          status: status ?? "ACTIVE",
        },
        assets,
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
  "/ad-groups/:adGroupId/assets",
  async (req, res) => {
    try {
      const { adGroupId } = req.params;
      const {
        assetId,
        fieldType,
        status = "PAUSED",
        validateOnly,
        confirm,
      } = req.body;

      if (
        !/^\d+$/.test(adGroupId) ||
        !/^\d+$/.test(String(assetId ?? ""))
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid adGroupId and assetId are required",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
        "MOBILE_APP",
        "PRICE",
        "PROMOTION",
        "LEAD_FORM",
        "AD_IMAGE"
      ];

      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      if (!["ENABLED", "PAUSED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be ENABLED or PAUSED",
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live association",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const rawResponse: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/adGroupAssets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              create: {
                adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
                asset: `customers/${customerId}/assets/${assetId}`,
                fieldType,
                status,
              },
            },
          ],
          validateOnly: isValidateOnly,
        }
      );

      // Unwrap the response returned by your shared helper.
      const googleData =
        rawResponse?.data?.data ??
        rawResponse?.data ??
        rawResponse;

      const apiError = googleData?.error ?? rawResponse?.error;

      if (apiError) {
        const failure = apiError.details?.find(
          (detail: any) =>
            detail["@type"]?.includes("GoogleAdsFailure")
        );

        const firstError = failure?.errors?.[0];

        const statusCode =
          Number(apiError.code) >= 400 &&
            Number(apiError.code) <= 599
            ? Number(apiError.code)
            : 502;

        return res.status(statusCode).json({
          success: false,
          message:
            firstError?.message ??
            apiError.message ??
            "Google Ads API request failed",
          errorCode: firstError?.errorCode ?? null,
          requestId: failure?.requestId ?? null,
        });
      }

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Ad group asset association validated"
          : "Ad group asset association created",
        results: googleData?.results ?? [],
      });


      // const data =
      //   response?.data?.data ??
      //   response?.data ??
      //   response;


      // return res.status(200).json({
      //   success: true,
      //   validateOnly: isValidateOnly,
      //   message: isValidateOnly
      //     ? "Ad group asset association validated"
      //     : "Ad group asset association created",
      //   results: response,
      // });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

router.patch(
  "/ad-groups/:adGroupId/assets/:assetId/:fieldType",
  async (req, res) => {
    try {
      const { adGroupId, assetId, fieldType } = req.params;
      const { status, validateOnly, confirm } = req.body;

      if (
        !/^\d+$/.test(adGroupId) ||
        !/^\d+$/.test(assetId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid adGroupId or assetId",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
        "MOBILE_APP",
        "PRICE",
        "PROMOTION",
        "LEAD_FORM",
      ];

      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      if (!["ENABLED", "PAUSED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be ENABLED or PAUSED",
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live updates",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const resourceName =
        `customers/${customerId}/adGroupAssets/` +
        `${adGroupId}~${assetId}~${fieldType}`;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/adGroupAssets:mutate`,
        accessToken,
        developerToken,
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
          validateOnly: isValidateOnly,
        }
      );

      const data =
        response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Ad group asset status update validated"
          : "Ad group asset status updated",
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

router.delete(
  "/ad-groups/:adGroupId/assets/:assetId/:fieldType",
  async (req, res) => {
    try {
      const { adGroupId, assetId, fieldType } = req.params;
      const { validateOnly, confirm } = req.body ?? {};

      if (
        !/^\d+$/.test(adGroupId) ||
        !/^\d+$/.test(assetId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid adGroupId or assetId",
        });
      }

      const allowedFieldTypes = [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "BUSINESS_LOGO",
        "MOBILE_APP",
        "PRICE",
        "PROMOTION",
        "LEAD_FORM",
      ];

      if (!allowedFieldTypes.includes(fieldType)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported fieldType",
          allowedFieldTypes,
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true to remove the association",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);

      if (!config) return;

      const { customerId, developerToken } = config;

      const resourceName =
        `customers/${customerId}/adGroupAssets/` +
        `${adGroupId}~${assetId}~${fieldType}`;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/adGroupAssets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              remove: resourceName,
            },
          ],
          validateOnly: isValidateOnly,
        }
      );

      const data =
        response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Ad group asset removal validated"
          : "Asset association removed from ad group",
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

router.get("/account/assets", async (req, res) => {
  try {
    const readFilter = (key: string): string | undefined => {
      const value = req.query[key];

      if (value === undefined) return undefined;

      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${key} must be a single non-empty value`);
      }

      return value.trim().toUpperCase();
    };

    const type = readFilter("type");
    const fieldType = readFilter("fieldType");
    const status = readFilter("status");

    const allowedStatuses = [
      "ENABLED",
      "PAUSED",
      "REMOVED",
      "ALL",
    ];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
        allowedStatuses,
      });
    }

    // Restrict filter values to safe enum-style identifiers.
    for (const [key, value] of Object.entries({
      type,
      fieldType,
    })) {
      if (
        value &&
        !/^[A-Z][A-Z0-9_]*$/.test(value)
      ) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${key} filter`,
        });
      }
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const { customerId, developerToken } = config;

    const conditions: string[] = [];

    if (type) {
      conditions.push(`asset.type = '${type}'`);
    }

    if (fieldType) {
      conditions.push(
        `customer_asset.field_type = '${fieldType}'`
      );
    }

    // if (status && status !== "ALL") {
    //   conditions.push(
    //     `customer_asset.status = '${status}'`
    //   );
    // } else if (!status) {
    //   conditions.push(
    //     "customer_asset.status != 'REMOVED'"
    //   );
    // }

    const query = `
      SELECT
        customer_asset.resource_name,
        customer_asset.asset,
        customer_asset.field_type,
        customer_asset.status,
        customer_asset.primary_status,
        asset.id,
        asset.name,
        asset.type
      FROM customer_asset
      ${conditions.length
        ? `WHERE ${conditions.join("\n AND ")}`
        : ""}
    `;

    const response: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
      accessToken,
      developerToken,
      { query }
    );
    console.log(

    );

    const results = response?.data?.results ?? [];

    const assets = results.map((row: any) => ({
      asset: row.asset,
      association: {
        resourceName: row.customerAsset.resourceName,
        fieldType: row.customerAsset.fieldType,
        status: row.customerAsset.status,
        primaryStatus: row.customerAsset.primaryStatus,
      },
    }));

    return res.status(200).json({
      success: true,
      total: assets.length,
      filters: {
        type: type ?? null,
        fieldType: fieldType ?? null,
        status: status ?? "ACTIVE",
      },
      assets,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});


router.post("/account/assets", async (req, res) => {
  try {
    const {
      assetId,
      fieldType,
      status = "PAUSED",
      validateOnly,
      confirm,
    } = req.body;

    if (!/^\d+$/.test(String(assetId ?? ""))) {
      return res.status(400).json({
        success: false,
        message: "Valid assetId is required",
      });
    }

    const allowedFieldTypes = [
      "SITELINK",
      "CALLOUT",
      "STRUCTURED_SNIPPET",
      "CALL",
      "BUSINESS_NAME",
      "BUSINESS_LOGO",
    ];

    if (!allowedFieldTypes.includes(fieldType)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported fieldType",
        allowedFieldTypes,
      });
    }

    if (!["ENABLED", "PAUSED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be ENABLED or PAUSED",
      });
    }

    const isValidateOnly = validateOnly !== false;

    if (!isValidateOnly && confirm !== true) {
      return res.status(400).json({
        success: false,
        message: "Set confirm: true for live association",
      });
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);
    if (!config) return;

    const { customerId, developerToken } = config;

    const response: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/customerAssets:mutate`,
      accessToken,
      developerToken,
      {
        operations: [
          {
            create: {
              customer: `customers/${customerId}`,
              asset: `customers/${customerId}/assets/${assetId}`,
              fieldType,
              status,
            },
          },
        ],
        validateOnly: isValidateOnly,
      }
    );

    const data =
      response?.data?.data ??
      response?.data ??
      response;

    return res.status(200).json({
      success: true,
      validateOnly: isValidateOnly,
      message: isValidateOnly
        ? "Account asset association validated"
        : "Account asset association created",
      results: data?.results ?? [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});

router.patch("/account/assets/:assetId/:fieldType", async (req, res) => {
  try {
    const { assetId, fieldType } = req.params;
    const { status, validateOnly, confirm } = req.body;

    if (!/^\d+$/.test(assetId)) {
      return res.status(400).json({
        success: false,
        message: "Valid assetId is required",
      });
    }

    if (!["ENABLED", "PAUSED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be ENABLED or PAUSED",
      });
    }

    const isValidateOnly = validateOnly !== false;

    if (!isValidateOnly && confirm !== true) {
      return res.status(400).json({
        success: false,
        message: "Set confirm: true for live update",
      });
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);
    if (!config) return;

    const { customerId, developerToken } = config;

    const response: any = await googleAdsRequest(
      `${GOOGLE_ADS_BASE_URL}/${customerId}/customerAssets:mutate`,
      accessToken,
      developerToken,
      {
        operations: [
          {
            update: {
              resourceName:
                `customers/${customerId}/customerAssets/` +
                `${assetId}~${fieldType}`,
              status,
            },
            updateMask: "status",
          },
        ],
        validateOnly: isValidateOnly,
      }
    );

    const data =
      response?.data?.data ??
      response?.data ??
      response;

    return res.status(200).json({
      success: true,
      validateOnly: isValidateOnly,
      message: isValidateOnly
        ? "Account asset status update validated"
        : "Account asset status updated",
      results: data?.results ?? [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: getErrorMessage(error),
    });
  }
});
router.delete(
  "/account/assets/:assetId/:fieldType",
  async (req, res) => {
    try {
      const { assetId, fieldType } = req.params;
      const { validateOnly, confirm } = req.body ?? {};

      if (!/^\d+$/.test(assetId)) {
        return res.status(400).json({
          success: false,
          message: "Valid assetId is required",
        });
      }

      const isValidateOnly = validateOnly !== false;

      if (!isValidateOnly && confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "Set confirm: true for live deletion",
        });
      }

      const accessToken = await getAccessToken();
      const config = getGoogleAdsConfig(res);
      if (!config) return;

      const { customerId, developerToken } = config;

      const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/customerAssets:mutate`,
        accessToken,
        developerToken,
        {
          operations: [
            {
              remove:
                `customers/${customerId}/customerAssets/` +
                `${assetId}~${fieldType}`,
            },
          ],
          validateOnly: isValidateOnly,
        }
      );

      const data =
        response?.data?.data ??
        response?.data ??
        response;

      return res.status(200).json({
        success: true,
        validateOnly: isValidateOnly,
        message: isValidateOnly
          ? "Account asset association removal validated"
          : "Account asset association removed",
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

router.post(
  "/assets/images/upload",

  // Handle multipart file upload errors
  (req, res, next) => {
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
export default router;

import { Router, type Request, type Response } from "express";
import { getAccessToken } from "../google_config.js";
import {
    GOOGLE_ADS_BASE_URL,
    getErrorMessage,
    getGoogleAdsConfig,
    googleAdsRequest,
    isValidId,
} from "../helper/shared.js";

/**
 * Ad retrieval routes (read only), mounted under /google-ads.
 *
 *   GET /google-ads/ads                 list ads with filters
 *   GET /google-ads/ads/:adId           one ad
 *   GET /google-ads/ads/:adId/assets    asset-level performance of one ad
 *
 * Every filter is allow-listed or digits-only. Nothing from the request is
 * pasted into GAQL as free text.
 */

const router = Router();

const AD_TYPES = [
    "RESPONSIVE_SEARCH_AD",
    "RESPONSIVE_DISPLAY_AD",
    "APP_AD",
    "VIDEO_RESPONSIVE_AD",
    "IMAGE_AD",
    "SHOPPING_PRODUCT_AD",
    "EXPANDED_TEXT_AD",
] as const;
const STATUSES = ["ENABLED", "PAUSED"] as const;
const STRENGTHS = [
    "PENDING",
    "NO_ADS",
    "POOR",
    "AVERAGE",
    "GOOD",
    "EXCELLENT",
] as const;
const APPROVALS = [
    "APPROVED",
    "APPROVED_LIMITED",
    "DISAPPROVED",
    "AREA_OF_INTEREST_ONLY",
    "UNKNOWN",
] as const;

const MAX_PAGES = 20;

class FilterError extends Error { }

function oneOf<T extends string>(
    value: string,
    allowed: readonly T[],
    name: string,
): T {
    if (!allowed.includes(value as T)) {
        throw new FilterError(
            `${name} must be one of: ${allowed.join(", ")}.`,
        );
    }
    return value as T;
}

const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

const AD_FIELDS = [
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "ad_group_ad.resource_name",
    "ad_group_ad.status",
    "ad_group_ad.primary_status",
    "ad_group_ad.primary_status_reasons",
    "ad_group_ad.ad_strength",
    "ad_group_ad.action_items",
    "ad_group_ad.policy_summary.approval_status",
    "ad_group_ad.policy_summary.review_status",
    "ad_group_ad.policy_summary.policy_topic_entries",
    "ad_group_ad.ad.id",
    "ad_group_ad.ad.resource_name",
    "ad_group_ad.ad.type",
    "ad_group_ad.ad.final_urls",
    "ad_group_ad.ad.final_mobile_urls",
    "ad_group_ad.ad.tracking_url_template",
    "ad_group_ad.ad.added_by_google_ads",
    "ad_group_ad.ad.responsive_search_ad.headlines",
    "ad_group_ad.ad.responsive_search_ad.descriptions",
    "ad_group_ad.ad.responsive_search_ad.path1",
    "ad_group_ad.ad.responsive_search_ad.path2",
];

type AdFilters = {
    campaignId?: string;
    adGroupId?: string;
    adId?: string;
    status?: (typeof STATUSES)[number];
    types?: (typeof AD_TYPES)[number][];
    adStrength?: (typeof STRENGTHS)[number];
    approvalStatus?: (typeof APPROVALS)[number];
    includeRemoved?: boolean;
};

function requireId(value: string, name: string): string {
    if (!isValidId(value)) {
        throw new FilterError(`${name} must contain digits only.`);
    }
    return value;
}

function buildAdsQuery(filters: AdFilters): string {
    const where: string[] = [];

    if (!filters.includeRemoved) {
        where.push("ad_group_ad.status != 'REMOVED'");
    }
    if (filters.campaignId) {
        where.push(
            `campaign.id = ${requireId(filters.campaignId, "campaignId")}`,
        );
    }
    if (filters.adGroupId) {
        where.push(
            `ad_group.id = ${requireId(filters.adGroupId, "adGroupId")}`,
        );
    }
    if (filters.adId) {
        where.push(`ad_group_ad.ad.id = ${requireId(filters.adId, "adId")}`);
    }
    if (filters.status) {
        where.push(
            `ad_group_ad.status = '${oneOf(filters.status, STATUSES, "status")}'`,
        );
    }
    if (filters.types?.length) {
        const list = filters.types
            .map((type) => `'${oneOf(type, AD_TYPES, "types")}'`)
            .join(", ");
        where.push(`ad_group_ad.ad.type IN (${list})`);
    }
    if (filters.adStrength) {
        where.push(
            `ad_group_ad.ad_strength = '${oneOf(filters.adStrength, STRENGTHS, "adStrength")}'`,
        );
    }
    if (filters.approvalStatus) {
        where.push(
            `ad_group_ad.policy_summary.approval_status = '${oneOf(filters.approvalStatus, APPROVALS, "approvalStatus")}'`,
        );
    }

    return (
        `SELECT ${AD_FIELDS.join(", ")} FROM ad_group_ad` +
        (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        " ORDER BY ad_group_ad.ad.id"
    );
}

/** Flattens Google's nested row into a stable shape for the frontend. */
function normalizeAd(row: any) {
    const link = row.adGroupAd ?? {};
    const ad = link.ad ?? {};
    const rsa = ad.responsiveSearchAd;
    const policy = link.policySummary ?? {};

    return {
        id: ad.id,
        resourceName: link.resourceName,
        adResourceName: ad.resourceName,
        campaignId: row.campaign?.id,
        campaignName: row.campaign?.name,
        adGroupId: row.adGroup?.id,
        adGroupName: row.adGroup?.name,
        type: ad.type,
        status: link.status,
        primaryStatus: link.primaryStatus,
        notServingReasons: link.primaryStatusReasons ?? [],
        adStrength: link.adStrength,
        actionItems: link.actionItems ?? [],
        approvalStatus: policy.approvalStatus,
        reviewStatus: policy.reviewStatus,
        policyTopics: (policy.policyTopicEntries ?? []).map((entry: any) => ({
            topic: entry.topic,
            type: entry.type,
        })),
        finalUrls: ad.finalUrls ?? [],
        finalMobileUrls: ad.finalMobileUrls ?? [],
        trackingUrlTemplate: ad.trackingUrlTemplate,
        createdByGoogle: ad.addedByGoogleAds ?? false,
        ...(rsa && {
            headlines: (rsa.headlines ?? []).map((item: any) => ({
                text: item.text,
                pinnedField: item.pinnedField,
            })),
            descriptions: (rsa.descriptions ?? []).map((item: any) => ({
                text: item.text,
                pinnedField: item.pinnedField,
            })),
            path1: rsa.path1,
            path2: rsa.path2,
        }),
    };
}

/** Runs a search and follows nextPageToken, up to MAX_PAGES pages. */
async function searchAll(
    customerId: string,
    accessToken: string,
    developerToken: string,
    query: string,
) {
    const rows: any[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
        const { response, data } = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${customerId}/googleAds:search`,
            accessToken,
            developerToken,
            pageToken ? { query, pageToken } : { query },
        );

        if (!response.ok) {
            return { ok: false as const, status: response.status, data };
        }

        const body = (data ?? {}) as {
            results?: any[];
            nextPageToken?: string;
        };
        rows.push(...(body.results ?? []));
        pageToken = body.nextPageToken;

        if (!pageToken) {
            return { ok: true as const, rows, truncated: false };
        }
    }

    return { ok: true as const, rows, truncated: true };
}

function handleError(res: Response, error: unknown) {
    if (error instanceof FilterError) {
        return res.status(400).json({ message: error.message });
    }
    console.error("Ad retrieval error:", error);
    return res.status(500).json({ message: getErrorMessage(error) });
}

// -----------------------------------------------------------------------------
// GET /google-ads/ads
// Filters: campaignId, adGroupId, status, types (comma list), adStrength,
//          approvalStatus, includeRemoved=true
// -----------------------------------------------------------------------------
router.get("/ads", async (req: Request, res: Response) => {
    try {
        const config = getGoogleAdsConfig(res);
        if (!config) return;

        const q = req.query;
        const typesText = text(q.types);

        const query = buildAdsQuery({
            campaignId: text(q.campaignId),
            adGroupId: text(q.adGroupId),
            status: text(q.status) as AdFilters["status"],
            types: typesText?.split(",").map((item) => item.trim()) as
                | AdFilters["types"]
                | undefined,
            adStrength: text(q.adStrength) as AdFilters["adStrength"],
            approvalStatus: text(q.approvalStatus) as AdFilters["approvalStatus"],
            includeRemoved: q.includeRemoved === "true",
        });

        const accessToken = await getAccessToken();
        const result = await searchAll(
            config.customerId,
            accessToken,
            config.developerToken,
            query,
        );

        if (!result.ok) {
            return res.status(result.status).json(result.data);
        }

        const ads = result.rows.map(normalizeAd);

        return res.status(200).json({
            customerId: config.customerId,
            count: ads.length,
            truncated: result.truncated,
            ads,
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// -----------------------------------------------------------------------------
// GET /google-ads/ads/:adId/assets
// Asset-level performance for one ad (responsive search, app, Demand Gen ads).
// Registered before /ads/:adId so the longer path is matched first.
// -----------------------------------------------------------------------------
router.get("/ads/:adId/assets", async (req: Request, res: Response) => {
    try {
        const adId = requireId(String(req.params.adId), "adId");
        const config = getGoogleAdsConfig(res);
        if (!config) return;

        const query = `
            SELECT
                ad_group_ad.ad.id,
                ad_group.id,
                ad_group_ad_asset_view.field_type,
                ad_group_ad_asset_view.performance_label,
                ad_group_ad_asset_view.enabled,
                ad_group_ad_asset_view.pinned_field,
                ad_group_ad_asset_view.policy_summary.approval_status,
                ad_group_ad_asset_view.policy_summary.review_status,
                asset.id,
                asset.type,
                asset.text_asset.text
            FROM ad_group_ad_asset_view
            WHERE ad_group_ad.ad.id = ${adId}
                AND ad_group_ad_asset_view.enabled = TRUE
        `;

        const accessToken = await getAccessToken();
        const result = await searchAll(
            config.customerId,
            accessToken,
            config.developerToken,
            query,
        );

        if (!result.ok) {
            return res.status(result.status).json(result.data);
        }

        const assets = result.rows.map((row: any) => ({
            assetId: row.asset?.id,
            assetType: row.asset?.type,
            text: row.asset?.textAsset?.text,
            fieldType: row.adGroupAdAssetView?.fieldType,
            performanceLabel: row.adGroupAdAssetView?.performanceLabel,
            pinnedField: row.adGroupAdAssetView?.pinnedField,
            enabled: row.adGroupAdAssetView?.enabled,
            approvalStatus:
                row.adGroupAdAssetView?.policySummary?.approvalStatus,
            reviewStatus: row.adGroupAdAssetView?.policySummary?.reviewStatus,
        }));

        return res.status(200).json({
            customerId: config.customerId,
            adId,
            count: assets.length,
            truncated: result.truncated,
            assets,
        });
    } catch (error) {
        return handleError(res, error);
    }
});

// -----------------------------------------------------------------------------
// GET /google-ads/ads/:adId
// -----------------------------------------------------------------------------
router.get("/ads/:adId", async (req: Request, res: Response) => {
    try {
        const adId = requireId(String(req.params.adId), "adId");
        const config = getGoogleAdsConfig(res);
        if (!config) return;

        const query = buildAdsQuery({ adId, includeRemoved: true });
        const accessToken = await getAccessToken();
        const result = await searchAll(
            config.customerId,
            accessToken,
            config.developerToken,
            query,
        );

        if (!result.ok) {
            return res.status(result.status).json(result.data);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Ad not found." });
        }

        return res.status(200).json({
            customerId: config.customerId,
            ad: normalizeAd(result.rows[0]),
        });
    } catch (error) {
        return handleError(res, error);
    }
});

export default router;

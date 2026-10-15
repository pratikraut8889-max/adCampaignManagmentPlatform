import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";

const router = Router();
const API_VERSION = "v25";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/-/g, "");
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

type GoogleAdsRow = Record<string, any>;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateRange(req: Request) {
  const startDate = String(req.query.startDate ?? "");
  const endDate = String(req.query.endDate ?? "");
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return null;
  return { startDate, endDate };
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function metrics(row: GoogleAdsRow) {
  const m = row.metrics ?? {};
  const impressions = num(m.impressions);
  const clicks = num(m.clicks);
  const cost = num(m.costMicros) / 1_000_000;
  const conversions = num(m.conversions);
  const conversionsValue = num(m.conversionsValue);
  return {
    impressions,
    clicks,
    cost: round(cost),
    conversions: round(conversions),
    conversionsValue: round(conversionsValue),
    ctr: round(num(m.ctr) * 100),
    averageCpc: round(num(m.averageCpc) / 1_000_000),
    conversionRate: round(num(m.conversionRate) * 100),
    costPerConversion: conversions > 0 ? round(cost / conversions) : 0,
    roas: cost > 0 ? round(conversionsValue / cost) : 0,
  };
}

async function queryGoogleAds(query: string): Promise<GoogleAdsRow[]> {
  if (!CUSTOMER_ID || !DEVELOPER_TOKEN) {
    throw new Error("Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN.");
  }
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Google Ads API error (${response.status}): ${JSON.stringify(payload)}`);
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

function fail(res: Response, error: unknown) {
  res.status(500).json({
    success: false,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

const TERM_FIELDS = `
  search_term_view.search_term,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.ctr,
  metrics.average_cpc
  `;
// metrics.conversion_rate

function mapTerm(row: GoogleAdsRow) {
  return {
    searchTerm: row.searchTermView?.searchTerm ?? "",
    matchType: row.searchTermView?.searchTermMatchType ?? "",
    campaignId: row.campaign?.id ?? "",
    campaignName: row.campaign?.name ?? "",
    adGroupId: row.adGroup?.id ?? "",
    adGroupName: row.adGroup?.name ?? "",
    metrics: metrics(row),
  };
}

function mapNegative(row: GoogleAdsRow) {
  const ac = row.adGroupCriterion ?? {};
  const cc = row.campaignCriterion ?? {};
  const keyword = ac.keyword ?? cc.keyword ?? {};
  return {
    level: row.adGroup?.id ? "AD_GROUP" : "CAMPAIGN",
    campaignId: row.campaign?.id ?? "",
    campaignName: row.campaign?.name ?? "",
    adGroupId: row.adGroup?.id ?? "",
    adGroupName: row.adGroup?.name ?? "",
    criterionId: ac.criterionId ?? cc.criterionId ?? "",
    keywordText: keyword.text ?? "",
    matchType: keyword.matchType ?? "",
    status: ac.status ?? cc.status ?? "",
  };
}

// 1. Search terms, last 30 days
router.get("/google-ads/reports/search-terms", async (_req: Request, res: Response) => {
  try {
    const rows = await queryGoogleAds(`
      SELECT ${TERM_FIELDS}
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.clicks DESC
    `);
    res.json({ success: true, dateRange: "LAST_30_DAYS", total: rows.length, data: rows.map(mapTerm) });
  } catch (error) { fail(res, error); }
});

// 2. Search terms for a custom date range
router.get("/google-ads/reports/search-terms/range", async (req: Request, res: Response) => {
  const range = dateRange(req);
  if (!range) return res.status(400).json({ success: false, message: "Use valid startDate and endDate in YYYY-MM-DD format." });
  try {
    const rows = await queryGoogleAds(`
      SELECT ${TERM_FIELDS}, segments.date
      FROM search_term_view
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
      ORDER BY segments.date DESC, metrics.clicks DESC
    `);
    res.json({ success: true, ...range, total: rows.length, data: rows.map((r) => ({ date: r.segments?.date ?? "", ...mapTerm(r) })) });
  } catch (error) { fail(res, error); }
});

// 3. Daily performance for one search term
router.get("/google-ads/reports/search-terms/daily-trends", async (req: Request, res: Response) => {
  const range = dateRange(req);
  const searchTerm = String(req.query.searchTerm ?? "").trim();
  if (!range) return res.status(400).json({ success: false, message: "Use valid startDate and endDate in YYYY-MM-DD format." });
  if (!searchTerm) return res.status(400).json({ success: false, message: "Provide searchTerm as a query parameter." });
  try {
    const escaped = searchTerm.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const rows = await queryGoogleAds(`
      SELECT ${TERM_FIELDS}, segments.date
      FROM search_term_view
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
        AND search_term_view.search_term = '${escaped}'
      ORDER BY segments.date ASC
    `);
    res.json({ success: true, searchTerm, ...range, total: rows.length, data: rows.map((r) => ({ date: r.segments?.date ?? "", ...mapTerm(r) })) });
  } catch (error) { fail(res, error); }
});

// 4. Top search terms
router.get("/google-ads/reports/search-terms/top", async (req: Request, res: Response) => {
  const range = dateRange(req);
  if (!range) return res.status(400).json({ success: false, message: "Use valid startDate and endDate in YYYY-MM-DD format." });
  const allowed = ["clicks", "impressions", "conversions", "cost", "roas", "ctr"];
  const sortBy = String(req.query.sortBy ?? "clicks").toLowerCase();
  if (!allowed.includes(sortBy)) return res.status(400).json({ success: false, message: `sortBy must be one of: ${allowed.join(", ")}.` });
  const requested = Number.parseInt(String(req.query.limit ?? "10"), 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 10;
  try {
    const rows = await queryGoogleAds(`
      SELECT ${TERM_FIELDS}
      FROM search_term_view
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
      ORDER BY metrics.clicks DESC
    `);
    const sorted = rows.map(mapTerm).sort((a, b) => {
      const av = sortBy === "cost" ? a.metrics.cost : sortBy === "roas" ? a.metrics.roas : sortBy === "ctr" ? a.metrics.ctr : a.metrics[sortBy as "clicks" | "impressions" | "conversions"];
      const bv = sortBy === "cost" ? b.metrics.cost : sortBy === "roas" ? b.metrics.roas : sortBy === "ctr" ? b.metrics.ctr : b.metrics[sortBy as "clicks" | "impressions" | "conversions"];
      return bv - av;
    }).slice(0, limit);
    res.json({ success: true, ...range, sortBy, limit, total: sorted.length, data: sorted });
  } catch (error) { fail(res, error); }
});

// 5. Existing negative keywords at campaign and ad-group levels
router.get("/google-ads/reports/negative-keywords", async (_req: Request, res: Response) => {
  try {
    const campaignQuery = `
      SELECT campaign.id, campaign.name,
        campaign_criterion.criterion_id, campaign_criterion.negative,
        campaign_criterion.status, campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign_criterion.type = KEYWORD
        AND campaign_criterion.negative = TRUE
    `;
    const adGroupQuery = `
      SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
        ad_group_criterion.criterion_id, ad_group_criterion.negative,
        ad_group_criterion.status, ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = KEYWORD
        AND ad_group_criterion.negative = TRUE
    `;
    const [campaignRows, adGroupRows] = await Promise.all([
      queryGoogleAds(campaignQuery), queryGoogleAds(adGroupQuery),
    ]);
    const data = [...campaignRows, ...adGroupRows].map(mapNegative);
    res.json({
      success: true,
      total: data.length,
      campaignLevelCount: campaignRows.length,
      adGroupLevelCount: adGroupRows.length,
      data,
    });
  } catch (error) { fail(res, error); }
});

// 6. Terms with clicks but no conversions: review manually before adding negatives
router.get("/google-ads/reports/search-terms/negative-candidates", async (req: Request, res: Response) => {
  const range = dateRange(req);
  if (!range) return res.status(400).json({ success: false, message: "Use valid startDate and endDate in YYYY-MM-DD format." });
  const requested = Number.parseInt(String(req.query.minClicks ?? "10"), 10);
  const minClicks = Number.isFinite(requested) ? Math.max(requested, 1) : 10;
  try {
    const rows = await queryGoogleAds(`
      SELECT ${TERM_FIELDS}
      FROM search_term_view
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
        AND metrics.clicks >= ${minClicks}
        AND metrics.conversions = 0
      ORDER BY metrics.clicks DESC
    `);
    res.json({
      success: true, ...range, minClicks,
      note: "Review relevance before adding a negative keyword; zero conversions alone does not prove a term is irrelevant.",
      total: rows.length, data: rows.map(mapTerm),
    });
  } catch (error) { fail(res, error); }
});

export default router;

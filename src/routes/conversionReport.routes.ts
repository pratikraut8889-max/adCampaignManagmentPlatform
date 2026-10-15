import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";

const router = Router();
const API_VERSION = "v25";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/-/g, "");
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

type GoogleAdsRow = Record<string, any>;
type DateRange = { startDate: string; endDate: string };

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getDateRange(req: Request): DateRange | null {
  const startDate = String(req.query.startDate ?? "");
  const endDate = String(req.query.endDate ?? "");
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return null;
  return { startDate, endDate };
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mapMetrics(row: GoogleAdsRow) {
  const m = row.metrics ?? {};
  const impressions = toNumber(m.impressions);
  const clicks = toNumber(m.clicks);
  const cost = toNumber(m.costMicros) / 1_000_000;
  const conversions = toNumber(m.conversions);
  const conversionsValue = toNumber(m.conversionsValue);
  const allConversions = toNumber(m.allConversions);
  const allConversionsValue = toNumber(m.allConversionsValue);

  return {
    impressions,
    clicks,
    cost: round(cost),
    conversions: round(conversions),
    conversionsValue: round(conversionsValue),
    allConversions: round(allConversions),
    allConversionsValue: round(allConversionsValue),
    ctr: round(toNumber(m.ctr) * 100),
    averageCpc: round(toNumber(m.averageCpc) / 1_000_000),
    conversionRate: round(toNumber(m.conversionRate) * 100),
    costPerConversion: conversions > 0 ? round(cost / conversions) : 0,
    roas: cost > 0 ? round(conversionsValue / cost) : 0,
  };
}

async function runGoogleAdsQuery(query: string): Promise<GoogleAdsRow[]> {
  if (!CUSTOMER_ID || !DEVELOPER_TOKEN) {
    throw new Error("Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN environment variable.");
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    `${API_BASE}/customers/${CUSTOMER_ID}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEVELOPER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Google Ads API error (${response.status}): ${JSON.stringify(payload)}`);
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

function handleError(res: Response, error: unknown): void {
  res.status(500).json({
    success: false,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

function validRangeMessage(res: Response) {
  return res.status(400).json({
    success: false,
    message: "Provide valid startDate and endDate in YYYY-MM-DD format; startDate must not be after endDate.",
  });
}

const COMMON_METRICS = `
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.all_conversions,
  metrics.all_conversions_value,
  metrics.ctr,
  metrics.average_cpc
`;

function mapCampaign(row: GoogleAdsRow) {
  return {
    campaignId: row.campaign?.id ?? "",
    campaignName: row.campaign?.name ?? "",
    campaignStatus: row.campaign?.status ?? "",
    channelType: row.campaign?.advertisingChannelType ?? "",
    metrics: mapMetrics(row),
  };
}

// 1. Account-level conversion overview for the last 30 days
router.get("/google-ads/reports/conversions", async (_req: Request, res: Response) => {
  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        customer.id,
        customer.descriptive_name,
        ${COMMON_METRICS}
      FROM customer
      WHERE segments.date DURING LAST_30_DAYS
    `);
    const row = rows[0] ?? {};
    res.json({
      success: true,
      dateRange: "LAST_30_DAYS",
      customerId: row.customer?.id ?? CUSTOMER_ID,
      customerName: row.customer?.descriptiveName ?? "",
      metrics: mapMetrics(row),
    });
  } catch (error) {
    handleError(res, error);
  }
});

// 2. Campaign-wise conversion report, last 30 days
router.get("/google-ads/reports/conversions/campaigns", async (_req: Request, res: Response) => {
  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        ${COMMON_METRICS}
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.conversions DESC
    `);
    res.json({
      success: true,
      dateRange: "LAST_30_DAYS",
      total: rows.length,
      data: rows.map(mapCampaign),
    });
  } catch (error) {
    con
    handleError(res, error);
  }
});

// 3. Conversion-action breakdown for the last 30 days.
// The campaign resource is used so conversion metrics can be segmented by conversion action.
router.get("/google-ads/reports/conversions/actions", async (_req: Request, res: Response) => {
  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        campaign.id,
        campaign.name,
        segments.conversion_action,
        segments.conversion_action_name,
        segments.conversion_action_category,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.conversions DESC
    `);
    res.json({
      success: true,
      dateRange: "LAST_30_DAYS",
      total: rows.length,
      data: rows.map((row) => {
        const m = mapMetrics(row);
        return {
          campaignId: row.campaign?.id ?? "",
          campaignName: row.campaign?.name ?? "",
          conversionAction: row.segments?.conversionAction ?? "",
          conversionActionName: row.segments?.conversionActionName ?? "",
          conversionActionCategory: row.segments?.conversionActionCategory ?? "",
          metrics: {
            conversions: m.conversions,
            conversionsValue: m.conversionsValue,
            allConversions: m.allConversions,
            allConversionsValue: m.allConversionsValue,
            cost: m.cost,
            costPerConversion: m.costPerConversion,
            roas: m.roas,
          },
        };
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

// 4. Daily conversion trend, custom date range (use this data for charts)
router.get("/google-ads/reports/conversions/daily-trends", async (req: Request, res: Response) => {
  const range = getDateRange(req);
  if (!range) return validRangeMessage(res);

  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        segments.date,
        ${COMMON_METRICS}
      FROM customer
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
      ORDER BY segments.date ASC
    `);

    const byDate = new Map<string, ReturnType<typeof mapMetrics>>();
    for (const row of rows) {
      const date = String(row.segments?.date ?? "");
      if (date) byDate.set(date, mapMetrics(row));
    }

    const data: Array<{ date: string } & ReturnType<typeof mapMetrics>> = [];
    const cursor = new Date(`${range.startDate}T00:00:00Z`);
    const end = new Date(`${range.endDate}T00:00:00Z`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      data.push({ date, ...(byDate.get(date) ?? mapMetrics({})) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({ success: true, ...range, total: data.length, data });
  } catch (error) {
    handleError(res, error);
  }
});

// 5. Top converting campaigns in a custom date range
router.get("/google-ads/reports/conversions/top-campaigns", async (req: Request, res: Response) => {
  const range = getDateRange(req);
  if (!range) return validRangeMessage(res);

  const allowedSorts = ["conversions", "conversionsValue", "cost", "roas", "costPerConversion"];
  const sortBy = String(req.query.sortBy ?? "conversions");
  if (!allowedSorts.includes(sortBy)) {
    return res.status(400).json({
      success: false,
      message: `sortBy must be one of: ${allowedSorts.join(", ")}.`,
    });
  }

  const parsedLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 10;

  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        ${COMMON_METRICS}
      FROM campaign
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
      ORDER BY metrics.conversions DESC
    `);

    const data = rows.map(mapCampaign).sort((a, b) =>
      Number(b.metrics[sortBy as keyof typeof b.metrics]) -
      Number(a.metrics[sortBy as keyof typeof a.metrics])
    ).slice(0, limit);

    res.json({ success: true, ...range, sortBy, limit, total: data.length, data });
  } catch (error) {
    handleError(res, error);
  }
});

// 6. Campaign metrics for a custom date range, aggregated per campaign
router.get("/google-ads/reports/conversions/range", async (req: Request, res: Response) => {
  const range = getDateRange(req);
  if (!range) return validRangeMessage(res);

  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        ${COMMON_METRICS}
      FROM campaign
      WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
      ORDER BY metrics.conversions DESC
    `);
    res.json({ success: true, ...range, total: rows.length, data: rows.map(mapCampaign) });
  } catch (error) {
    handleError(res, error);
  }
});

// 7. Compare current range with the immediately preceding equal-length range
router.get("/google-ads/reports/conversions/compare", async (req: Request, res: Response) => {
  const range = getDateRange(req);
  if (!range) return validRangeMessage(res);

  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (days - 1));
  const previousRange = {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };

  try {
    async function fetchTotals(r: DateRange) {
      const rows = await runGoogleAdsQuery(`
        SELECT ${COMMON_METRICS}
        FROM customer
        WHERE segments.date BETWEEN '${r.startDate}' AND '${r.endDate}'
      `);
      return mapMetrics(rows[0] ?? {});
    }

    const [current, previous] = await Promise.all([fetchTotals(range), fetchTotals(previousRange)]);
    const compareValue = (now: number, before: number) => ({
      current: now,
      previous: before,
      change: round(now - before),
      changePercent: before !== 0 ? round(((now - before) / Math.abs(before)) * 100) : null,
    });

    res.json({
      success: true,
      currentPeriod: range,
      previousPeriod: previousRange,
      comparison: {
        conversions: compareValue(current.conversions, previous.conversions),
        conversionsValue: compareValue(current.conversionsValue, previous.conversionsValue),
        allConversions: compareValue(current.allConversions, previous.allConversions),
        cost: compareValue(current.cost, previous.cost),
        costPerConversion: compareValue(current.costPerConversion, previous.costPerConversion),
        roas: compareValue(current.roas, previous.roas),
        clicks: compareValue(current.clicks, previous.clicks),
        impressions: compareValue(current.impressions, previous.impressions),
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// 8. Conversion actions configured in the account (configuration, not performance metrics)
router.get("/google-ads/reports/conversions/configured-actions", async (_req: Request, res: Response) => {
  try {
    const rows = await runGoogleAdsQuery(`
      SELECT
        conversion_action.id,
        conversion_action.name,
        conversion_action.status,
        conversion_action.type,
        conversion_action.category,
        conversion_action.counting_type,
        conversion_action.include_in_conversions_metric,
        conversion_action.primary_for_goal,
        conversion_action.origin
      FROM conversion_action
      ORDER BY conversion_action.name
    `);
    res.json({
      success: true,
      total: rows.length,
      data: rows.map((row) => ({
        id: row.conversionAction?.id ?? "",
        name: row.conversionAction?.name ?? "",
        status: row.conversionAction?.status ?? "",
        type: row.conversionAction?.type ?? "",
        category: row.conversionAction?.category ?? "",
        countingType: row.conversionAction?.countingType ?? "",
        includeInConversionsMetric: row.conversionAction?.includeInConversionsMetric ?? false,
        primaryForGoal: row.conversionAction?.primaryForGoal ?? false,
        origin: row.conversionAction?.origin ?? "",
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;

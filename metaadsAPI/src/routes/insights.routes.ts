
import { Router, type Request, type Response } from "express";
import { META_DATE_PRESETS, META_FILTER_OPERATORS, META_FILTER_TARGETS, META_INSIGHTS_BREAKDOWNS, META_INSIGHTS_LEVELS } from '../utils/filtering.js';
import { buildInsightsDateFilter } from "../utils/insightsDateFilter.js";
import { META_METRIC_DEFINITIONS } from "../utils/insightsMetrics.js";
// Adjust this import according to your existing project.
import readAccessToken from "../config.js";

const router = Router();

const GRAPH_API_VERSION =
  process.env.META_GRAPH_API_VERSION || "v25.0";

// GET Account-Level Insights
router.get(
  "/meta/ad-accounts/:adAccountId/insights",
  async (req: Request, res: Response) => {
    try {
      const rawAccountId: string = String(req.params.adAccountId);

      // Accept both 123456 and act_123456.
      const adAccountId: string = String(rawAccountId.replace(/^act_/, ""));

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      const params = new URLSearchParams({
        fields: [
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "frequency",
          "date_start",
          "date_stop",
        ].join(","),
        level: "account",
        date_preset: "last_30d",
      });

      const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result: any = await response.json();

      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message: result.error?.message ?? "Meta Insights API failed",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.AD_ACCOUNT,
        datePreset: META_DATE_PRESETS.LAST_30D,
        insights: result.data ?? [],
      });
    } catch (error) {
      console.error("Account Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

/**
 * GET Campaign-Level Insights
 * /meta/ad-accounts/:adAccountId/insights/campaigns
 */
router.get(
  "/meta/ad-accounts/:adAccountId/insights/campaigns",
  async (req: Request, res: Response) => {
    try {
      // Step 1: Get and validate Ad Account ID.
      const rawAccountId: string = String(req.params.adAccountId);
      const adAccountId: string = String(rawAccountId.replace(/^act_/, ""));

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // Step 2: Read the existing Meta access token.
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // Step 3: Configure campaign-level reporting.
      const params = new URLSearchParams({
        fields: [
          "campaign_id",
          "campaign_name",
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "date_start",
          "date_stop",
        ].join(","),
        level: META_INSIGHTS_LEVELS.CAMPAIGN,
        date_preset: META_DATE_PRESETS.LAST_30D,
      });

      // Step 4: Build the Meta Graph API URL.
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // Step 5: Send request to Meta.
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result: any = await response.json();

      // Step 6: Handle Meta API errors.
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to fetch campaign insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // Step 7: Return campaign-wise insights.
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.CAMPAIGN,
        datePreset: META_DATE_PRESETS.LAST_30D,
        count: result.data?.length ?? 0,
        insights: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Campaign Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

/**
 * GET Ad Set-Level Insights
 * /meta/ad-accounts/:adAccountId/insights/adsets
 */
router.get(
  "/meta/ad-accounts/:adAccountId/insights/adsets",
  async (req: Request, res: Response) => {
    try {
      // 1. Validate Ad Account ID
      const rawAccountId = String(req.params.adAccountId);
      const adAccountId = rawAccountId.replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // 2. Read access token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // 3. Configure Ad Set-Level Insights
      const params = new URLSearchParams({
        fields: [
          "adset_id",
          "adset_name",
          "campaign_id",
          "campaign_name",
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "date_start",
          "date_stop",
        ].join(","),
        level: META_INSIGHTS_LEVELS.ADSET,
        date_preset: META_DATE_PRESETS.LAST_30D,
      });

      // 4. Build Meta Graph API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // 5. Request insights
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result: any = await response.json();

      // 6. Handle Meta API error
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to fetch Ad Set insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // 7. Return Ad Set insights
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.ADSET,
        datePreset: META_DATE_PRESETS.LAST_30D,
        count: result.data?.length ?? 0,
        insights: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Ad Set Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

/***
 * GET Ad-Level Insights
 * /meta/ad-accounts/:adAccountId/insights/ads
 */
router.get(
  "/meta/ad-accounts/:adAccountId/insights/ads",
  async (req: Request, res: Response) => {
    try {
      // Step 1: Validate Ad Account ID
      const rawAccountId: string = String(req.params.adAccountId);
      const adAccountId = rawAccountId.replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // Step 2: Read existing access token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      const dateFilterResult = buildInsightsDateFilter({
        datePreset: req.query.datePreset,
        since: req.query.since,
        until: req.query.until,
      });

      if (!dateFilterResult.success) {
        return res.status(400).json({
          success: false,
          message: dateFilterResult.message,
        });
      }
      // Step 3: Configure Ad-Level Insights
      const params = new URLSearchParams({
        fields: [
          "ad_id",
          "ad_name",
          "adset_id",
          "adset_name",
          "campaign_id",
          "campaign_name",
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "date_start",
          "date_stop",
        ].join(","),
        level: META_INSIGHTS_LEVELS.AD,
      });

      // Add either date_preset or time_range
      dateFilterResult.params.forEach((value, key) => {
        params.set(key, value);
      });

      // Step 4: Build Meta Graph API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // Step 5: Call Meta API
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result: any = await response.json();

      // Step 6: Handle Meta API errors
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to fetch Ad-Level Insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // Step 7: Return Ad-Level Insights
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.AD,
        dateFilter: dateFilterResult.dateFilter,
        count: result.data?.length ?? 0,
        insights: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Ad-Level Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);


router.get(
  "/meta/ad-accounts/:adAccountId/insights/metrics",
  async (req: Request, res: Response) => {
    try {
      // 1. Validate Ad Account ID
      const adAccountId = String(
        req.params.adAccountId
      ).replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // 2. Validate date filter
      const dateFilterResult = buildInsightsDateFilter({
        datePreset: req.query.datePreset,
        since: req.query.since,
        until: req.query.until,
      });

      if (!dateFilterResult.success) {
        return res.status(400).json({
          success: false,
          message: dateFilterResult.message,
        });
      }

      // 3. Retrieve token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // 4. Configure requested metrics
      const fields = [
        "ad_id",
        "ad_name",
        "campaign_id",
        "campaign_name",
        "adset_id",
        "adset_name",
        "account_currency",
        "impressions",
        "reach",
        "clicks",
        "inline_link_clicks",
        "spend",
        "ctr",
        "cpc",
        "cpm",
        "frequency",
        "actions",
        "cost_per_action_type",
        "date_start",
        "date_stop",
      ];

      const params = new URLSearchParams({
        fields: fields.join(","),
        level: META_INSIGHTS_LEVELS.AD,
      });

      // 5. Apply existing dynamic date filter
      dateFilterResult.params.forEach((value, key) => {
        params.set(key, value);
      });

      // 6. Build Meta Graph API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // 7. Send GET request
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json();

      // 8. Handle Meta API error
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to retrieve performance metrics",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // 9. Return metrics
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.AD,
        dateFilter: dateFilterResult.dateFilter,
        count: result.data?.length ?? 0,

        metricDefinitions: META_METRIC_DEFINITIONS,

        metrics: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Ad Metrics Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);



// http://localhost:3000/meta/ad-accounts/1820194389321017/insights/filter?level=ad&sortBy=spend&sortDirection=descending&datePreset=last_30d
// http://localhost:3000/meta/ad-accounts/1820194389321017/insights/filter?level=ad&filterField=campaign.id&operator=EQUAL&filterValue=120249195451440775&datePreset=last_30d

// http://localhost:3000/meta/ad-accounts/1820194389321017/insights/filter?level=ad&filterField=adset.id&operator=EQUAL&filterValue=120249201376090775
// http://localhost:3000/meta/ad-accounts/1820194389321017/insights/filter?level=campaign&sortBy=ctr&sortDirection=descending
// http://localhost:3000/meta/ad-accounts/1820194389321017/insights/filter?filterField=campaign.id&operator=CONTAIN&filterValue=120249195451440775
router.get(
  "/meta/ad-accounts/:adAccountId/insights/breakdowns",
  async (req: Request, res: Response) => {
    try {
      // 1. Validate Ad Account ID
      const adAccountId = String(
        req.params.adAccountId
      ).replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // 2. Select and validate breakdown
      const allowedBreakdowns = [
        META_INSIGHTS_BREAKDOWNS.AGE,
        META_INSIGHTS_BREAKDOWNS.GENDER,
        META_INSIGHTS_BREAKDOWNS.AGE_AND_GENDER,
        META_INSIGHTS_BREAKDOWNS.COUNTRY,
        META_INSIGHTS_BREAKDOWNS.PUBLISHER_PLATFORM,
        META_INSIGHTS_BREAKDOWNS.DEVICE_PLATFORM,
      ] as string[];

      const requestedBreakdown =
        req.query.breakdown === undefined
          ? META_INSIGHTS_BREAKDOWNS.PUBLISHER_PLATFORM
          : req.query.breakdown;

      if (
        typeof requestedBreakdown !== "string" ||
        !allowedBreakdowns.includes(requestedBreakdown)
      ) {
        return res.status(400).json({
          success: false,
          message: "Unsupported breakdown",
          allowedBreakdowns,
        });
      }

      // 3. Validate date filter
      const dateFilterResult = buildInsightsDateFilter({
        datePreset: req.query.datePreset,
        since: req.query.since,
        until: req.query.until,
      });

      if (!dateFilterResult.success) {
        return res.status(400).json({
          success: false,
          message: dateFilterResult.message,
        });
      }

      // 4. Read access token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // 5. Configure Insights request
      const params = new URLSearchParams({
        fields: [
          "ad_id",
          "ad_name",
          "campaign_id",
          "campaign_name",
          "adset_id",
          "adset_name",
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "date_start",
          "date_stop",
        ].join(","),
        level: META_INSIGHTS_LEVELS.AD,
        breakdowns: requestedBreakdown,
      });

      // 6. Apply date filter
      dateFilterResult.params.forEach((value, key) => {
        params.set(key, value);
      });

      // 7. Build Meta API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // 8. Call Meta
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json();

      // 9. Handle Meta errors
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to retrieve breakdown insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // 10. Return breakdown report
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level: META_INSIGHTS_LEVELS.AD,
        breakdown: requestedBreakdown,
        dateFilter: dateFilterResult.dateFilter,
        count: result.data?.length ?? 0,
        insights: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Breakdowns Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

router.get(
  "/meta/ad-accounts/:adAccountId/insights/filter",
  async (req: Request, res: Response) => {
    try {
      // 1. Validate Ad Account ID
      const adAccountId = String(
        req.params.adAccountId
      ).replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // 2. Validate reporting level
      const allowedLevels = [
        META_INSIGHTS_LEVELS.CAMPAIGN,
        META_INSIGHTS_LEVELS.ADSET,
        META_INSIGHTS_LEVELS.AD,
      ] as string[];

      const level = req.query.level === undefined
        ? META_INSIGHTS_LEVELS.AD
        : req.query.level;

      if (
        typeof level !== "string" ||
        !allowedLevels.includes(level)
      ) {
        return res.status(400).json({
          success: false,
          message: "Unsupported reporting level",
          allowedLevels,
        });
      }

      // 3. Validate date range
      const dateFilterResult = buildInsightsDateFilter({
        datePreset: req.query.datePreset,
        since: req.query.since,
        until: req.query.until,
      });

      if (!dateFilterResult.success) {
        return res.status(400).json({
          success: false,
          message: dateFilterResult.message,
        });
      }

      // 4. Allow only selected filter targets
      const idFields = [
        META_FILTER_TARGETS.CAMPAIGN_ID,
        META_FILTER_TARGETS.ADSET_ID,
        META_FILTER_TARGETS.AD_ID,
      ] as string[];

      const nameFields = [
        META_FILTER_TARGETS.CAMPAIGN_NAME,
        META_FILTER_TARGETS.ADSET_NAME,
        META_FILTER_TARGETS.AD_NAME,
      ] as string[];

      const allowedFilterFields = [
        ...idFields,
        ...nameFields,
      ];

      const filterField = req.query.filterField;
      const operator = req.query.operator;
      const filterValue = req.query.filterValue;

      const filterProvided = [
        filterField,
        operator,
        filterValue,
      ].some((value) => value !== undefined);

      let filtering: Array<{
        field: string;
        operator: string;
        value: string | string[];
      }> = [];

      if (filterProvided) {
        if (
          typeof filterField !== "string" ||
          typeof operator !== "string" ||
          typeof filterValue !== "string" ||
          !filterValue.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "filterField, operator and filterValue are required together",
          });
        }

        if (!allowedFilterFields.includes(filterField)) {
          return res.status(400).json({
            success: false,
            message: "Unsupported filter field",
            allowedFilterFields,
          });
        }

        const isIdField = idFields.includes(filterField);

        const supportedOperators = isIdField
          ? [
            META_FILTER_OPERATORS.EQUAL,
            META_FILTER_OPERATORS.IN,
          ]
          : [
            META_FILTER_OPERATORS.EQUAL,
            META_FILTER_OPERATORS.CONTAIN,
          ];

        if (!supportedOperators.includes(operator as never)) {
          return res.status(400).json({
            success: false,
            message: "Unsupported operator for this field",
            supportedOperators,
          });
        }

        let parsedValue: string | string[] =
          filterValue.trim();

        if (isIdField) {
          const ids = filterValue
            .split(",")
            .map((id) => id.trim());

          if (
            ids.some((id) => !/^\d+$/.test(id)) ||
            (operator === META_FILTER_OPERATORS.EQUAL &&
              ids.length !== 1)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "ID filters require valid numeric IDs",
            });
          }

          parsedValue =
            operator === META_FILTER_OPERATORS.IN
              ? ids
              : ids[0];
        }

        filtering = [
          {
            field: filterField,
            operator,
            value: parsedValue,
          },
        ];
      }

      // 5. Validate sorting
      const allowedSortFields = [
        "spend",
        "impressions",
        "clicks",
        "reach",
        "ctr",
        "cpc",
        "cpm",
      ];

      const sortBy =
        req.query.sortBy === undefined
          ? "spend"
          : req.query.sortBy;

      const sortDirection =
        req.query.sortDirection === undefined
          ? "descending"
          : req.query.sortDirection;

      if (
        typeof sortBy !== "string" ||
        !allowedSortFields.includes(sortBy) ||
        (sortDirection !== "ascending" &&
          sortDirection !== "descending")
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid sort parameters",
          allowedSortFields,
          allowedDirections: [
            "ascending",
            "descending",
          ],
        });
      }

      // 6. Retrieve access token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // 7. Configure Insights request
      const params = new URLSearchParams({
        fields: [
          "campaign_id",
          "campaign_name",
          "adset_id",
          "adset_name",
          "ad_id",
          "ad_name",
          "impressions",
          "reach",
          "clicks",
          "spend",
          "ctr",
          "cpc",
          "cpm",
          "date_start",
          "date_stop",
        ].join(","),
        level,
        sort: `${sortBy}_${sortDirection}`,
      });

      // Add filtering only when supplied
      if (filtering.length > 0) {
        params.set(
          "filtering",
          JSON.stringify(filtering)
        );
      }

      // Add dynamic date parameters
      dateFilterResult.params.forEach((value, key) => {
        params.set(key, value);
      });

      // 8. Build Graph API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // 9. Send request to Meta
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json();

      // 10. Handle Meta errors
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to retrieve filtered insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // 11. Return results
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level,
        dateFilter: dateFilterResult.dateFilter,
        appliedFilters: filtering,
        sorting: {
          field: sortBy,
          direction: sortDirection,
        },
        count: result.data?.length ?? 0,
        insights: result.data ?? [],
        paging: result.paging ?? null,
      });
    } catch (error) {
      console.error("Filtered Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);



router.get(
  "/meta/ad-accounts/:adAccountId/insights/paginated",
  async (req: Request, res: Response) => {
    try {
      // 1. Validate Ad Account ID
      const adAccountId = String(
        req.params.adAccountId
      ).replace(/^act_/, "");

      if (!/^\d+$/.test(adAccountId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Ad Account ID",
        });
      }

      // 2. Validate reporting level
      const allowedLevels = Object.values(
        META_INSIGHTS_LEVELS
      ) as string[];

      const level =
        req.query.level === undefined
          ? META_INSIGHTS_LEVELS.AD
          : req.query.level;

      if (
        typeof level !== "string" ||
        !allowedLevels.includes(level)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid reporting level",
          allowedLevels,
        });
      }

      // 3. Validate page size
      const rawLimit = req.query.limit ?? "25";

      if (
        typeof rawLimit !== "string" ||
        !/^\d+$/.test(rawLimit)
      ) {
        return res.status(400).json({
          success: false,
          message: "limit must be an integer between 1 and 100",
        });
      }

      const limit = Number(rawLimit);

      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "limit must be between 1 and 100",
        });
      }

      // 4. Validate cursor
      const after = req.query.after;

      if (
        after !== undefined &&
        (
          typeof after !== "string" ||
          after.length === 0 ||
          after.length > 2048
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid after cursor",
        });
      }

      // 5. Validate date filter
      const dateFilterResult = buildInsightsDateFilter({
        datePreset: req.query.datePreset,
        since: req.query.since,
        until: req.query.until,
      });

      if (!dateFilterResult.success) {
        return res.status(400).json({
          success: false,
          message: dateFilterResult.message,
        });
      }

      // 6. Read Meta token
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          message: "Meta access token not found",
        });
      }

      // 7. Select fields for the reporting level
      const fieldsByLevel: Record<string, string[]> = {
        account: [
          "account_id",
          "impressions",
          "clicks",
          "spend",
          "date_start",
          "date_stop",
        ],
        campaign: [
          "campaign_id",
          "campaign_name",
          "impressions",
          "clicks",
          "spend",
          "date_start",
          "date_stop",
        ],
        adset: [
          "adset_id",
          "adset_name",
          "campaign_id",
          "impressions",
          "clicks",
          "spend",
          "date_start",
          "date_stop",
        ],
        ad: [
          "ad_id",
          "ad_name",
          "adset_id",
          "campaign_id",
          "impressions",
          "clicks",
          "spend",
          "date_start",
          "date_stop",
        ],
      };

      const params = new URLSearchParams({
        fields: fieldsByLevel[level].join(","),
        level,
        limit: String(limit),
      });

      // 8. Apply preset or custom date range
      dateFilterResult.params.forEach((value, key) => {
        params.set(key, value);
      });

      // 9. Apply cursor only if supplied
      if (typeof after === "string") {
        params.set("after", after);
      }

      // 10. Build Meta Graph API URL
      const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

      const url =
        `https://graph.facebook.com/${graphApiVersion}` +
        `/act_${adAccountId}/insights?${params.toString()}`;

      // 11. Request one page from Meta
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json();

      // 12. Handle errors
      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Failed to fetch paginated insights",
          metaError: {
            type: result.error?.type,
            code: result.error?.code,
            subcode: result.error?.error_subcode,
            fbtraceId: result.error?.fbtrace_id,
          },
        });
      }

      // 13. Extract pagination metadata
      // Do not return Meta's raw paging.next URL:
      // it can contain authentication information.
      const hasNextPage = Boolean(result.paging?.next);

      const nextCursor = hasNextPage
        ? result.paging?.cursors?.after ?? null
        : null;

      // 14. Return frontend-friendly response
      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        level,
        dateFilter: dateFilterResult.dateFilter,
        pagination: {
          limit,
          count: result.data?.length ?? 0,
          hasNextPage,
          nextCursor,
        },
        insights: result.data ?? [],
      });
    } catch (error) {
      console.error("Paginated Insights Error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);


export default router;

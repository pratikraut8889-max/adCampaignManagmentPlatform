import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Meta Pixel / Dataset routes for the Meta Ads learning project.
 *
 * Expected project layout:
 *   project-root/
 *     data/token.json
 *     routes/meta-pixels.routes.ts
 *     src/server.ts
 *
 * Routes in this module:
 *   GET  /meta/ad-accounts/:adAccountId/pixels
 *   GET  /meta/pixels/:pixelId
 *   POST /meta/ad-accounts/:adAccountId/pixels
 *
 * Notes:
 * - The create endpoint creates a Meta asset; call it only intentionally.
 * - The access token is read server-side and is never returned in API responses.
 * - This module does not create or expose a Conversions API token. Configure that
 *   separately and store it securely server-side when implementing CAPI.
 */

const router = Router();
const { META_GRAPH_API_VERSION = "v25.0" } = process.env;

interface TokenFile {
  access_token?: string;
}

interface MetaApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface MetaApiResponse<T> {
  data?: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
  error?: MetaApiError;
  id?: string;
  name?: string;
  last_fired_time?: string | null;
  creation_time?: string;
}

interface MetaPixel {
  id: string;
  name?: string;
  last_fired_time?: string | null;
  creation_time?: string;
}

async function readAccessToken(): Promise<string | undefined> {
  try {
    // This path matches the existing project's root/data/token.json convention.
    // Override it with META_TOKEN_FILE if your project stores the file elsewhere.
    const tokenFile = process.env.META_TOKEN_FILE
      ? path.resolve(process.env.META_TOKEN_FILE)
      : path.join(import.meta.dirname, "..", "data", "token.json");

    const contents = await fs.readFile(tokenFile, "utf8");
    const tokenData = JSON.parse(contents) as TokenFile;
    return tokenData.access_token;
  } catch {
    return undefined;
  }
}

function normalizeAdAccountId(rawId: string): string {
  return rawId.replace(/^act_/, "");
}

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function sendMetaError(
  res: Response,
  result: MetaApiResponse<unknown>,
  fallbackMessage: string,
) {
  const error = result.error;
  return res.status(502).json({
    success: false,
    error: error?.message || fallbackMessage,
    metaErrorType: error?.type,
    metaErrorCode: error?.code,
    metaErrorSubcode: error?.error_subcode,
    fbtraceId: error?.fbtrace_id,
  });
}

async function requestMeta<T>(
  url: URL,
  accessToken: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; result: MetaApiResponse<T> }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  const result = (await response.json()) as MetaApiResponse<T>;
  return { ok: response.ok, status: response.status, result };
}

function buildGraphUrl(pathname: string): URL {
  return new URL(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}${pathname}`,
  );
}

// -----------------------------------------------------------------------------
// 1. List Pixels connected to an Ad Account, with cursor pagination.
// GET /meta/ad-accounts/:adAccountId/pixels?limit=25&after=CURSOR
// -----------------------------------------------------------------------------
router.get(
  "/meta/ad-accounts/:adAccountId/pixels",
  async (req: Request, res: Response) => {
    try {
      const adAccountId = normalizeAdAccountId(String(req.params.adAccountId));

      if (!isNumericId(adAccountId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Ad Account ID. Provide a numeric ID, optionally prefixed with act_.",
        });
      }

      const rawLimit = Number(req.query.limit ?? 25);
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
        return res.status(400).json({
          success: false,
          error: "limit must be an integer between 1 and 100",
        });
      }

      const after = typeof req.query.after === "string" ? req.query.after : undefined;
      const accessToken = await readAccessToken();

      if (!accessToken) {
        return res.status(401).json({
          success: false,
          error: "Meta access token not found. Connect Meta Ads first.",
        });
      }

      const url = buildGraphUrl(`/act_${adAccountId}/adspixels`);
      url.searchParams.set("fields", "id,name,last_fired_time");
      url.searchParams.set("limit", String(rawLimit));
      if (after) url.searchParams.set("after", after);

      const { ok, result } = await requestMeta<MetaPixel>(url, accessToken);
      if (!ok || result.error) {
        return sendMetaError(res, result, "Failed to list Meta Pixels.");
      }

      const pixels = result.data ?? [];
      const hasNextPage = Boolean(result.paging?.next);

      return res.status(200).json({
        success: true,
        adAccountId: `act_${adAccountId}`,
        count: pixels.length,
        pixels,
        pagination: {
          limit: rawLimit,
          hasNextPage,
          nextCursor: hasNextPage ? result.paging?.cursors?.after ?? null : null,
        },
      });
    } catch (error) {
      console.error("List Meta Pixels Error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error while listing Meta Pixels.",
      });
    }
  },
);

// -----------------------------------------------------------------------------
// 2. Retrieve details for one Pixel / Dataset.
// GET /meta/pixels/:pixelId
// -----------------------------------------------------------------------------
router.get(
  "/meta/pixels/:pixelId",
  async (req: Request, res: Response) => {
    try {
      const pixelId = String(req.params.pixelId);

      if (!isNumericId(pixelId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Pixel ID. A numeric ID is required.",
        });
      }

      const accessToken = await readAccessToken();
      if (!accessToken) {
        return res.status(401).json({
          success: false,
          error: "Meta access token not found. Connect Meta Ads first.",
        });
      }

      const url = buildGraphUrl(`/${pixelId}`);
      url.searchParams.set("fields", "id,name,last_fired_time,creation_time");

      const { ok, result } = await requestMeta<MetaPixel>(url, accessToken);
      if (!ok || result.error) {
        return sendMetaError(res, result, "Failed to retrieve Pixel details.");
      }

      return res.status(200).json({
        success: true,
        pixel: result,
      });
    } catch (error) {
      console.error("Get Meta Pixel Details Error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error while retrieving Pixel details.",
      });
    }
  },
);

// -----------------------------------------------------------------------------
// 3. Create a Pixel under an Ad Account.
// POST /meta/ad-accounts/:adAccountId/pixels
// Body: { "name": "Website Conversion Pixel" }
// -----------------------------------------------------------------------------
router.post(
  "/meta/ad-accounts/:adAccountId/pixels",
  async (req: Request, res: Response) => {
    try {
      const adAccountId = normalizeAdAccountId(String(req.params.adAccountId));

      if (!isNumericId(adAccountId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Ad Account ID. Provide a numeric ID, optionally prefixed with act_.",
        });
      }

      const name: unknown = req.body?.name;
      if (typeof name !== "string" || !name.trim() || name.trim().length > 255) {
        return res.status(400).json({
          success: false,
          error: "A non-empty Pixel name of at most 255 characters is required.",
        });
      }

      const accessToken = await readAccessToken();
      if (!accessToken) {
        return res.status(401).json({
          success: false,
          error: "Meta access token not found. Connect Meta Ads first.",
        });
      }

      const url = buildGraphUrl(`/act_${adAccountId}/adspixels`);
      const body = new URLSearchParams({ name: name.trim() });

      const { ok, result } = await requestMeta<MetaPixel>(url, accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!ok || result.error) {
        return sendMetaError(res, result, "Failed to create Meta Pixel.");
      }

      if (!result.id) {
        return res.status(502).json({
          success: false,
          error: "Meta did not return a Pixel ID.",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Meta Pixel created successfully.",
        adAccountId: `act_${adAccountId}`,
        pixel: {
          id: result.id,
          name: result.name ?? name.trim(),
        },
      });
    } catch (error) {
      console.error("Create Meta Pixel Error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error while creating Meta Pixel.",
      });
    }
  },
);

export default router;

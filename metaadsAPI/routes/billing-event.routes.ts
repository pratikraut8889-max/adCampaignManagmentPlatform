import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
const router = Router();

const {
    META_GRAPH_API_VERSION = "v25.0",
} = process.env;

// Starter allowlist for this learning route.
const SUPPORTED_BILLING_EVENTS = [
    "IMPRESSIONS",
    "LINK_CLICKS",
] as const;

type BillingEvent =
    (typeof SUPPORTED_BILLING_EVENTS)[number];

interface MetaApiResult {
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
}

/**
 * Read the Meta access token from the local token.json file.
 */
async function readAccessToken(): Promise<string | undefined> {
    try {
        const tokenFile = path.join(
            import.meta.dirname,
            "..",
            "data",
            "token.json",
        );

        const fileContents = await fs.readFile(
            tokenFile,
            "utf-8",
        );

        const tokenData = JSON.parse(fileContents) as {
            access_token?: string;
        };

        return tokenData.access_token;
    } catch {
        return undefined;
    }
}

/**
 * Read Ad Set details required for billing-event validation.
 */
async function getAdSetBillingInfoFromMeta(
    adSetId: string,
    accessToken: string,
): Promise<MetaApiResult> {
    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
    );

    url.searchParams.set(
        "fields",
        "id,name,status,campaign_id,optimization_goal,billing_event",
    );

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const data = (await response.json()) as Record<
        string,
        unknown
    >;

    return {
        ok: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Request a billing-event update from Meta.
 * The Ad Set is explicitly kept PAUSED.
 */
async function updateBillingEventInMeta(
    adSetId: string,
    accessToken: string,
    billingEvent: BillingEvent,
): Promise<MetaApiResult> {
    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
    );

    const body = new URLSearchParams();

    body.set("billing_event", billingEvent);
    body.set("status", "PAUSED");

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    const data = (await response.json()) as Record<
        string,
        unknown
    >;

    return {
        ok: response.ok,
        status: response.status,
        data,
    };
}

/**
 * GET /meta/adsets/:adSetId/billing-event
 *
 * Read the current billing event.
 */
router.get(
    "/meta/adsets/:adSetId/billing-event",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;

        if (!accessToken) {
            return res.status(401).json({
                error: "Connect your Meta account first.",
            });
        }

        if (!/^\d+$/.test(adSetId)) {
            return res.status(400).json({
                error: "Invalid Ad Set ID.",
            });
        }

        try {
            const result =
                await getAdSetBillingInfoFromMeta(
                    adSetId,
                    accessToken,
                );

            if (!result.ok) {
                console.error(
                    "Meta billing-event read error:",
                    result.data,
                );

                return res.status(result.status).json({
                    error: "Could not retrieve billing event.",
                    metaError: result.data,
                });
            }

            return res.json({
                message: "Billing event retrieved successfully.",
                data: result.data,
            });
        } catch (error) {
            console.error(
                "Billing-event read failed:",
                error instanceof Error
                    ? error.message
                    : "Unknown error",
            );

            return res.status(502).json({
                error: "Could not reach Meta Graph API.",
            });
        }
    },
);

/**
 * POST /meta/adsets/:adSetId/billing-event
 *
 * Update the billing event while keeping the Ad Set paused.
 *
 * Body: { "billingEvent": "IMPRESSIONS" }
 */
router.post(
    "/meta/adsets/:adSetId/billing-event",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;

        const requestBody = req.body as
            | { billingEvent?: unknown }
            | undefined;

        const billingEvent = requestBody?.billingEvent;

        if (!accessToken) {
            return res.status(401).json({
                error: "Connect your Meta account first.",
            });
        }

        if (!/^\d+$/.test(adSetId)) {
            return res.status(400).json({
                error: "Invalid Ad Set ID.",
            });
        }

        // Validate the value before making any update request.
        if (
            typeof billingEvent !== "string" ||
            !SUPPORTED_BILLING_EVENTS.includes(
                billingEvent as BillingEvent,
            )
        ) {
            return res.status(400).json({
                error: "Invalid billing event.",
                supportedBillingEvents:
                    SUPPORTED_BILLING_EVENTS,
            });
        }

        try {
            // First read the Ad Set's current status.
            const currentAdSet =
                await getAdSetBillingInfoFromMeta(
                    adSetId,
                    accessToken,
                );

            if (!currentAdSet.ok) {
                console.error(
                    "Meta Ad Set validation error:",
                    currentAdSet.data,
                );

                return res.status(currentAdSet.status).json({
                    error: "Could not validate the Ad Set.",
                    metaError: currentAdSet.data,
                });
            }

            const currentStatus =
                currentAdSet.data.status;

            if (currentStatus !== "PAUSED") {
                return res.status(409).json({
                    error:
                        "This learning route only updates billing events on PAUSED Ad Sets.",
                    currentStatus,
                });
            }

            // Meta will make the final compatibility check.
            const updateResult =
                await updateBillingEventInMeta(
                    adSetId,
                    accessToken,
                    billingEvent as BillingEvent,
                );

            if (!updateResult.ok) {
                console.error(
                    "Meta billing-event update error:",
                    updateResult.data,
                );

                return res.status(updateResult.status).json({
                    error:
                        "Meta rejected the billing-event update.",
                    metaError: updateResult.data,
                });
            }

            return res.json({
                message:
                    "Billing-event update request succeeded. The Ad Set was kept PAUSED.",
                requestedBillingEvent: billingEvent,
                metaResponse: updateResult.data,
            });
        } catch (error) {
            console.error(
                "Billing-event update failed:",
                error instanceof Error
                    ? error.message
                    : "Unknown error",
            );

            return res.status(502).json({
                error: "Could not reach Meta Graph API.",
            });
        }
    },
);

export default router;
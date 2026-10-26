import { Router, type Request, type Response } from "express";
import readAccessToken from "../config.js";

const router = Router();

const META_GRAPH_API_VERSION =
    process.env.META_GRAPH_API_VERSION || "v25.0";



const PERFORMANCE_GOALS_BY_OBJECTIVE: Record<string, string[]> = {
    OUTCOME_AWARENESS: [
        "REACH",
        "IMPRESSIONS",
        "AD_RECALL_LIFT",
    ],

    OUTCOME_TRAFFIC: [
        "LANDING_PAGE_VIEWS",
        "LINK_CLICKS",
        "IMPRESSIONS",
        "REACH",
        "CONVERSATIONS",
        "OFFSITE_CONVERSIONS",
        "POST_ENGAGEMENT",
        "THRUPLAY",
    ],

    OUTCOME_ENGAGEMENT: [
        "POST_ENGAGEMENT",
        "CONVERSATIONS",
        "THRUPLAY",
        "EVENT_RESPONSES",
        "PAGE_LIKES",
        "IMPRESSIONS",
        "REACH",
        "LINK_CLICKS",
        "LANDING_PAGE_VIEWS",
        "OFFSITE_CONVERSIONS",
    ],

    OUTCOME_LEADS: [
        "LEAD_GENERATION",
        "QUALITY_LEAD",
        "QUALITY_CALL",
        "OFFSITE_CONVERSIONS",
        "LANDING_PAGE_VIEWS",
        "LINK_CLICKS",
        "IMPRESSIONS",
        "REACH",
        "CONVERSATIONS",
    ],

    OUTCOME_APP_PROMOTION: [
        "APP_INSTALLS",
        "OFFSITE_CONVERSIONS",
        "IMPRESSIONS",
        "LINK_CLICKS",
        "REACH",
        "VALUE",
    ],

    OUTCOME_SALES: [
        "OFFSITE_CONVERSIONS",
        "VALUE",
        "LANDING_PAGE_VIEWS",
        "IMPRESSIONS",
        "REACH",
        "LINK_CLICKS",
        "CONVERSATIONS",
    ],
};



async function validatePerformanceGoalInMeta(
    adSetId: string,
    accessToken: string,
    optimizationGoal: string
): Promise<void> {
    const graphApiVersion =
        process.env.META_GRAPH_API_VERSION || "v25.0";

    const url =
        `https://graph.facebook.com/${graphApiVersion}/${adSetId}`;

    const requestBody = new URLSearchParams();

    requestBody.set("optimization_goal", optimizationGoal);
    requestBody.set(
        "execution_options",
        JSON.stringify(["validate_only"])
    );
    requestBody.set("access_token", accessToken);

    const response = await fetch(url, {
        method: "POST",
        body: requestBody
    });

    const data = await response.json() as {
        error?: {
            message?: string;
            code?: number;
            error_subcode?: number;
        };
    };

    if (!response.ok || data.error) {
        const message =
            data.error?.message ||
            "Meta could not validate the requested Performance Goal.";

        throw new Error(message);
    }
}


async function getCampaignObjectiveFromMeta(
    campaignId: string,
    accessToken: string
): Promise<string> {
    const graphVersion =
        process.env.META_GRAPH_API_VERSION ?? "v25.0";

    const url = new URL(
        `https://graph.facebook.com/${graphVersion}/${campaignId}`
    );

    url.searchParams.set("fields", "id,objective");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url);
    const result = (await response.json()) as {
        id?: string;
        objective?: string;
        error?: { message?: string };
    };

    if (!response.ok || result.error) {
        throw new Error(
            result.error?.message ?? "Failed to read campaign objective from Meta"
        );
    }

    if (!result.objective) {
        throw new Error("Meta did not return the campaign objective");
    }

    return result.objective;
}
// Separate function: GET performance goal from Meta
async function getPerformanceGoalFromMeta(
    adSetId: string,
    accessToken: string
) {
    const url = new URL(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(adSetId)}`
    );

    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
        "fields",
        "id,name,status,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount"
    );

    const response = await fetch(url);
    const data: any = await response.json();

    if (!response.ok || data.error) {
        throw new Error(
            data.error?.message ||
            "Failed to retrieve performance goal from Meta."
        );
    }

    return data;
}

// Separate function: POST performance goal to Meta
async function updatePerformanceGoalInMeta(
    adSetId: string,
    accessToken: string,
    optimizationGoal: string
) {
    const url =
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(adSetId)}`;

    const body = new URLSearchParams({
        optimization_goal: optimizationGoal,
        status: "PAUSED",
        access_token: accessToken,
    });

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    const data: any = await response.json();

    if (!response.ok || data.error) {
        throw new Error(
            data.error?.message ||
            "Failed to update performance goal in Meta."
        );
    }

    return data;
}

// GET: Read current performance goal
router.get(
    "/meta/adsets/:adSetId/performance-goal",
    async (req: Request, res: Response) => {
        try {
            const accessToken = readAccessToken();
            const { adSetId }: any = req.params;

            const data = await getPerformanceGoalFromMeta(
                adSetId,
                accessToken
            );

            return res.status(200).json({
                message: "Performance goal retrieved successfully.",
                data,
            });
        } catch (error) {
            const err = error as Error;

            return res.status(400).json({
                error: "Failed to read performance goal.",
                message: err.message,
            });
        }
    }
);

// POST: Update performance goal
router.post(
    "/meta/adsets/:adSetId/performance-goal",
    async (req, res) => {
        try {
            const { adSetId } = req.params;
            const { optimizationGoal } = req.body as {
                optimizationGoal?: string;
            };

            // 1. Validate the request body.
            if (
                typeof optimizationGoal !== "string" ||
                !optimizationGoal.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error: "optimizationGoal is required",
                });
            }

            const requestedGoal = optimizationGoal
                .trim()
                .toUpperCase();

            // 2. Read the saved access token.
            const accessToken = readAccessToken();

            // 3. Read the current Ad Set BEFORE any update.
            const adSet = await getPerformanceGoalFromMeta(
                adSetId,
                accessToken
            );

            // 4. Only allow changes to paused Ad Sets.
            if (adSet.status !== "PAUSED") {
                return res.status(409).json({
                    success: false,
                    error:
                        "The Ad Set must be PAUSED before changing its performance goal",
                    currentStatus: adSet.status,
                    metaUpdateAttempted: false,
                });
            }

            if (!adSet.campaign_id) {
                return res.status(400).json({
                    success: false,
                    error: "The Ad Set does not contain a campaign_id",
                    metaUpdateAttempted: false,
                });
            }

            // 5. Read the parent Campaign's objective.
            const campaignObjective =
                await getCampaignObjectiveFromMeta(
                    adSet.campaign_id,
                    accessToken
                );

            // 6. Find the goals configured for this objective.
            const goalsForObjective =
                PERFORMANCE_GOALS_BY_OBJECTIVE[campaignObjective];

            if (!goalsForObjective) {
                return res.status(400).json({
                    success: false,
                    error:
                        "No performance-goal list is configured for this objective",
                    campaignObjective,
                    metaUpdateAttempted: false,
                });
            }

            // 7. Reject unsupported goals BEFORE calling Meta validation.
            if (!goalsForObjective.includes(requestedGoal)) {
                return res.status(400).json({
                    success: false,
                    error:
                        "This goal is not in the application's current allowlist for this objective",
                    campaignObjective,
                    requestedGoal,
                    goalsInAllowlist: goalsForObjective,
                    metaUpdateAttempted: false,
                });
            }

            // 8. Ask Meta to validate the proposed change.
            try {
                await validatePerformanceGoalInMeta(
                    adSetId,
                    accessToken,
                    requestedGoal
                );
            } catch (error: unknown) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Meta validation request failed.";

                return res.status(502).json({
                    success: false,
                    message:
                        "Meta validation failed. No update was made.",
                    details: message,
                    metaUpdateAttempted: false,
                });
            }

            // 9. Only now perform the actual update.
            const updatedAdSet =
                await updatePerformanceGoalInMeta(
                    adSetId,
                    accessToken,
                    requestedGoal
                );

            return res.status(200).json({
                message: "Performance-goal update request completed",
                campaignObjective,
                requestedGoal,
                status: "PAUSED",
                data: updatedAdSet,
            });
        } catch (error: unknown) {
            console.error("Performance-goal route error:", error);

            return res.status(500).json({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to process performance-goal request",
            });
        }
    }
);
export default router;

import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";

const router = Router();
const TARGETING_UPDATE_COOLDOWN_MS = 31_000;

// Tracks targeting-update attempts by Ad Set ID.
const targetingUpdateAttempts = new Map<string, number>();
const {
    META_GRAPH_API_VERSION = "v25.0",
} = process.env;

/**
 *  Get the Meta access token from the local token.json file.
 * @returns  promise
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
 * Get Ad Sets belonging to a campaign.
 * GET /meta/campaigns/:campaignId/adsets
 */
router.get(
    "/meta/campaigns/:campaignId/adsets",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { campaignId } = req.params;

        if (!accessToken) {
            return res.status(401).json({
                error: "Connect your Meta account first.",
            });
        }

        if (!/^\d+$/.test(campaignId)) {
            return res.status(400).json({
                error: "Invalid campaign ID.",
            });
        }

        try {
            const url = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${campaignId}/adsets`,
            );

            url.searchParams.set(
                "fields",
                [
                    "id",
                    "name",
                    "campaign_id",
                    "status",
                    "effective_status",
                    "daily_budget",
                    "lifetime_budget",
                    "optimization_goal",
                    "targeting",
                ].join(","),
            );

            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Meta Ad Set fetch error:", data);

                return res.status(response.status).json({
                    error: "Failed to fetch Ad Sets.",
                    details: data,
                });
            }

            return res.json({
                message: "Ad Sets fetched successfully.",
                data,
            });
        } catch (error) {
            console.error(
                "Ad Set request failed:",
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
 * Create an Ad Set under an existing ad campaign.
 * POST /meta/ad-accounts/:adAccountId/adsets
 */
router.post(
    "/meta/ad-accounts/:adAccountId/adsets",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adAccountId } = req.params;

        const {
            campaignId,
            name,
            countryCode,
            dailyBudget,
        } = req.body ?? {};

        if (!accessToken) {
            return res.status(401).json({
                error: "Connect your Meta account first.",
            });
        }

        if (!/^act_\d+$/.test(adAccountId)) {
            return res.status(400).json({
                error: "Invalid ad account ID. Use the act_ prefix.",
            });
        }

        if (
            typeof campaignId !== "string" ||
            !/^\d+$/.test(campaignId)
        ) {
            return res.status(400).json({
                error: "A valid campaignId is required.",
            });
        }

        if (
            typeof name !== "string" ||
            name.trim().length === 0
        ) {
            return res.status(400).json({
                error: "Ad Set name is required.",
            });
        }

        const country =
            typeof countryCode === "string"
                ? countryCode.toUpperCase()
                : "";

        if (!/^[A-Z]{2}$/.test(country)) {
            return res.status(400).json({
                error: "Provide a two-letter countryCode.",
            });
        }


        const rupeesText = String(dailyBudget ?? "");

        const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(
            rupeesText,
        );

        if (!match) {
            return res.status(400).json({
                error: "dailyBudgetRupees must be a positive amount with at most two decimal places.",
            });
        }

        const wholeRupees = Number(match[1]);
        const paise = Number((match[2] ?? "").padEnd(2, "0"));

        const budget = wholeRupees * 100 + paise;

        if (
            !Number.isSafeInteger(budget) ||
            budget <= 0
        ) {
            return res.status(400).json({
                error: "Budget must be a valid positive INR amount.",
            });
        }



        try {
            const url = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/adsets`,
            );

            const body = new URLSearchParams();

            body.set("name", name.trim());
            body.set("campaign_id", campaignId);
            body.set("daily_budget", budget.toString());
            body.set("optimization_goal", "LINK_CLICKS");
            body.set("billing_event", "IMPRESSIONS");
            body.set("destination_type", "WEBSITE");
            body.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
            body.set("status", "PAUSED");

            body.set(
                "targeting",
                JSON.stringify({
                    geo_locations: {
                        countries: [country],
                    },
                }),
            );

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
                body,
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Meta Ad Set creation error:", data);

                return res.status(response.status).json({
                    error: "Failed to create Ad Set.",
                    details: data,
                });
            }

            return res.status(201).json({
                message: "Ad Set created successfully.",
                data,
            });
        } catch (error) {
            console.error(
                "Ad Set creation request failed:",
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
 * Update an Ad Set's name.
 * POST /meta/adsets/:adSetId/update
 */
router.post(
    "/meta/adsets/:adSetId/update",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;
        const { name } = req.body ?? {};

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

        if (
            typeof name !== "string" ||
            name.trim().length === 0
        ) {
            return res.status(400).json({
                error: "A valid Ad Set name is required.",
            });
        }

        try {
            const url = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
            );

            const body = new URLSearchParams();
            body.set("name", name.trim());

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Meta Ad Set update error:", data);

                return res.status(response.status).json({
                    error: "Failed to update Ad Set.",
                    details: data,
                });
            }

            return res.json({
                message: "Ad Set name updated successfully.",
                data,
            });
        } catch (error) {
            console.error(
                "Ad Set update request failed:",
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
 * Pause or resume an Ad Set.
 * POST /meta/adsets/:adSetId/status
 */
router.post(
    "/meta/adsets/:adSetId/status",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;
        const { status } = req.body ?? {};

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

        if (status !== "PAUSED" && status !== "ACTIVE") {
            return res.status(400).json({
                error: 'Status must be either "PAUSED" or "ACTIVE".',
            });
        }

        try {
            const url = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
            );

            const body = new URLSearchParams();
            body.set("status", status);

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Meta Ad Set status error:", data);

                return res.status(response.status).json({
                    error: "Failed to update Ad Set status.",
                    details: data,
                });
            }

            return res.json({
                message:
                    status === "PAUSED"
                        ? "Ad Set paused successfully."
                        : "Ad Set activated successfully.",
                data,
            });
        } catch (error) {
            console.error(
                "Ad Set status request failed:",
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
 * Update an Ad Set's daily budget.
 * POST /meta/adsets/:adSetId/budget
 */
router.post(
    "/meta/adsets/:adSetId/budget",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;
        const { dailyBudgetRupees } = req.body ?? {};

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

        // Accept a positive INR amount with up to two decimal places.
        const amountText = String(dailyBudgetRupees ?? "");
        const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(
            amountText,
        );

        if (!match) {
            return res.status(400).json({
                error:
                    "dailyBudgetRupees must be a positive INR amount with at most two decimal places.",
            });
        }

        const wholeRupees = Number(match[1]);
        const paise = Number((match[2] ?? "").padEnd(2, "0"));
        const budgetInPaise = wholeRupees * 100 + paise;

        if (
            !Number.isSafeInteger(budgetInPaise) ||
            budgetInPaise <= 0
        ) {
            return res.status(400).json({
                error: "Budget must be a valid positive INR amount.",
            });
        }

        try {
            const url = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
            );

            const body = new URLSearchParams();
            body.set("daily_budget", String(budgetInPaise));

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
                body,
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Meta budget update error:", data);

                return res.status(response.status).json({
                    error: "Failed to update Ad Set budget.",
                    details: data,
                });
            }

            return res.json({
                message:
                    "Ad Set daily budget updated successfully.",
                data,
            });
        } catch (error) {
            console.error(
                "Ad Set budget update request failed:",
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
 * Update an Ad Set's targeting.
 *
 * POST /meta/adsets/:adSetId/targeting
 *
 * Supports:
 * - One country: countryCode
 * - Multiple countries: countryCodes
 * - Minimum age: ageMin
 * - Maximum age: ageMax
 *
 * Safety:
 * - Ad Set must be PAUSED.
 * - Skips unchanged targeting.
 * - Enforces a local 31-second cooldown between changed-targeting attempts.
 */
router.post(
    "/meta/adsets/:adSetId/targeting",
    async (req, res) => {
        const accessToken = await readAccessToken();
        const { adSetId } = req.params;

        const {
            countryCode,
            countryCodes: requestedCountryCodes,
            ageMin,
            ageMax,
        } = req.body ?? {};

        // 1. Check access token.
        if (!accessToken) {
            return res.status(401).json({
                error: "Connect your Meta account first.",
            });
        }

        // 2. Validate Ad Set ID.
        if (!/^\d+$/.test(adSetId)) {
            return res.status(400).json({
                error: "Invalid Ad Set ID.",
            });
        }

        // 3. Require at least one targeting field.
        if (
            countryCode === undefined &&
            requestedCountryCodes === undefined &&
            ageMin === undefined &&
            ageMax === undefined
        ) {
            return res.status(400).json({
                error:
                    "Provide countryCode, countryCodes, ageMin, or ageMax.",
            });
        }

        // 4. Accept either countryCode or countryCodes.
        if (
            countryCode !== undefined &&
            requestedCountryCodes !== undefined
        ) {
            return res.status(400).json({
                error:
                    "Provide either countryCode or countryCodes, not both.",
            });
        }

        let countries: string[] | undefined;

        if (requestedCountryCodes !== undefined) {
            if (
                !Array.isArray(requestedCountryCodes) ||
                requestedCountryCodes.length === 0 ||
                !requestedCountryCodes.every(
                    (code: unknown) =>
                        typeof code === "string" &&
                        /^[A-Za-z]{2}$/.test(code),
                )
            ) {
                return res.status(400).json({
                    error:
                        "countryCodes must be a non-empty array of two-letter country codes.",
                });
            }

            countries = [
                ...new Set(
                    (requestedCountryCodes as string[]).map(
                        (code) => code.toUpperCase(),
                    ),
                ),
            ];
        } else if (countryCode !== undefined) {
            if (
                typeof countryCode !== "string" ||
                !/^[A-Za-z]{2}$/.test(countryCode)
            ) {
                return res.status(400).json({
                    error:
                        "countryCode must be a two-letter country code, such as IN.",
                });
            }

            countries = [countryCode.toUpperCase()];
        }

        // 5. Validate age values.
        for (const [fieldName, value] of [
            ["ageMin", ageMin],
            ["ageMax", ageMax],
        ] as const) {
            if (value === undefined) {
                continue;
            }

            if (
                typeof value !== "number" ||
                !Number.isInteger(value) ||
                value < 18 ||
                value > 65
            ) {
                return res.status(400).json({
                    error:
                        `${fieldName} must be a whole number between 18 and 65.`,
                });
            }
        }

        try {
            // 6. Read the current Ad Set and targeting.
            const readUrl = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
            );

            readUrl.searchParams.set(
                "fields",
                "id,name,status,targeting",
            );

            const readResponse = await fetch(readUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const currentData: any = await readResponse.json();
            console.log("Existing Ad Set targeting:", JSON.stringify({
                status: currentData.status,
                targeting: currentData.targeting,
            }, null, 2));

            if (!readResponse.ok) {
                console.error(
                    "Meta Ad Set targeting read error:",
                    currentData,
                );

                return res.status(readResponse.status).json({
                    error: "Failed to read the existing Ad Set.",
                    details: currentData,
                });
            }

            // 7. Require the Ad Set to remain paused.
            if (currentData.status !== "PAUSED") {
                return res.status(409).json({
                    error:
                        "For safety, targeting can only be updated when the Ad Set is PAUSED.",
                    currentStatus: currentData.status,
                });
            }

            const existingTargeting = currentData.targeting;

            if (
                typeof existingTargeting !== "object" ||
                existingTargeting === null ||
                Array.isArray(existingTargeting)
            ) {
                return res.status(409).json({
                    error:
                        "Could not read the existing targeting configuration.",
                });
            }

            // 8. Read existing geo-location settings.
            const existingGeo = existingTargeting.geo_locations;

            const existingGeoLocations =
                typeof existingGeo === "object" &&
                    existingGeo !== null &&
                    !Array.isArray(existingGeo)
                    ? existingGeo as Record<string, unknown>
                    : {};

            const savedCountries = Array.isArray(
                existingGeoLocations.countries,
            )
                ? existingGeoLocations.countries
                    .filter(
                        (code: unknown): code is string =>
                            typeof code === "string",
                    )
                    .map((code: string) => code.toUpperCase())
                    .sort()
                : [];

            const requestedCountries =
                countries === undefined
                    ? undefined
                    : [...countries].sort();

            // 9. Check whether the requested country is unchanged.
            const countryUnchanged =
                requestedCountries === undefined ||
                (
                    savedCountries.length === requestedCountries.length &&
                    savedCountries.every(
                        (code, index) =>
                            code === requestedCountries[index],
                    )
                );

            // 10. Check whether the requested ages are unchanged.
            const ageMinUnchanged =
                ageMin === undefined ||
                Number(existingTargeting.age_min) === ageMin;

            const ageMaxUnchanged =
                ageMax === undefined ||
                Number(existingTargeting.age_max) === ageMax;

            // 11. Skip the Meta update if nothing changed.
            if (
                countryUnchanged &&
                ageMinUnchanged &&
                ageMaxUnchanged
            ) {
                return res.json({
                    message:
                        "Targeting is already up to date. No update request was sent to Meta.",
                    data: {
                        id: adSetId,
                        changed: false,
                        status: "PAUSED",
                    },
                });
            }

            // 12. Merge changes into the existing targeting object.
            const updatedTargeting = {
                ...existingTargeting,
                geo_locations: {
                    ...existingTargeting.geo_locations,
                    countries,
                },
            };

            // Advantage+ audience: update the age suggestion,
            // rather than changing the existing age controls.
            if (ageMin !== undefined || ageMax !== undefined) {
                const currentAgeRange = existingTargeting.age_range ?? [
                    existingTargeting.age_min ?? 18,
                    existingTargeting.age_max ?? 65,
                ];

                updatedTargeting.age_range = [
                    ageMin ?? currentAgeRange[0],
                    ageMax ?? currentAgeRange[1],
                ];
            }
            if (countries !== undefined) {
                updatedTargeting.geo_locations = {
                    ...existingGeoLocations,
                    countries,
                };
            }

            if (ageMin !== undefined) {
                updatedTargeting.age_min = ageMin;
            }

            if (ageMax !== undefined) {
                updatedTargeting.age_max = ageMax;
            }

            // 13. Validate the final age range.
            const finalAgeMin =
                updatedTargeting.age_min === undefined
                    ? 18
                    : updatedTargeting.age_min;

            const finalAgeMax =
                updatedTargeting.age_max === undefined
                    ? 65
                    : updatedTargeting.age_max;

            if (
                typeof finalAgeMin !== "number" ||
                typeof finalAgeMax !== "number" ||
                finalAgeMin > finalAgeMax
            ) {
                return res.status(400).json({
                    error:
                        "ageMin cannot be greater than ageMax.",
                });
            }

            // 14. Enforce cooldown before sending another update.
            const now = Date.now();
            const lastAttemptAt =
                targetingUpdateAttempts.get(adSetId);

            if (
                lastAttemptAt !== undefined &&
                now - lastAttemptAt <
                TARGETING_UPDATE_COOLDOWN_MS
            ) {
                const retryAfterSeconds = Math.ceil(
                    (
                        TARGETING_UPDATE_COOLDOWN_MS -
                        (now - lastAttemptAt)
                    ) / 1000,
                );

                res.setHeader(
                    "Retry-After",
                    String(retryAfterSeconds),
                );

                return res.status(429).json({
                    error:
                        "A targeting update was recently attempted. Please wait before trying again.",
                    retryAfterSeconds,
                });
            }

            // Record the attempt before making the external request.
            // This also prevents rapid concurrent requests in this process.
            targetingUpdateAttempts.set(adSetId, now);

            // 15. Send the updated targeting to Meta.
            const updateUrl = new URL(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adSetId}`,
            );

            const body = new URLSearchParams();

            body.set(
                "targeting",
                JSON.stringify(updatedTargeting),
            );

            // Explicitly keep the Ad Set paused.
            body.set("status", "PAUSED");

            const updateResponse = await fetch(updateUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
                body,
            });

            const updateData = await updateResponse.json();

            if (!updateResponse.ok) {
                console.error(
                    "Meta Ad Set targeting update error:",
                    updateData,
                );

                // Keep the cooldown after failure to avoid rapid retries.
                return res.status(updateResponse.status).json({
                    error:
                        "Failed to update Ad Set targeting.",
                    details: updateData,
                });
            }

            return res.json({
                message:
                    "Ad Set targeting updated successfully. Status remains PAUSED.",
                data: updateData,
            });
        } catch (error) {
            console.error(
                "Ad Set targeting request failed:",
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
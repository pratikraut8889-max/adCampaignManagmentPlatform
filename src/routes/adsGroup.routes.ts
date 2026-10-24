import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";
import { escapeGaqlString, getGoogleAdsConfig, getErrorMessage, GoogleAdsResult, googleAdsRequest, isValidId, GOOGLE_ADS_BASE_URL, AdGroupUpdate } from '../helper/shared.js'
import { parseMutationMode } from "../helper/safety.js";

const router = Router();


// -----------------------------------------------------------------------------
// GET /ad-groups
// Retrieve ad groups, optionally filtered by campaignId.
// -----------------------------------------------------------------------------

router.get("/ad-groups", async (req: Request, res: Response) => {
    try {
        const config = getGoogleAdsConfig(res);
        if (!config) return;

        const campaignId = req.query.campaignId;
        const status = req.query.status;
        const name = req.query.name;

        if (
            campaignId !== undefined &&
            (typeof campaignId !== "string" || !isValidId(campaignId))
        ) {
            return res.status(400).json({
                message: "campaignId must contain digits only.",
            });
        }

        if (
            status !== undefined &&
            (
                typeof status !== "string" ||
                !["ENABLED", "PAUSED"].includes(status)
            )
        ) {
            return res.status(400).json({
                message: "status must be ENABLED or PAUSED.",
            });
        }

        if (
            name !== undefined &&
            (
                typeof name !== "string" ||
                !name.trim() ||
                name.trim().length > 255
            )
        ) {
            return res.status(400).json({
                message: "name must be a non-empty string of at most 255 characters.",
            });
        }

        const filters: string[] = [
            "campaign.status != 'REMOVED'",
            "ad_group.status != 'REMOVED'",
        ];

        if (typeof campaignId === "string") {
            filters.push(`campaign.id = ${campaignId}`);
        }

        if (typeof status === "string") {
            filters.push(`ad_group.status = '${status}'`);
        }

        if (typeof name === "string") {
            const escapedName = escapeGaqlString(name.trim());
            filters.push(`ad_group.name LIKE '%${escapedName}%'`);
        }

        const query = `
    SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group.cpc_bid_micros
    FROM ad_group
    WHERE ${filters.join("\n      AND ")}
    ORDER BY campaign.id, ad_group.id
`;
        if (
            campaignId !== undefined &&
            (typeof campaignId !== "string" ||
                !isValidId(campaignId.toString()))
        ) {
            return res.status(400).json({
                message: "campaignId must contain digits only.",
            });
        }

        const accessToken = await getAccessToken();


        const { response, data } = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${config.customerId}/googleAds:search`,
            accessToken,
            config.developerToken,
            { query },
        );

        if (!response.ok) {
            console.error("Google Ads list ad groups error:", data);

            return res.status(response.status).json(data);
        }

        const rows = (data as GoogleAdsResult).results ?? [];

        const adGroups = rows.map(({ campaign, adGroup }) => {
            const bidMicros = adGroup.cpcBidMicros;

            return {
                id: adGroup.id,
                name: adGroup.name,
                status: adGroup.status,
                type: adGroup.type,
                campaignId: campaign.id,
                campaignName: campaign.name,
                campaignStatus: campaign.status,
                cpcBidMicros: bidMicros ?? null,
                cpcBid:
                    bidMicros != null
                        ? Number(bidMicros) / 1_000_000
                        : null,
            };
        });

        return res.json({
            message: "Ad groups retrieved successfully.",
            customerId: config.customerId,
            count: adGroups.length,
            adGroups,
        });
    } catch (error) {
        console.error("Retrieve ad groups error:", error);

        return res.status(500).json({
            message: getErrorMessage(error),
        });
    }
});

// -----------------------------------------------------------------------------
// POST /ad-groups
// Create an ad group. Defaults to validation-only mode.
// -----------------------------------------------------------------------------

router.post("/ad-groups", async (req: Request, res: Response) => {
    try {
        const config = getGoogleAdsConfig(res);
        if (!config) return;

        const name =
            typeof req.body?.name === "string"
                ? req.body.name.trim()
                : "";

        const campaignId =
            typeof req.body?.campaignId === "string" ||
                typeof req.body?.campaignId === "number"
                ? String(req.body.campaignId)
                : "";

        if (
            !name ||
            name.length >= 255 ||
            /[\0\r\n]/.test(name)
        ) {
            return res.status(400).json({
                message: "Provide a valid ad group name.",
            });
        }

        if (!isValidId(campaignId.toString())) {
            return res.status(400).json({
                message: "campaignId must contain digits only.",
            });
        }

        // Actual creation requires both explicit confirmation flags.
        const liveRequested =
            req.body?.validateOnly === false &&
            req.body?.confirm === true;

        const validateOnly = !liveRequested;
        const accessToken = await getAccessToken();

        const operations = [
            {
                create: {
                    name,
                    campaign:
                        `customers/${config.customerId}/campaigns/${campaignId}`,
                    status: "PAUSED",
                    type: "SEARCH_STANDARD",
                },
            },
        ];

        const { response, data } = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroups:mutate`,
            accessToken,
            config.developerToken,
            { operations, validateOnly },
        );

        if (!response.ok) {
            console.error("Google Ads create ad group error:", data);

            return res.status(response.status).json(data);
        }

        return res.status(200).json({
            message: validateOnly
                ? "Ad group request validated. No changes were applied."
                : "Ad group created successfully.",
            validateOnly,
            data,
        });
    } catch (error) {
        console.error("Create ad group error:", error);

        return res.status(500).json({
            message: getErrorMessage(error),
        });
    }
});

// -----------------------------------------------------------------------------
// GET /ad-groups/:adGroupId
// Retrieve ad group details and last 30 days of metrics.
// -----------------------------------------------------------------------------

router.get(
    "/ad-groups/:adGroupId",
    async (req: Request, res: Response) => {
        try {
            const config = getGoogleAdsConfig(res);
            if (!config) return;

            const { adGroupId } = req.params;


            if (!isValidId(adGroupId?.toString())) {
                return res.status(400).json({
                    message: "adGroupId must contain digits only.",
                });
            }

            const accessToken = await getAccessToken();

            const query = `
                SELECT
                    campaign.id,
                    campaign.name,
                    campaign.status,
                    ad_group.id,
                    ad_group.name,
                    ad_group.status,
                    ad_group.type,
                    ad_group.cpc_bid_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.cost_micros,
                    metrics.conversions,
                    metrics.ctr,
                    metrics.average_cpc
                FROM ad_group
                WHERE ad_group.id = ${adGroupId}
                    AND campaign.status != 'REMOVED'
                    AND ad_group.status != 'REMOVED'
                    AND segments.date DURING LAST_30_DAYS
            `;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/googleAds:search`,
                accessToken,
                config.developerToken,
                { query },
            );

            if (!response.ok) {
                console.error("Google Ads get ad group error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: "Ad group details retrieved successfully.",
                data,
            });
        } catch (error) {
            console.error("Retrieve ad group details error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);

// -----------------------------------------------------------------------------
// PATCH /ad-groups/:adGroupId
// Update ad group name, status, or CPC bid.
// -----------------------------------------------------------------------------

router.patch(
    "/ad-groups/:adGroupId",
    async (req: Request, res: Response) => {
        try {
            const config = getGoogleAdsConfig(res);
            if (!config) return;

            const { adGroupId } = req.params;

            if (!isValidId(adGroupId.toString())) {
                return res.status(400).json({
                    message: "adGroupId must contain digits only.",
                });
            }

            const { name, status, amount } = req.body ?? {};

            const validateOnly =
                req.body?.validateOnly !== false ||
                req.body?.confirm !== true;

            const updates: AdGroupUpdate = {};
            const updateMask: string[] = [];

            if (name !== undefined) {
                if (
                    typeof name !== "string" ||
                    !name.trim() ||
                    name.trim().length >= 255 ||
                    /[\0\r\n]/.test(name)
                ) {
                    return res.status(400).json({
                        message: "Provide a valid ad group name.",
                    });
                }

                updates.name = name.trim();
                updateMask.push("name");
            }

            if (status !== undefined) {
                if (!["ENABLED", "PAUSED"].includes(status)) {
                    return res.status(400).json({
                        message: "status must be ENABLED or PAUSED.",
                    });
                }

                updates.status = status;
                updateMask.push("status");
            }

            if (amount !== undefined) {
                if (
                    typeof amount !== "number" ||
                    !Number.isFinite(amount) ||
                    amount <= 0 ||
                    !Number.isSafeInteger(
                        Math.round(amount * 1_000_000),
                    )
                ) {
                    return res.status(400).json({
                        message: "amount must be a valid positive CPC amount.",
                    });
                }

                updates.cpcBidMicros = String(
                    Math.round(amount * 1_000_000),
                );

                updateMask.push("cpcBidMicros");
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    message: "Provide at least one valid field to update.",
                });
            }

            const accessToken = await getAccessToken();

            const operations = [
                {
                    update: {
                        resourceName:
                            `customers/${config.customerId}/adGroups/${adGroupId}`,
                        ...updates,
                    },
                    updateMask: updateMask.join(","),
                },
            ];

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroups:mutate`,
                accessToken,
                config.developerToken,
                { operations, validateOnly },
            );

            if (!response.ok) {
                console.error("Google Ads update ad group error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad group update validated. No changes were applied."
                    : "Ad group updated successfully.",
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Update ad group error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);

router.get('/ad-groups/:adGroupId/keywords', async (req: Request, res: Response) => {
    try {
        const config = getGoogleAdsConfig(res);
        // const matchType ="PHRASE" // Options: BROAD, PHRASE, EXACT
        if (!config) return;
        const { adGroupId } = req.params;
        if (!isValidId(adGroupId?.toString())) {
            return res.status(400).json({
                message: "adGroupId must contain digits only.",
            });
        }
        const status = req.query.status;
        const matchType = req.query.matchType;
        const text = req.query.text;
        const negative = req.query.negative;

        if (
            status !== undefined &&
            (
                typeof status !== "string" ||
                !["ENABLED", "PAUSED"].includes(status)
            )
        ) {
            return res.status(400).json({
                message: "status must be ENABLED or PAUSED.",
            });
        }

        if (
            matchType !== undefined &&
            (
                typeof matchType !== "string" ||
                !["BROAD", "PHRASE", "EXACT"].includes(matchType)
            )
        ) {
            return res.status(400).json({
                message: "matchType must be BROAD, PHRASE, or EXACT.",
            });
        }

        if (
            text !== undefined &&
            (
                typeof text !== "string" ||
                !text.trim() ||
                text.trim().length > 255
            )
        ) {
            return res.status(400).json({
                message: "text must be non-empty and at most 255 characters.",
            });
        }

        if (
            negative !== undefined &&
            negative !== "true" &&
            negative !== "false"
        ) {
            return res.status(400).json({
                message: "negative must be true or false.",
            });
        }

        const filters: string[] = [
            `ad_group.id = ${adGroupId}`,
            "ad_group_criterion.type = 'KEYWORD'",
            "ad_group_criterion.status != 'REMOVED'",
        ];

        if (typeof status === "string") {
            filters.push(`ad_group_criterion.status = '${status}'`);
        }

        if (typeof matchType === "string") {
            filters.push(
                `ad_group_criterion.keyword.match_type = '${matchType}'`
            );
        }

        if (typeof text === "string") {
            const escapedText = escapeGaqlString(text.trim());

            filters.push(
                `ad_group_criterion.keyword.text LIKE '%${escapedText}%'`
            );
        }

        if (negative === "true" || negative === "false") {
            filters.push(`ad_group_criterion.negative = ${negative}`);
        }

        const gaqlQuery = `
    SELECT
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.negative
    FROM ad_group_criterion
    WHERE ${filters.join("\n      AND ")}
    ORDER BY ad_group_criterion.criterion_id
`;
        const accessToken = await getAccessToken();

        const { response, data } = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${config.customerId}/googleAds:search`,
            accessToken,
            config.developerToken,
            { query: gaqlQuery },
        );

        if (!response.ok) {
            console.error("Google Ads list ad groups error:", data);
            return res.status(response.status).json(data);
        }

        return res.status(200).json({ data });
    } catch (error) {
        console.error("Get ad group keyword error:", error);

        return res.status(500).json({
            message: getErrorMessage(error),
        });
    }
});

router.post("/ad-groups/:adGroupId/keywords", async (req: Request, res: Response) => {
    try {
        const config = getGoogleAdsConfig(res);
        if (!config) return;
        const { keywords } = req.body;
        const mode = parseMutationMode(req.body);
        if (mode.error) {
            return res.status(400).json({ message: mode.error });
        }
        const validateOnly = mode.validateOnly;
        const adGroupId = req.params.adGroupId;

        if (!isValidId(String(adGroupId))) {
            return res.status(400).json({
                message: "adGroupId must contain digits only.",
            });
        }

        const accessToken = await getAccessToken();

        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({
                message: "keywords must be a non-empty array",
            });
        }

        if (keywords.length > 1000) {
            return res.status(400).json({
                message: "Maximum 1000 keywords per request",
            });
        }

        for (const keyword of keywords) {
            if (
                !keyword ||
                typeof keyword.text !== "string" ||
                !keyword.text.trim() ||
                !["BROAD", "PHRASE", "EXACT"].includes(keyword.matchType)
            ) {
                return res.status(400).json({
                    message:
                        "Each keyword must have non-empty text and matchType BROAD, PHRASE, or EXACT",
                });
            }
        }

        const operations = keywords.map((keyword) => ({
            create: {
                adGroup: `customers/${config.customerId}/adGroups/${adGroupId}`,
                status: "ENABLED",
                negative: false,
                keyword: {
                    text: keyword.text.trim(),
                    matchType: keyword.matchType,
                },
            },
        }));

        const { response, data } = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupCriteria:mutate`,
            accessToken,
            config.developerToken,
            { operations, validateOnly },
        );

        if (!response.ok) {
            console.error("Google Ads create ad group error:", data);

            return res.status(response.status).json(data);
        }

        return res.status(200).json({
            message: validateOnly
                ? "Ad group keyword creation request validated. No changes were applied."
                : "Ad group keyword created successfully.",
            validateOnly,
            data,
        })
    } catch (error) {
        console.error("adGroup Keyword creation Gives error:", error);

        return res.status(500).json({
            message: getErrorMessage(error),
        });

    }
})

router.patch(
    "/ad-groups/:adGroupId/keywords/:criterionId",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId, criterionId } = req.params;
            const { status } = req.body;
            const mode = parseMutationMode(req.body);
            if (mode.error) {
                return res.status(400).json({ message: mode.error });
            }
            const validateOnly = mode.validateOnly;

            if (!isValidId(String(adGroupId)) || !isValidId(String(criterionId))) {
                return res.status(400).json({
                    message: "adGroupId and criterionId must contain digits only.",
                });
            }

            if (status !== "ENABLED" && status !== "PAUSED") {
                return res.status(400).json({
                    message: "status must be ENABLED or PAUSED.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;
            const accessToken = await getAccessToken();

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupCriteria:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations: [{
                        update: {
                            resourceName: `customers/${config.customerId}/adGroupCriteria/${adGroupId}~${criterionId}`,
                            status: status,
                        },
                        updateMask: 'status'
                    }], validateOnly
                },
            );

            if (!response.ok) {
                console.error("Google Ads create ad group error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad group keyword update request validated. No changes were applied."
                    : "Ad group keyword update successfully.",
                validateOnly,
                data,
            })

        } catch (error) {
            console.error("adGroup Keyword update Gives error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    }
);

// -----------------------------------------------------------------------------
// DELETE /ad-groups/:adGroupId/keywords/:criterionId
// Remove a keyword. Defaults to validation-only mode.
// -----------------------------------------------------------------------------

router.delete(
    "/ad-groups/:adGroupId/keywords/:criterionId",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId, criterionId } = req.params;

            // Validate IDs first.
            if (!isValidId(adGroupId.toString()) || !isValidId(criterionId.toString())) {
                return res.status(400).json({
                    message:
                        "adGroupId and criterionId must contain digits only.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            // A real removal requires both explicit flags.
            const liveRequested =
                req.body?.validateOnly === false &&
                req.body?.confirm === true;

            const validateOnly = !liveRequested;

            const accessToken = await getAccessToken();

            const resourceName =
                `customers/${config.customerId}/adGroupCriteria/` +
                `${adGroupId}~${criterionId}`;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupCriteria:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations: [
                        {
                            remove: resourceName,
                        },
                    ],
                    validateOnly,
                },
            );

            if (!response.ok) {
                console.error("Google Ads remove keyword error:", data);
                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Keyword removal validated. No changes were applied."
                    : "Keyword removed successfully.",
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Remove keyword error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);


// =================== ads routes ==================== //

/**
 *  Gets Ads Route 
 * @param adGroupId
 */
router.get(
    "/ad-groups/:adGroupId/ads",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId } = req.params;

            if (!isValidId(adGroupId.toString())) {
                return res.status(400).json({
                    message: "adGroupId must contain digits only.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            const accessToken = await getAccessToken();

            const query = `
                SELECT
                    campaign.id,
                    campaign.name,
                    ad_group.id,
                    ad_group.name,
                    ad_group_ad.ad.id,
                    ad_group_ad.ad.type,
                    ad_group_ad.status,
                    ad_group_ad.ad.final_urls,
                    ad_group_ad.ad.responsive_search_ad.headlines,
                    ad_group_ad.ad.responsive_search_ad.descriptions,
                    ad_group_ad.ad.responsive_search_ad.path1,
                    ad_group_ad.ad.responsive_search_ad.path2,
                    ad_group_ad.ad_strength,
                    ad_group_ad.action_items
                FROM ad_group_ad
                WHERE ad_group.id = ${adGroupId}
                    AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
                    AND ad_group_ad.status != 'REMOVED'
                ORDER BY ad_group_ad.ad.id
            `;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/googleAds:search`,
                accessToken,
                config.developerToken,
                { query },
            );

            if (!response.ok) {
                console.error("Google Ads get ads error:", data);

                return res.status(response.status).json(data);
            }

            const rows =
                (data as GoogleAdsResult).results ?? [];

            return res.status(200).json({
                message: "Ads retrieved successfully.",
                customerId: config.customerId,
                adGroupId,
                count: rows.length,
                ads: rows,
            });
        } catch (error) {
            console.error("Get ads error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);


router.post(
    "/ad-groups/:adGroupId/ads",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId } = req.params;

            if (!isValidId(adGroupId.toString())) {
                return res.status(400).json({
                    message: "adGroupId must contain digits only.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            const {
                headlines,
                descriptions,
                finalUrl,
                path1,
                path2,
            } = req.body ?? {};

            // Validate the number of headlines.
            if (
                !Array.isArray(headlines) ||
                headlines.length < 3 ||
                headlines.length > 15
            ) {
                return res.status(400).json({
                    message: "Provide between 3 and 15 headlines.",
                });
            }

            // Validate headline text and length.
            if (
                !headlines.every(
                    (item: unknown) =>
                        typeof item === "string" &&
                        item.trim().length > 0 &&
                        item.trim().length <= 30
                )
            ) {
                return res.status(400).json({
                    message:
                        "Each headline must be non-empty and at most 30 characters.",
                });
            }

            const cleanHeadlines = headlines.map(
                (item: string) => item.trim()
            );

            if (
                new Set(
                    cleanHeadlines.map((item: string) => item.toLowerCase())
                ).size !== cleanHeadlines.length
            ) {
                return res.status(400).json({
                    message: "Headlines must be unique.",
                });
            }

            // Validate descriptions.
            if (
                !Array.isArray(descriptions) ||
                descriptions.length < 2 ||
                descriptions.length > 4
            ) {
                return res.status(400).json({
                    message: "Provide between 2 and 4 descriptions.",
                });
            }


            if (
                !descriptions.every(
                    (item: unknown) =>
                        typeof item == "string" &&
                        item.trim().length > 0 &&
                        item.trim().length <= 90
                )
            ) {
                return res.status(400).json({
                    message:
                        "Each description must be non-empty and at most 90 characters.",
                });
            }

            const cleanDescriptions = descriptions.map(
                (item: string) => item.trim()
            );

            if (
                new Set(
                    cleanDescriptions.map(
                        (item: string) => item.toLowerCase()
                    )
                ).size !== cleanDescriptions.length
            ) {
                return res.status(400).json({
                    message: "Descriptions must be unique.",
                });
            }

            // Validate the final URL.
            if (typeof finalUrl !== "string" || !finalUrl.trim()) {
                return res.status(400).json({
                    message: "finalUrl is required.",
                });
            }

            let parsedUrl: URL;

            try {
                parsedUrl = new URL(finalUrl.trim());
            } catch {
                return res.status(400).json({
                    message: "finalUrl must be a valid URL.",
                });
            }

            if (
                !["http:", "https:"].includes(parsedUrl.protocol)
            ) {
                return res.status(400).json({
                    message: "finalUrl must use HTTP or HTTPS.",
                });
            }

            // Display paths are optional.
            for (const [field, value] of [
                ["path1", path1],
                ["path2", path2],
            ] as const) {
                if (
                    value !== undefined &&
                    (
                        typeof value !== "string" ||
                        !value.trim() ||
                        value.trim().length > 15
                    )
                ) {
                    return res.status(400).json({
                        message:
                            `${field} must be a non-empty string of at most 15 characters.`,
                    });
                }
            }

            // Require explicit confirmation for a live creation.
            const liveRequested =
                req.body?.validateOnly === false &&
                req.body?.confirm === true;

            const validateOnly = !liveRequested;

            const accessToken = await getAccessToken();

            const responsiveSearchAd: Record<string, unknown> = {
                headlines: cleanHeadlines.map((text: string) => ({
                    text,
                })),
                descriptions: cleanDescriptions.map((text: string) => ({
                    text,
                })),
            };

            if (typeof path1 === "string") {
                responsiveSearchAd.path1 = path1.trim();
            }

            if (typeof path2 === "string") {
                responsiveSearchAd.path2 = path2.trim();
            }

            const operations = [
                {
                    create: {
                        adGroup:
                            `customers/${config.customerId}/adGroups/${adGroupId}`,
                        status: "PAUSED",
                        ad: {
                            finalUrls: [parsedUrl.toString()],
                            responsiveSearchAd,
                        },
                    },
                },
            ];

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupAds:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations,
                    validateOnly,
                },
            );

            if (!response.ok) {
                console.error("Google Ads create ad error:", data);
                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad creation request validated. No changes were applied."
                    : "Ad created successfully in PAUSED status.",
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Create responsive search ad error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);



router.patch(
    "/ad-groups/:adGroupId/ads/:adId",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId, adId } = req.params;
            const { status } = req.body ?? {};

            if (!isValidId(adGroupId.toString()) || !isValidId(adId.toString())) {
                return res.status(400).json({
                    message:
                        "adGroupId and adId must contain digits only.",
                });
            }

            if (!["ENABLED", "PAUSED"].includes(status)) {
                return res.status(400).json({
                    message: "status must be ENABLED or PAUSED.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            // Default to validation-only; live updates need both flags.
            const liveRequested =
                req.body?.validateOnly === false &&
                req.body?.confirm === true;

            const validateOnly = !liveRequested;

            const accessToken = await getAccessToken();

            const resourceName =
                `customers/${config.customerId}/adGroupAds/` +
                `${adGroupId}~${adId}`;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupAds:mutate`,
                accessToken,
                config.developerToken,
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
                    validateOnly,
                },
            );

            if (!response.ok) {
                console.error("Google Ads update ad status error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad status update validated. No changes were applied."
                    : `Ad status changed to ${status}.`,
                status,
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Update ad status error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);

router.patch(
    "/ads/:adId/content",
    async (req: Request, res: Response) => {
        try {
            const { adId } = req.params;

            if (!isValidId(adId.toString())) {
                return res.status(400).json({
                    message: "adId must contain digits only.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            const {
                headlines,
                descriptions,
                finalUrl,
                path1,
                path2,
            } = req.body ?? {};

            // Validate headlines.
            if (
                !Array.isArray(headlines) ||
                headlines.length < 3 ||
                headlines.length > 15 ||
                !headlines.every(
                    (text: unknown) =>
                        typeof text === "string" &&
                        text.trim().length > 0 &&
                        text.trim().length <= 30
                )
            ) {
                return res.status(400).json({
                    message:
                        "Provide 3–15 headlines, each 1–30 characters long.",
                });
            }

            const cleanHeadlines = headlines.map(
                (text: string) => text.trim()
            );

            if (
                new Set(
                    cleanHeadlines.map((text: string) =>
                        text.toLowerCase()
                    )
                ).size !== cleanHeadlines.length
            ) {
                return res.status(400).json({
                    message: "Headlines must be unique.",
                });
            }

            // Validate descriptions.
            if (
                !Array.isArray(descriptions) ||
                descriptions.length < 2 ||
                descriptions.length > 4 ||
                !descriptions.every(
                    (text: unknown) =>
                        typeof text === "string" &&
                        text.trim().length > 0 &&
                        text.trim().length <= 90
                )
            ) {
                return res.status(400).json({
                    message:
                        "Provide 2–4 descriptions, each 1–90 characters long.",
                });
            }

            const cleanDescriptions = descriptions.map(
                (text: string) => text.trim()
            );

            if (
                new Set(
                    cleanDescriptions.map((text: string) =>
                        text.toLowerCase()
                    )
                ).size !== cleanDescriptions.length
            ) {
                return res.status(400).json({
                    message: "Descriptions must be unique.",
                });
            }

            // Validate destination URL.
            if (typeof finalUrl !== "string" || !finalUrl.trim()) {
                return res.status(400).json({
                    message: "finalUrl is required.",
                });
            }

            let parsedUrl: URL;

            try {
                parsedUrl = new URL(finalUrl.trim());
            } catch {
                return res.status(400).json({
                    message: "finalUrl must be a valid URL.",
                });
            }

            if (!["https:", "http:"].includes(parsedUrl.protocol)) {
                return res.status(400).json({
                    message: "finalUrl must use HTTP or HTTPS.",
                });
            }

            // Validate optional display paths.
            for (const [field, value] of [
                ["path1", path1],
                ["path2", path2],
            ] as const) {
                if (
                    value !== undefined &&
                    (
                        typeof value !== "string" ||
                        !value.trim() ||
                        value.trim().length > 15
                    )
                ) {
                    return res.status(400).json({
                        message:
                            `${field} must be 1–15 characters long.`,
                    });
                }
            }

            if (path2 !== undefined && path1 === undefined) {
                return res.status(400).json({
                    message:
                        "Provide path1 when updating path2.",
                });
            }

            // Live updates need both explicit flags.
            const liveRequested =
                req.body?.validateOnly === false &&
                req.body?.confirm === true;

            const validateOnly = !liveRequested;

            const accessToken = await getAccessToken();

            const responsiveSearchAd: Record<string, unknown> = {
                headlines: cleanHeadlines.map((text: string) => ({
                    text,
                })),
                descriptions: cleanDescriptions.map((text: string) => ({
                    text,
                })),
            };

            const updateMask = [
                "finalUrls",
                "responsiveSearchAd.headlines",
                "responsiveSearchAd.descriptions",
            ];

            if (path1 !== undefined) {
                responsiveSearchAd.path1 = path1.trim();
                updateMask.push("responsiveSearchAd.path1");
            }

            if (path2 !== undefined) {
                responsiveSearchAd.path2 = path2.trim();
                updateMask.push("responsiveSearchAd.path2");
            }

            const operations = [
                {
                    update: {
                        resourceName:
                            `customers/${config.customerId}/ads/${adId}`,
                        finalUrls: [parsedUrl.toString()],
                        responsiveSearchAd,
                    },
                    updateMask: updateMask.join(","),
                },
            ];

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/ads:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations,
                    validateOnly,
                },
            );

            if (!response.ok) {
                console.error("Google Ads update ad content error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad content update validated. No changes were applied."
                    : "Ad content updated successfully.",
                adId,
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Update ad content error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);



router.delete(
    "/ad-groups/:adGroupId/ads/:adId",
    async (req: Request, res: Response) => {
        try {
            const { adGroupId, adId } = req.params;

            if (!isValidId(adGroupId.toString()) || !isValidId(adId.toString())) {
                return res.status(400).json({
                    message:
                        "adGroupId and adId must contain digits only.",
                });
            }

            const config = getGoogleAdsConfig(res);
            if (!config) return;

            // A real removal requires explicit confirmation.
            const liveRequested =
                req.body?.validateOnly === false &&
                req.body?.confirm === true;

            const validateOnly = !liveRequested;

            const accessToken = await getAccessToken();

            const resourceName =
                `customers/${config.customerId}/adGroupAds/` +
                `${adGroupId}~${adId}`;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupAds:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations: [
                        {
                            remove: resourceName,
                        },
                    ],
                    validateOnly,
                },
            );

            if (!response.ok) {
                console.error("Google Ads remove ad error:", data);

                return res.status(response.status).json(data);
            }

            return res.status(200).json({
                message: validateOnly
                    ? "Ad removal validated. No changes were applied."
                    : "Ad removed successfully.",
                adGroupId,
                adId,
                validateOnly,
                data,
            });
        } catch (error) {
            console.error("Remove ad error:", error);

            return res.status(500).json({
                message: getErrorMessage(error),
            });
        }
    },
);


/**
 * GET /google-ads/reports/ad-groups
 *
 * Returns ad-group performance for the last 30 days.
 * Mount this router in your Express app, or move the route into your
 * existing Google Ads reports router if that is how your project is organized.
 */
router.get(
    "/google-ads/reports/ad-groups",
    async (_req: Request, res: Response): Promise<void> => {
        try {
            const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
            const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

            if (!customerId || !developerToken) {
                res.status(500).json({
                    success: false,
                    message:
                        "Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN environment variable.",
                });
                return;
            }

            const accessToken = await getAccessToken();

            const query = `
        SELECT
          customer.currency_code,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group.status,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.conversions,
          metrics.conversions_from_interactions_rate,
          metrics.cost_per_conversion,
          metrics.conversions_value
        FROM ad_group
        WHERE segments.date DURING LAST_30_DAYS
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
        ORDER BY metrics.clicks DESC
      `;

            const apiResponse = await fetch(
                `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "developer-token": developerToken,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ query }),
                }
            );

            const data: any = await apiResponse.json();

            if (!apiResponse.ok) {
                res.status(apiResponse.status).json({
                    success: false,
                    message: "Google Ads API request failed.",
                    details: data,
                });
                return;
            }

            const rows: any[] = data.results ?? [];

            const adGroups = rows.map((row) => {
                const metrics = row.metrics ?? {};

                const impressions = Number(metrics.impressions ?? 0);
                const clicks = Number(metrics.clicks ?? 0);
                const cost = Number(metrics.costMicros ?? 0) / 1_000_000;
                const averageCpc =
                    Number(metrics.averageCpc ?? 0) / 1_000_000;
                const conversions = Number(metrics.conversions ?? 0);
                const conversionValue = Number(metrics.conversionsValue ?? 0);
                const costPerConversion =
                    Number(metrics.costPerConversion ?? 0) / 1_000_000;

                return {
                    campaign: {
                        id: row.campaign.id,
                        name: row.campaign.name,
                    },
                    adGroup: {
                        id: row.adGroup.id,
                        name: row.adGroup.name,
                        status: row.adGroup.status,
                    },
                    currencyCode: row.customer.currencyCode,
                    metrics: {
                        impressions,
                        clicks,
                        ctrPercent: Number(metrics.ctr ?? 0) * 100,
                        cost: Number(cost.toFixed(2)),
                        averageCpc: Number(averageCpc.toFixed(2)),
                        conversions,
                        conversionRatePercent:
                            Number(metrics.conversionsFromInteractionsRate ?? 0) * 100,
                        costPerConversion: Number(costPerConversion.toFixed(2)),
                        conversionValue,
                        // ROAS is conversion value divided by ad cost, not profit.
                        roas: cost > 0 ? Number((conversionValue / cost).toFixed(2)) : 0,
                    },
                };
            });

            res.status(200).json({
                success: true,
                dateRange: "LAST_30_DAYS",
                totalAdGroups: adGroups.length,
                adGroups,
            });
        } catch (error: unknown) {
            console.error("Ad group report error:", error);

            res.status(500).json({
                success: false,
                message: "Failed to fetch ad-group performance.",
            });
        }
    }
);


const GOOGLE_ADS_API_VERSION = "v25";
const MAX_DATE_RANGE_DAYS = 366;

type KeywordRow = Record<string, any>;

type DateRange = {
    startDate: string;
    endDate: string;
    days: number;
};

class GoogleAdsApiError extends Error {
    status: number;
    details: unknown;

    constructor(status: number, details: unknown) {
        super("Google Ads API request failed");
        this.status = status;
        this.details = details;
    }
}

function isValidDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateDifferenceInDays(startDate: string, endDate: string): number {
    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    const end = Date.parse(`${endDate}T00:00:00.000Z`);
    return Math.floor((end - start) / 86_400_000) + 1;
}

function addDays(dateString: string, days: number): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function validateDateRange(
    startDate: unknown,
    endDate: unknown
): { range?: DateRange; error?: string } {
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return {
            error: "Provide valid startDate and endDate in YYYY-MM-DD format.",
        };
    }

    if (startDate > endDate) {
        return { error: "startDate must be on or before endDate." };
    }

    const days = dateDifferenceInDays(startDate, endDate);

    if (days > MAX_DATE_RANGE_DAYS) {
        return { error: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` };
    }

    return { range: { startDate, endDate, days } };
}

function getPreviousDateRange(range: DateRange): DateRange {
    const previousEndDate = addDays(range.startDate, -1);
    const previousStartDate = addDays(previousEndDate, -(range.days - 1));

    return {
        startDate: previousStartDate,
        endDate: previousEndDate,
        days: range.days,
    };
}

function numberValue(value: unknown): number {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
}

function normalizeKeywordRow(row: KeywordRow) {
    const metrics = row.metrics ?? {};
    const cost = numberValue(metrics.costMicros) / 1_000_000;
    const clicks = numberValue(metrics.clicks);
    const impressions = numberValue(metrics.impressions);
    const conversions = numberValue(metrics.conversions);
    const conversionValue = numberValue(metrics.conversionsValue);

    return {
        campaign: {
            id: String(row.campaign?.id ?? ""),
            name: String(row.campaign?.name ?? ""),
        },
        adGroup: {
            id: String(row.adGroup?.id ?? ""),
            name: String(row.adGroup?.name ?? ""),
        },
        keyword: {
            criterionId: String(row.adGroupCriterion?.criterionId ?? ""),
            text: String(row.adGroupCriterion?.keyword?.text ?? ""),
            matchType: String(row.adGroupCriterion?.keyword?.matchType ?? ""),
            status: String(row.adGroupCriterion?.status ?? ""),
        },
        date: row.segments?.date as string | undefined,
        currencyCode: String(row.customer?.currencyCode ?? ""),
        metrics: {
            impressions,
            clicks,
            ctrPercent: numberValue(metrics.ctr) * 100,
            cost: Number(cost.toFixed(2)),
            averageCpc: Number(
                (numberValue(metrics.averageCpc) / 1_000_000).toFixed(2)
            ),
            conversions,
            conversionRatePercent:
                numberValue(metrics.conversionsFromInteractionsRate) * 100,
            costPerConversion: Number(
                (numberValue(metrics.costPerConversion) / 1_000_000).toFixed(2)
            ),
            conversionValue,
            // ROAS = conversion value / ad cost; it is not profit.
            roas: cost > 0 ? Number((conversionValue / cost).toFixed(2)) : 0,
        },
    };
}

function buildKeywordQuery(
    dateFilter: string,
    includeDateSegment = false
): string {
    return `
    SELECT
      customer.currency_code,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ${includeDateSegment ? "segments.date," : ""}
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros,
      metrics.average_cpc,
      metrics.conversions,
      metrics.interactions,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion,
      metrics.conversions_value
    FROM keyword_view
    WHERE ${dateFilter}
      AND campaign.status != 'REMOVED'
      AND ad_group.status != 'REMOVED'
      AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.clicks DESC
  `;
}

async function fetchKeywordRows(
    query: string,
    accessToken: string,
    customerId: string,
    developerToken: string
): Promise<KeywordRow[]> {
    const response = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": developerToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query }),
        }
    );

    const data: any = await response.json();

    if (!response.ok) {
        throw new GoogleAdsApiError(response.status, data);
    }

    return data.results ?? [];
}

function getCredentials() {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!customerId || !developerToken) {
        throw new Error(
            "Missing GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_DEVELOPER_TOKEN environment variable."
        );
    }

    return { customerId, developerToken };
}

function sendRouteError(res: Response, error: unknown): void {
    if (error instanceof GoogleAdsApiError) {
        res.status(error.status).json({
            success: false,
            message: error.message,
            details: error.details,
        });
        return;
    }

    console.error("Google Ads keyword report error:", error);

    const message =
        error instanceof Error ? error.message : "Unexpected server error.";

    const isConfigurationError = message.startsWith("Missing GOOGLE_ADS_");

    res.status(isConfigurationError ? 500 : 500).json({
        success: false,
        message: isConfigurationError
            ? message
            : "Failed to fetch Google Ads keyword report.",
    });
}

function keywordIdentity(row: ReturnType<typeof normalizeKeywordRow>): string {
    return `${row.campaign.id}:${row.adGroup.id}:${row.keyword.criterionId}`;
}

function aggregateKeywordRows(rows: KeywordRow[]) {
    const map = new Map<string, any>();

    for (const rawRow of rows) {
        const normalized = normalizeKeywordRow(rawRow);
        const key = keywordIdentity(normalized);

        if (!map.has(key)) {
            map.set(key, {
                ...normalized,
                date: undefined,
                metrics: {
                    impressions: 0,
                    clicks: 0,
                    ctrPercent: 0,
                    cost: 0,
                    averageCpc: 0,
                    conversions: 0,
                    conversionRatePercent: 0,
                    costPerConversion: 0,
                    conversionValue: 0,
                    roas: 0,
                },
                _costMicros: 0,
                _averageCpcMicrosWeighted: 0,
                _costPerConversionMicros: 0,
                _conversionRateWeighted: 0,
                _interactions: 0,
            });
        }

        const item = map.get(key);
        const metrics = rawRow.metrics ?? {};
        const costMicros = numberValue(metrics.costMicros);
        const clicks = numberValue(metrics.clicks);
        const impressions = numberValue(metrics.impressions);
        const conversions = numberValue(metrics.conversions);

        item.metrics.impressions += impressions;
        item.metrics.clicks += clicks;
        item.metrics.conversions += conversions;
        item.metrics.conversionValue += numberValue(metrics.conversionsValue);
        item._costMicros += costMicros;
        item._averageCpcMicrosWeighted += numberValue(metrics.averageCpc) * clicks;
        item._costPerConversionMicros += numberValue(metrics.costPerConversion) * conversions;
        const interactions = numberValue(metrics.interactions);
        item._interactions += interactions;
        item._conversionRateWeighted +=
            numberValue(metrics.conversionsFromInteractionsRate) * interactions;
    }

    return [...map.values()].map((item) => {
        const cost = item._costMicros / 1_000_000;
        const clicks = item.metrics.clicks;
        const impressions = item.metrics.impressions;
        const conversions = item.metrics.conversions;

        item.metrics.ctrPercent =
            impressions > 0 ? (clicks / impressions) * 100 : 0;
        item.metrics.cost = Number(cost.toFixed(2));
        item.metrics.averageCpc = Number(
            (clicks > 0 ? item._averageCpcMicrosWeighted / clicks / 1_000_000 : 0).toFixed(2)
        );
        item.metrics.costPerConversion = Number(
            (conversions > 0 ? cost / conversions : 0).toFixed(2)
        );
        item.metrics.conversionRatePercent =
            item._interactions > 0
                ? Number(((item._conversionRateWeighted / item._interactions) * 100).toFixed(2))
                : 0;
        item.metrics.roas =
            cost > 0
                ? Number((item.metrics.conversionValue / cost).toFixed(2))
                : 0;

        delete item._costMicros;
        delete item._averageCpcMicrosWeighted;
        delete item._costPerConversionMicros;
        delete item._conversionRateWeighted;
        delete item._interactions;

        return item;
    });
}

function sortKeywordRows(rows: any[], sortBy: string) {
    const allowedSorts = [
        "clicks",
        "impressions",
        "conversions",
        "cost",
        "roas",
        "ctr",
        "cpc",
        "cpa",
    ];

    if (!allowedSorts.includes(sortBy)) {
        throw new Error(`sortBy must be one of: ${allowedSorts.join(", ")}.`);
    }

    const metricMap: Record<string, string> = {
        clicks: "clicks",
        impressions: "impressions",
        conversions: "conversions",
        cost: "cost",
        roas: "roas",
        ctr: "ctrPercent",
        cpc: "averageCpc",
        cpa: "costPerConversion",
    };

    const metric = metricMap[sortBy];

    return [...rows].sort(
        (a, b) => numberValue(b.metrics[metric]) - numberValue(a.metrics[metric])
    );
}

/**
 * GET /google-ads/reports/keywords
 * All non-removed keyword rows, aggregated over LAST_30_DAYS.
 */
router.get(
    "/google-ads/reports/keywords",
    async (_req: Request, res: Response): Promise<void> => {
        try {
            const { customerId, developerToken } = getCredentials();
            const accessToken = await getAccessToken();
            const rows = await fetchKeywordRows(
                buildKeywordQuery("segments.date DURING LAST_30_DAYS"),
                accessToken,
                customerId,
                developerToken
            );

            const keywords = rows.map(normalizeKeywordRow);

            res.json({
                success: true,
                dateRange: "LAST_30_DAYS",
                totalKeywords: keywords.length,
                keywords,
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    }
);

/**
 * GET /google-ads/reports/keywords/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Aggregated keyword metrics for a custom date range.
 */
router.get(
    "/google-ads/reports/keywords/range",
    async (req: Request, res: Response): Promise<void> => {
        try {
            const validation = validateDateRange(req.query.startDate, req.query.endDate);

            if (validation.error || !validation.range) {
                res.status(400).json({ success: false, message: validation.error });
                return;
            }

            const { startDate, endDate, days } = validation.range;
            const { customerId, developerToken } = getCredentials();
            const accessToken = await getAccessToken();
            const rows = await fetchKeywordRows(
                buildKeywordQuery(
                    `segments.date BETWEEN '${startDate}' AND '${endDate}'`
                ),
                accessToken,
                customerId,
                developerToken
            );

            const keywords = aggregateKeywordRows(rows);

            res.json({
                success: true,
                dateRange: { startDate, endDate, days },
                totalKeywords: keywords.length,
                keywords,
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    }
);

/**
 * GET /google-ads/reports/keywords/daily-trends?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * One row per keyword per date.
 */
router.get(
    "/google-ads/reports/keywords/daily-trends",
    async (req: Request, res: Response): Promise<void> => {
        try {
            const validation = validateDateRange(req.query.startDate, req.query.endDate);

            if (validation.error || !validation.range) {
                res.status(400).json({ success: false, message: validation.error });
                return;
            }

            const { startDate, endDate, days } = validation.range;
            const { customerId, developerToken } = getCredentials();
            const accessToken = await getAccessToken();
            const rows = await fetchKeywordRows(
                buildKeywordQuery(
                    `segments.date BETWEEN '${startDate}' AND '${endDate}'`,
                    true
                ),
                accessToken,
                customerId,
                developerToken
            );

            const dailyRows = rows.map(normalizeKeywordRow);

            res.json({
                success: true,
                dateRange: { startDate, endDate, days },
                totalRows: dailyRows.length,
                dailyRows,
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    }
);

/**
 * GET /google-ads/reports/keywords/top?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&sortBy=conversions&limit=10
 * sortBy: clicks | impressions | conversions | cost | roas | ctr | cpc | cpa
 */
router.get(
    "/google-ads/reports/keywords/top",
    async (req: Request, res: Response): Promise<void> => {
        try {
            const validation = validateDateRange(req.query.startDate, req.query.endDate);

            if (validation.error || !validation.range) {
                res.status(400).json({ success: false, message: validation.error });
                return;
            }

            const sortBy = String(req.query.sortBy ?? "conversions").toLowerCase();
            const rawLimit = Number(req.query.limit ?? 10);
            const limit = Number.isFinite(rawLimit)
                ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
                : 10;

            const { startDate, endDate, days } = validation.range;
            const { customerId, developerToken } = getCredentials();
            const accessToken = await getAccessToken();
            const rows = await fetchKeywordRows(
                buildKeywordQuery(
                    `segments.date BETWEEN '${startDate}' AND '${endDate}'`
                ),
                accessToken,
                customerId,
                developerToken
            );

            const aggregated = aggregateKeywordRows(rows);
            const sorted = sortKeywordRows(aggregated, sortBy);
            const keywords = sorted.slice(0, limit);

            res.json({
                success: true,
                dateRange: { startDate, endDate, days },
                sortBy,
                limit,
                totalKeywords: aggregated.length,
                keywords,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (message.startsWith("sortBy must be one of:")) {
                res.status(400).json({ success: false, message });
                return;
            }
            sendRouteError(res, error);
        }
    }
);

/**
 * GET /google-ads/reports/keywords/compare?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Compares the selected range with the immediately preceding equal-length range.
 */
router.get(
    "/google-ads/reports/keywords/compare",
    async (req: Request, res: Response): Promise<void> => {
        try {
            const validation = validateDateRange(req.query.startDate, req.query.endDate);

            if (validation.error || !validation.range) {
                res.status(400).json({ success: false, message: validation.error });
                return;
            }

            const currentRange = validation.range;
            const previousRange = getPreviousDateRange(currentRange);
            const { customerId, developerToken } = getCredentials();
            const accessToken = await getAccessToken();

            const [currentRaw, previousRaw] = await Promise.all([
                fetchKeywordRows(
                    buildKeywordQuery(
                        `segments.date BETWEEN '${currentRange.startDate}' AND '${currentRange.endDate}'`
                    ),
                    accessToken,
                    customerId,
                    developerToken
                ),
                fetchKeywordRows(
                    buildKeywordQuery(
                        `segments.date BETWEEN '${previousRange.startDate}' AND '${previousRange.endDate}'`
                    ),
                    accessToken,
                    customerId,
                    developerToken
                ),
            ]);

            const current = aggregateKeywordRows(currentRaw);
            const previous = aggregateKeywordRows(previousRaw);
            const previousMap = new Map(
                previous.map((row) => [keywordIdentity(row), row])
            );

            const compareFields = [
                "impressions",
                "clicks",
                "ctrPercent",
                "cost",
                "averageCpc",
                "conversions",
                "conversionRatePercent",
                "costPerConversion",
                "conversionValue",
                "roas",
            ] as const;

            const keywords = current.map((currentRow) => {
                const previousRow = previousMap.get(keywordIdentity(currentRow));

                const comparison: Record<string, any> = {};

                for (const field of compareFields) {
                    const currentValue = numberValue(currentRow.metrics[field]);
                    const previousValue = numberValue(previousRow?.metrics[field]);
                    comparison[field] = {
                        current: currentValue,
                        previous: previousValue,
                        change: Number((currentValue - previousValue).toFixed(2)),
                        changePercent:
                            previousValue !== 0
                                ? Number((((currentValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(2))
                                : null,
                    };
                }

                return {
                    campaign: currentRow.campaign,
                    adGroup: currentRow.adGroup,
                    keyword: currentRow.keyword,
                    currencyCode: currentRow.currencyCode,
                    metrics: comparison,
                };
            });

            res.json({
                success: true,
                currentRange,
                previousRange,
                totalKeywords: keywords.length,
                keywords,
                note: "Keywords with activity only in the previous period are not included in this response.",
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    }
);



export default router;

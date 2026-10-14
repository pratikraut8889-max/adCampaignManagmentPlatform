
import { Router, Request, Response } from "express";
import { getAccessToken } from "../google_config.js";
import { escapeGaqlString, getGoogleAdsConfig, getErrorMessage, GoogleAdsResult, googleAdsRequest, isValidId, GOOGLE_ADS_BASE_URL, AdGroupUpdate } from '../helper/shared.js'

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
        const { keywords, finalURl, validateOnly } = req.body;
        const accessToken = await getAccessToken();
        const adGroupId = req.params.adGroupId;

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
            const { status, validateOnly } = req.body;
            const config = getGoogleAdsConfig(res);
            const accessToken = await getAccessToken();
            if (!config) return;

            const { response, data } = await googleAdsRequest(
                `${GOOGLE_ADS_BASE_URL}/${config.customerId}/adGroupCriteria:mutate`,
                accessToken,
                config.developerToken,
                {
                    operations: {
                        update: {
                            resourceName: `customers/${config.customerId}/adGroupCriteria/${adGroupId}~${criterionId}`,
                            status: status,
                        },
                        updateMask: 'status'
                    }, validateOnly
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
                descriptions.every(
                    (item: unknown) =>
                        typeof item == "string" &&
                        item.trim().length > 0 &&
                        item.trim().length <= 50
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




export default router;

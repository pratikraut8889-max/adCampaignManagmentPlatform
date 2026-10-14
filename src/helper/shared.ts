import { Response } from 'express'
import { getAccessToken } from '../google_config.js'
export const GOOGLE_ADS_API_VERSION = "v25";
export const GOOGLE_ADS_BASE_URL =
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers`;

export type GoogleAdsConfig = {
    customerId: string;
    developerToken: string;
};

export type GoogleAdsRow = {
    campaign: {
        id: string;
        name: string;
        status: string;
    };
    adGroup: {
        id: string;
        name: string;
        status: string;
        type: string;
        cpcBidMicros?: string | null;
    };
    metrics?: {
        impressions?: string;
        clicks?: string;
        costMicros?: string;
        conversions?: number;
        ctr?: number;
        averageCpc?: string;
    };
};

export type GoogleAdsResult = {
    results?: GoogleAdsRow[];
    [key: string]: unknown;
};

export type AdGroupUpdate = {
    name?: string;
    status?: "ENABLED" | "PAUSED";
    cpcBidMicros?: string;
};

export const escapeGaqlString = (value: string) => {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}


export const getGoogleAdsConfig = (res: Response): GoogleAdsConfig | null => {
    const customerId =
        process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

    const developerToken =
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!customerId || !/^\d+$/.test(customerId)) {
        res.status(500).json({
            message: "Missing or invalid GOOGLE_ADS_CUSTOMER_ID",
        });
        return null;
    }

    if (!developerToken) {
        res.status(500).json({
            message: "Missing GOOGLE_ADS_DEVELOPER_TOKEN",
        });
        return null;
    }

    return { customerId, developerToken };
}

export const googleAdsRequest = async (
    endpoint: string,
    accessToken: string,
    developerToken: string,
    body: Record<string, unknown>,
): Promise<{
    response: globalThis.Response;
    data: unknown;
}> => {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "developer-token": developerToken,
        },
        body: JSON.stringify(body),
    });

    const data: unknown = await response.json().catch(() => null);

    return { response, data };
}

export function getErrorMessage(error: unknown): string {
    console.log(
        error
    );

    return error instanceof Error
        ? error.message
        : "An unexpected error occurred.";
}

export function isValidId(value: string): boolean {
    return /^\d+$/.test(value);
}


export type AssetInput = Record<string, unknown>;

export class AssetValidationError extends Error { }

export function requiredText(
    value: unknown,
    field: string
): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new AssetValidationError(`${field} is required`);
    }

    return value.trim();
}


export function buildAssetCreate(
    type: string,
    input: AssetInput
): Record<string, unknown> {
    const name =
        typeof input.name === "string" && input.name.trim()
            ? input.name.trim()
            : undefined;

    const create: Record<string, unknown> = {};

    if (name) create.name = name;

    switch (type) {
        case "SITELINK": {
            const linkText = requiredText(input.linkText, "linkText");
            const finalUrl = requiredText(input.finalUrl, "finalUrl");

            if (linkText.length > 25) {
                throw new AssetValidationError(
                    "linkText must be at most 25 characters"
                );
            }

            try {
                const url = new URL(finalUrl);
                if (!["https:", "http:"].includes(url.protocol)) {
                    throw new Error();
                }
            } catch {
                throw new AssetValidationError(
                    "finalUrl must be a valid HTTP or HTTPS URL"
                );
            }

            const description1 = input.description1;
            const description2 = input.description2;

            if (
                (description1 == null || description1 === "") !==
                (description2 == null || description2 === "")
            ) {
                throw new AssetValidationError(
                    "Provide both descriptions or neither"
                );
            }

            const sitelinkAsset: Record<string, string> = { linkText };

            if (description1 != null && description1 !== "") {
                const d1 = requiredText(description1, "description1");
                const d2 = requiredText(description2, "description2");

                if (d1.length > 35 || d2.length > 35) {
                    throw new AssetValidationError(
                        "Each description must be at most 35 characters"
                    );
                }

                sitelinkAsset.description1 = d1;
                sitelinkAsset.description2 = d2;
            }

            create.finalUrls = [finalUrl];
            create.sitelinkAsset = sitelinkAsset;
            break;
        }

        case "CALLOUT": {
            const calloutText = requiredText(
                input.calloutText,
                "calloutText"
            );

            if (calloutText.length > 25) {
                throw new AssetValidationError(
                    "calloutText must be at most 25 characters"
                );
            }

            create.calloutAsset = { calloutText };
            break;
        }

        case "STRUCTURED_SNIPPET": {
            const header = requiredText(input.header, "header");
            const values = input.values;

            if (
                !Array.isArray(values) ||
                values.length < 3 ||
                values.length > 10 ||
                values.some(
                    (value) =>
                        typeof value !== "string" ||
                        !value.trim() ||
                        value.trim().length > 25
                )
            ) {
                throw new AssetValidationError(
                    "Provide 3–10 values, each up to 25 characters"
                );
            }

            create.structuredSnippetAsset = {
                header,
                values: values.map((value: string) => value.trim()),
            };
            break;
        }

        case "CALL": {
            create.callAsset = {
                countryCode: requiredText(
                    input.countryCode,
                    "countryCode"
                ).toUpperCase(),
                phoneNumber: requiredText(
                    input.phoneNumber,
                    "phoneNumber"
                ),
            };
            break;
        }

        case "IMAGE": {
            const rawData = requiredText(input.data, "data");

            create.imageAsset = {
                data: rawData.replace(
                    /^data:image\/[^;]+;base64,/,
                    ""
                ),
            };
            break;
        }

        case "BUSINESS_NAME": {
            const businessName = requiredText(
                input.businessName,
                "businessName"
            );

            if (businessName.length > 25) {
                throw new AssetValidationError(
                    "Business name must be 25 characters or fewer"
                );
            }

            create.textAsset = {
                text: businessName,
            };

            break;
        }

        case "BUSINESS_LOGO": {
            const rawData = requiredText(input.data, "data");

            const imageData = rawData.replace(
                /^data:image\/[^;]+;base64,/,
                ""
            );

            create.imageAsset = {
                data: imageData,
            };

            break;
        }

        default:
            throw new AssetValidationError(
                `Unsupported asset type: ${type}`
            );
    }

    return create;
}



export type AssetAssociationLevel = "campaign" | "adGroup";

export const ASSOCIATION_CONFIG = {
    campaign: {
        endpoint: "campaignAssets:mutate",
        resourceKey: "campaign",
    },
    adGroup: {
        endpoint: "adGroupAssets:mutate",
        resourceKey: "adGroup",
    },
} as const;

export const ALLOWED_FIELD_TYPES: any = new Set([
    "AD_IMAGE",
    "SITELINK",
    "CALLOUT",
    "STRUCTURED_SNIPPET",
    "CALL",
    "BUSINESS_NAME",
    "BUSINESS_LOGO",
    "MOBILE_APP",
    "PRICE",
    "PROMOTION",
    "LEAD_FORM",
]);

export async function associateAsset(
    level: AssetAssociationLevel,
    parentId: string,
    req: any,
    res: any
) {
    if (!/^\d+$/.test(parentId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid campaign or ad group ID",
        });
    }

    const {
        assetId,
        fieldType,
        status = "ENABLED",
        validateOnly = true,
        confirm = false,
    } = req.body;

    if (!/^\d+$/.test(String(assetId ?? ""))) {
        return res.status(400).json({
            success: false,
            message: "A valid assetId is required",
        });
    }

    if (!ALLOWED_FIELD_TYPES.has(fieldType)) {
        return res.status(400).json({
            success: false,
            message: "Unsupported fieldType",
        });
    }

    if (!["ENABLED", "PAUSED"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Status must be ENABLED or PAUSED",
        });
    }

    if (typeof validateOnly !== "boolean") {
        return res.status(400).json({
            success: false,
            message: "validateOnly must be a boolean",
        });
    }

    if (!validateOnly && confirm !== true) {
        return res.status(400).json({
            success: false,
            message: "Set confirm: true for live association",
        });
    }

    const accessToken = await getAccessToken();
    const config = getGoogleAdsConfig(res);

    if (!config) return;

    const { customerId, developerToken } = config;
    const { endpoint, resourceKey } = ASSOCIATION_CONFIG[level];

    const parentResource =
        `customers/${customerId}/${level === "campaign" ? "campaigns" : "adGroups"}/${parentId}`;

    const assetResource =
        `customers/${customerId}/assets/${assetId}`;

    const payload = {
        operations: [
            {
                create: {
                    [resourceKey]: parentResource,
                    asset: assetResource,
                    fieldType,
                    status,
                },
            },
        ],
        validateOnly,
    };

    const raw: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/${endpoint}`,
        accessToken,
        developerToken,
        payload
    );

    const data =
        raw?.data?.data ??
        raw?.data ??
        raw;

    const apiError = data?.error ?? raw?.error;

    if (apiError) {
        const failure = apiError.details?.find(
            (item: any) =>
                item["@type"]?.includes("GoogleAdsFailure")
        );

        const googleError = failure?.errors?.[0];
        console.log(
            "google error:: ",
            failure?.errors[0].location
        );

        return res.status(400).json({
            success: false,
            message:
                googleError?.message ??
                apiError.message ??
                "Google Ads API request failed",
            errorCode: googleError?.errorCode ?? null,
            requestId:
                failure?.requestId ??
                raw?.headers?.["request-id"] ??
                null,
        });
    }

    return res.status(200).json({
        success: true,
        validateOnly,
        message: validateOnly
            ? "Asset association validated"
            : "Asset association created",
        results: data?.results ?? [],
    });
}


interface CreateVideoAssetParams {
    customerId: string;
    accessToken: string;
    developerToken: string;
    videoId: string;
    videoTitle: string;
    assetName?: string;
}

export async function createGoogleAdsVideoAsset({
    customerId,
    accessToken,
    developerToken,
    videoId,
    videoTitle,
    assetName,
}: CreateVideoAssetParams) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        throw new Error("Invalid YouTube video ID");
    }

    const response: any = await googleAdsRequest(
        `${GOOGLE_ADS_BASE_URL}/${customerId}/assets:mutate`,
        accessToken,
        developerToken,
        {
            operations: [
                {
                    create: {
                        name: assetName || videoTitle,
                        youtubeVideoAsset: {
                            youtubeVideoId: videoId,
                            youtubeVideoTitle: videoTitle,
                        },
                    },
                },
            ],
        }
    );

    const data =
        response?.data?.data ??
        response?.data ??
        response;

    if (data?.error) {
        throw new Error(
            data.error.message ??
            "Failed to create Google Ads video asset"
        );
    }

    const result = data?.results?.[0];

    if (!result?.resourceName) {
        throw new Error(
            "Google Ads did not return an asset resource name"
        );
    }

    return {
        resourceName: result.resourceName,
        assetId: result.resourceName.split("/").pop(),
        videoId,
        videoTitle,
    };
}



type AssociationLevel = "campaign" | "adGroup" | "assetGroup";

const ALLOWED_FIELD_TYPES_de: Record<AssociationLevel, string[]> = {
    campaign: [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "AD_IMAGE" // ✅ Sirf AD_IMAGE rahega, "IMAGE" ko delete kar dein
    ],

    adGroup: [
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "AD_IMAGE" // ✅ Sirf AD_IMAGE rahega, "IMAGE" ko delete kar dein
    ],

    assetGroup: [
        "HEADLINE",
        "LONG_HEADLINE",
        "DESCRIPTION",
        "LONG_DESCRIPTION",
        "MARKETING_IMAGE",
        "SQUARE_MARKETING_IMAGE",
        "PORTRAIT_MARKETING_IMAGE",
        "LOGO",
        "LANDSCAPE_LOGO",
        "YOUTUBE_VIDEO",
        "BUSINESS_NAME",
    ],
};


export async function createAssetAssociation(
    req: any,
    res: any,
    level: AssociationLevel
) {
    try {
        const idKey = {
            campaign: "campaignId",
            adGroup: "adGroupId",
            assetGroup: "assetGroupId",
        }[level];

        const targetId = String(req.body[idKey] ?? "");
        const assetId = String(req.body.assetId ?? "");
        const fieldType = String(req.body.fieldType ?? "")
            .trim()
            .toUpperCase();

        console.log(
            "assets ID:: ", assetId,
            "targetId::   ", targetId
        );


        if (!/^\d+$/.test(targetId) || !/^\d+$/.test(assetId)) {
            return res.status(400).json({
                success: false,
                message: `${idKey} and assetId must be numeric IDs`,
            });
        }

        if (!ALLOWED_FIELD_TYPES_de[level].includes(fieldType)) {
            return res.status(400).json({
                success: false,
                message: `Unsupported fieldType for ${level}`,
                allowedFieldTypes: ALLOWED_FIELD_TYPES_de[level],
            });
        }

        // Safe by default: validate only unless explicitly disabled.
        const validateOnly =
            String(req.body.validateOnly ?? "true").toLowerCase() !== "false";

        const confirm =
            req.body.confirm === true ||
            String(req.body.confirm ?? "").toLowerCase() === "true";

        if (!validateOnly && !confirm) {
            return res.status(400).json({
                success: false,
                message: "Set confirm: true for live association creation",
            });
        }

        const accessToken = await getAccessToken();
        const config = getGoogleAdsConfig(res);

        if (!config) return;

        const customerId = String(config.customerId).replace(/-/g, "");
        const { developerToken } = config;

        const targetResourceNames = {
            campaign: `customers/${customerId}/campaigns/${targetId}`,
            adGroup: `customers/${customerId}/adGroups/${targetId}`,
            assetGroup: `customers/${customerId}/assetGroups/${targetId}`,
        };

        const targetResource = targetResourceNames[level];
        const assetResource =
            `customers/${customerId}/assets/${assetId}`;

        let service: string;
        let create: Record<string, string>;

        if (level === "campaign") {
            service = "campaignAssets";

            create = {
                campaign: targetResource,
                asset: assetResource,
                fieldType,
                status: "ENABLED",
            };
        } else if (level === "adGroup") {
            service = "adGroupAssets";

            create = {
                adGroup: targetResource,
                asset: assetResource,
                fieldType,
                status: "ENABLED",
            };
        } else {
            service = "assetGroupAssets";

            create = {
                assetGroup: targetResource,
                asset: assetResource,
                fieldType,
                status: "ENABLED",
            };
        }

        const rawResponse: any = await googleAdsRequest(
            `${GOOGLE_ADS_BASE_URL}/${customerId}/${service}:mutate`,
            accessToken,
            developerToken,
            {
                operations: [{ create }],
                validateOnly,
            }
        );

        const data =
            rawResponse?.data?.data ??
            rawResponse?.data ??
            rawResponse;

        const apiError =
            data?.error ??
            data?.results?.data?.error ??
            data?.data?.error;

        if (apiError) {
            const googleFailure = apiError.details?.find(
                (item: any) =>
                    item["@type"]?.includes("GoogleAdsFailure")
            );

            const firstError = googleFailure?.errors?.[0];

            return res.status(
                Number(apiError.code) >= 400 &&
                    Number(apiError.code) <= 599
                    ? Number(apiError.code)
                    : 502
            ).json({
                success: false,
                message:
                    firstError?.message ??
                    apiError.message ??
                    "Google Ads API request failed",
                errorCode: firstError?.errorCode,
                requestId: googleFailure?.requestId,
            });
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: getErrorMessage(error),
        });
    }
}

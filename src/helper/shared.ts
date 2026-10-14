import { Response } from 'express'
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

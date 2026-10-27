
import { META_DATE_PRESETS } from "./filtering.js";

type DateFilterInput = {
    datePreset?: unknown;
    since?: unknown;
    until?: unknown;
};

type DateFilterResult =
    | {
        success: true;
        params: URLSearchParams;
        dateFilter:
        | { type: "preset"; datePreset: string }
        | { type: "custom"; since: string; until: string };
    }
    | {
        success: false;
        message: string;
    };

function isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);

    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

export function buildInsightsDateFilter(
    input: DateFilterInput
): DateFilterResult {
    const { datePreset, since, until } = input;

    const hasPreset = datePreset !== undefined;
    const hasSince = since !== undefined;
    const hasUntil = until !== undefined;

    if (hasPreset && (hasSince || hasUntil)) {
        return {
            success: false,
            message:
                "Use either datePreset or since/until, not both",
        };
    }

    if (hasSince || hasUntil) {
        if (
            typeof since !== "string" ||
            typeof until !== "string" ||
            !isValidDate(since) ||
            !isValidDate(until)
        ) {
            return {
                success: false,
                message:
                    "Both since and until must be valid YYYY-MM-DD dates",
            };
        }

        if (since > until) {
            return {
                success: false,
                message: "since cannot be after until",
            };
        }

        const params = new URLSearchParams();

        params.set(
            "time_range",
            JSON.stringify({ since, until })
        );

        return {
            success: true,
            params,
            dateFilter: {
                type: "custom",
                since,
                until,
            },
        };
    }

    if (hasPreset && typeof datePreset !== "string") {
        return {
            success: false,
            message: "datePreset must be a string",
        };
    }

    const selectedPreset =
        (datePreset as string | undefined) ??
        META_DATE_PRESETS.LAST_30D;

    const allowedPresets: string[] =
        Object.values(META_DATE_PRESETS);

    if (!allowedPresets.includes(selectedPreset)) {
        return {
            success: false,
            message: "Unsupported datePreset value",
        };
    }

    const params = new URLSearchParams();
    params.set("date_preset", selectedPreset);

    return {
        success: true,
        params,
        dateFilter: {
            type: "preset",
            datePreset: selectedPreset,
        },
    };
}

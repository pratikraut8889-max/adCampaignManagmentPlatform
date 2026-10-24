/**
 * Mutation safety policy for every write route.
 *
 *  - Validation only is the default.
 *  - A live change needs BOTH  "validateOnly": false  AND  "confirm": true
 *    (real JSON booleans, not strings).
 *  - "validateOnly": false without "confirm": true is rejected, never run live.
 */
export type MutationMode = {
    validateOnly: boolean;
    error?: string;
};

export function parseMutationMode(body: unknown): MutationMode {
    const input = (body ?? {}) as Record<string, unknown>;

    if (input.validateOnly === false) {
        if (input.confirm === true) {
            return { validateOnly: false };
        }

        return {
            validateOnly: true,
            error:
                'Live changes need both "validateOnly": false and "confirm": true.',
        };
    }

    return { validateOnly: true };
}

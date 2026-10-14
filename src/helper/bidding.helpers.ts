/**
 * Shared Google Ads API v25 campaign bidding configuration.
 *
 * This helper builds the campaign-level `campaign_bidding_strategy` fields.
 * It does not create or assign portfolio BiddingStrategy resources; those are
 * handled by the portfolio routes in bidding.routes.ts.
 */

export type BiddingStrategy =
  | "MANUAL_CPC"
  | "MANUAL_CPM"
  | "MAXIMIZE_CLICKS"
  | "MAXIMIZE_CONVERSIONS"
  | "MAXIMIZE_CONVERSION_VALUE"
  | "TARGET_CPA"
  | "TARGET_ROAS"
  | "TARGET_CPC";

export type BiddingOptions = {
  /** Currency units, converted to micros before sending to Google Ads. */
  targetCpa?: number;
  /** Example: 3.5 means a 3.5x return on ad spend. */
  targetRoas?: number;
  /** Maximum CPC ceiling for Maximize Clicks, in account currency units. */
  cpcBidCeiling?: number;
  /** Target CPC for Demand Gen, in account currency units. */
  targetCpc?: number;
};

export class BiddingConfigurationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "BiddingConfigurationError";
  }
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}

function currencyToMicros(value: number): string {
  return String(Math.round(value * 1_000_000));
}

function validateTargetCpa(value: unknown): asserts value is number {
  if (!isPositiveFiniteNumber(value)) {
    throw new BiddingConfigurationError(
      "targetCpa must be a positive number in the account currency"
    );
  }
}

function validateTargetRoas(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.01 ||
    value > 1000
  ) {
    throw new BiddingConfigurationError(
      "targetRoas must be a number between 0.01 and 1000"
    );
  }
}

/**
 * Builds the bidding strategy fields to merge into a Campaign create/update
 * object. `campaignType` is optional, but when supplied it is used to reject
 * strategies that are clearly incompatible with the requested campaign type.
 * Google Ads remains the final authority for full eligibility validation.
 */
export function buildBiddingConfig(
  strategyInput: string,
  options: BiddingOptions = {},
  campaignType?: string
): Record<string, unknown> {
  const strategy = strategyInput.trim().toUpperCase() as BiddingStrategy;
  const channel = campaignType?.trim().toUpperCase();

  switch (strategy) {
    case "MANUAL_CPC":
      if (channel === "PERFORMANCE_MAX") {
        throw new BiddingConfigurationError(
          "MANUAL_CPC is not supported for Performance Max campaigns"
        );
      }
      return { manualCpc: {} };

    case "MANUAL_CPM":
      if (channel && channel !== "DISPLAY") {
        throw new BiddingConfigurationError(
          "MANUAL_CPM is only supported for Display Network campaigns"
        );
      }
      return { manualCpm: {} };

    case "MAXIMIZE_CLICKS": {
      const targetSpend: Record<string, unknown> = {};

      if (options.cpcBidCeiling !== undefined) {
        if (!isPositiveFiniteNumber(options.cpcBidCeiling)) {
          throw new BiddingConfigurationError(
            "cpcBidCeiling must be a positive number in the account currency"
          );
        }
        targetSpend.cpcBidCeilingMicros = currencyToMicros(
          options.cpcBidCeiling
        );
      }

      // Google Ads represents Maximize Clicks with the TargetSpend scheme.
      return { targetSpend };
    }

    case "MAXIMIZE_CONVERSIONS": {
      const maximizeConversions: Record<string, unknown> = {};
      if (options.targetCpa !== undefined) {
        validateTargetCpa(options.targetCpa);
        maximizeConversions.targetCpaMicros = currencyToMicros(
          options.targetCpa
        );
      }
      return { maximizeConversions };
    }

    case "TARGET_CPA": {
      // Standard Target CPA behavior uses Maximize Conversions with target CPA.
      validateTargetCpa(options.targetCpa);
      return {
        maximizeConversions: {
          targetCpaMicros: currencyToMicros(options.targetCpa),
        },
      };
    }

    case "MAXIMIZE_CONVERSION_VALUE": {
      const maximizeConversionValue: Record<string, unknown> = {};
      if (options.targetRoas !== undefined) {
        validateTargetRoas(options.targetRoas);
        maximizeConversionValue.targetRoas = options.targetRoas;
      }
      return { maximizeConversionValue };
    }

    case "TARGET_ROAS": {
      // Standard Target ROAS behavior uses Maximize Conversion Value.
      validateTargetRoas(options.targetRoas);
      return {
        maximizeConversionValue: {
          targetRoas: options.targetRoas,
        },
      };
    }

    case "TARGET_CPC": {
      if (channel && channel !== "DEMAND_GEN") {
        throw new BiddingConfigurationError(
          "TARGET_CPC is intended for Demand Gen campaigns"
        );
      }
      if (!isPositiveFiniteNumber(options.targetCpc)) {
        throw new BiddingConfigurationError(
          "targetCpc must be a positive number in the account currency"
        );
      }
      return {
        targetCpc: {
          targetCpcMicros: currencyToMicros(options.targetCpc),
        },
      };
    }

    default:
      throw new BiddingConfigurationError(
        `Unsupported bidding strategy: ${strategyInput}`
      );
  }
}

/** Returns the root bidding field for the Google Ads updateMask. */
export function getBiddingUpdateMask(
  biddingConfig: Record<string, unknown>
): string {
  const fields = Object.keys(biddingConfig);
  if (fields.length !== 1) {
    throw new BiddingConfigurationError(
      "A bidding configuration must contain exactly one strategy field"
    );
  }
  return fields[0];
}

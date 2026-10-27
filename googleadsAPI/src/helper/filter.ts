const GOOGLE_ADS_DATE_LITERALS = {
    TODAY: 'TODAY',
    YESTERDAY: 'YESTERDAY',
    THIS_WEEK_SUN_TODAY: 'THIS_WEEK_SUN_TODAY',
    THIS_WEEK_MON_TODAY: 'THIS_WEEK_MON_TODAY',
    LAST_WEEK_SUN_SAT: 'LAST_WEEK_SUN_SAT',
    LAST_WEEK_MON_SUN: 'LAST_WEEK_MON_SUN',
    THIS_MONTH: 'THIS_MONTH',
    LAST_MONTH: 'LAST_MONTH',
    LAST_7_DAYS: 'LAST_7_DAYS',
    LAST_14_DAYS: 'LAST_14_DAYS',
    LAST_30_DAYS: 'LAST_30_DAYS',
    LAST_BUSINESS_WEEK: 'LAST_BUSINESS_WEEK',
    // Historical bounds (up to 11 years for aggregated records)
    ALL_TIME: 'ALL_TIME'
};

Object.freeze(GOOGLE_ADS_DATE_LITERALS);

const GOOGLE_ADS_TIME_SEGMENTS = {
    HOUR: 'segments.hour',
    DAY: 'segments.date',
    WEEK: 'segments.week',
    MONTH: 'segments.month',
    QUARTER: 'segments.quarter',
    YEAR: 'segments.year',
    DAY_OF_WEEK: 'segments.day_of_week'
};

Object.freeze(GOOGLE_ADS_TIME_SEGMENTS);

const GOOGLE_ADS_FILTER_PATTERNS = {
    // Pattern 1: Literal Range Filtering
    // Example: "SELECT metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS"
    duringLiteral: (literal: any) => `DURING ${literal}`,

    // Pattern 2: Custom Range Filtering (Inclusive)
    // Format must strictly be: YYYY-MM-DD or YYYYMMDD
    // Example: "WHERE segments.date BETWEEN '2026-01-01' AND '2026-06-30'"
    betweenCustomDates: (startDate: string, endDate: string) => `BETWEEN '${startDate}' AND '${endDate}'`,

    // Pattern 3: Rolling/Relative Bounds Comparisons
    // Example: "WHERE segments.date >= '2025-10-27'"
    greaterThanOrEqual: (date: string) => `>= '${date}'`,
    lessThanOrEqual: (date: string) => `<= '${date}'`
};

Object.freeze(GOOGLE_ADS_FILTER_PATTERNS);

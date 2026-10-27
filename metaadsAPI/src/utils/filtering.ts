const META_DATE_PRESETS = Object.freeze({
    // Standard Presets
    TODAY: 'today',
    YESTERDAY: 'yesterday',
    THIS_WEEK_SUN_TODAY: 'this_week_sun_today',
    THIS_WEEK_MON_TODAY: 'this_week_mon_today',
    LAST_WEEK_SUN_SAT: 'last_week_sun_sat',
    LAST_WEEK_MON_SUN: 'last_week_mon_sun',
    THIS_MONTH: 'this_month',
    LAST_MONTH: 'last_month',
    THIS_QUARTER: 'this_quarter',
    LAST_QUARTER: 'last_quarter',
    THIS_YEAR: 'this_year',
    LAST_YEAR: 'last_year',

    // Rolling Window Presets
    LAST_3D: 'last_3d',
    LAST_7D: 'last_7d',
    LAST_14D: 'last_14d',
    LAST_28D: 'last_28d',
    LAST_30D: 'last_30d',
    LAST_90D: 'last_90d',
    LAST_180D: 'last_180d',

    // Maximum Historical Window (Replaced 'lifetime')
    MAXIMUM: 'maximum'
} as const);


const META_ACTION_BREAKDOWNS = Object.freeze({
    ACTION_TYPE: 'action_type',               // e.g. purchase, lead, link_click
    ACTION_TARGET_ID: 'action_target_id',       // The ID of the page, app, or placement receiving the action
    ACTION_DEVICE: 'action_device',           // Device used during conversion (e.g. mobile_web, desktop)
    ACTION_DESTINATION: 'action_destination',   // URL or App store destination redirection location

    // Attribution Type Splits
    ACTION_CANVAS_COMPONENT_NAME: 'action_canvas_component_name',
    ACTION_CAROUSEL_CARD_ID: 'action_carousel_card_id', // Identifies which exact image/video card converted
    ACTION_CAROUSEL_CARD_NAME: 'action_carousel_card_name'

} as const);


const META_INSIGHTS_BREAKDOWNS = Object.freeze({
    // Demographic Breakdowns
    AGE: 'age',
    GENDER: 'gender',
    AGE_AND_GENDER: 'age,gender',

    // Geography 
    COUNTRY: 'country',
    REGION: 'region',
    DMA: 'dma', // Direct Marketing Area (US only)

    // Delivery & Platform Placements
    PUBLISHER_PLATFORM: 'publisher_platform', // facebook, instagram, messenger, audience_network
    PLATFORM_POSITION: 'platform_position',   // feed, stories, marketplace
    DEVICE_PLATFORM: 'device_platform',       // mobile, desktop
    IMPRESSION_DEVICE: 'impression_device',   // iPhone, Android device, etc.

    // Time Intervals (Used alongside custom date ranges)
    HOURLY_AD_ACCOUNT_TIMEZONE: 'hourly_stats_aggregated_by_advertiser_time_zone',
    HOURLY_AUDIENCE_TIMEZONE: 'hourly_stats_aggregated_by_audience_time_zone',

    // Asset Diagnostics
    CREATIVE_ASSET: 'creative_asset'
} as const);


// Valid filtering operators recognized by the Graph API engine
const META_FILTER_OPERATORS = Object.freeze({
    EQUAL: 'EQUAL',
    NOT_EQUAL: 'NOT_EQUAL',
    GREATER_THAN: 'GREATER_THAN',
    GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
    LESS_THAN: 'LESS_THAN',
    LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
    IN: 'IN',
    NOT_IN: 'NOT_IN',
    CONTAIN: 'CONTAIN',
    NOT_CONTAIN: 'NOT_CONTAIN',
    ANY: 'ANY',
    ALL: 'ALL'
} as const);

// Common target strings used inside the "field" element
const META_FILTER_TARGETS = Object.freeze({
    // Delivery State & Meta Objects
    CAMPAIGN_ID: 'campaign.id',
    CAMPAIGN_NAME: 'campaign.name',
    CAMPAIGN_DELIVERY_STATUS: 'campaign.delivery_status',
    ADSET_ID: 'adset.id',
    ADSET_NAME: 'adset.name',
    ADSET_DELIVERY_STATUS: 'adset.delivery_status',
    AD_ID: 'ad.id',
    AD_NAME: 'ad.name',
    AD_DELIVERY_STATUS: 'ad.delivery_status',

    // Platform & Placement
    PUBLISHER_PLATFORM: 'publisher_platform', // e.g. facebook, instagram
    PLATFORM_POSITION: 'platform_position',   // e.g. feed, stories
    DEVICE_PLATFORM: 'device_platform',       // e.g. desktop, mobile

    // Performance Thresholds
    SPEND: 'spend',
    IMPRESSIONS: 'impressions',
    CLICKS: 'clicks',
    REACH: 'reach'
} as const);


const META_INSIGHTS_LEVELS = Object.freeze({
    AD: 'ad',
    ADSET: 'adset',
    CAMPAIGN: 'campaign',
    AD_ACCOUNT: 'account'
} as const);

export { META_DATE_PRESETS, META_INSIGHTS_LEVELS, META_FILTER_OPERATORS, META_FILTER_TARGETS, META_INSIGHTS_BREAKDOWNS, META_ACTION_BREAKDOWNS };

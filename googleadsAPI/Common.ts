const GOOGLE_CAMPAIGN_TYPES = {
    SEARCH: 'SEARCH',                 // Standard Google Text Search Network
    DISPLAY: 'DISPLAY',               // Visual ads across Google Display Network
    PERFORMANCE_MAX: 'PERFORMANCE_MAX', // AI-driven cross-channel engine
    DEMAND_GEN: 'DEMAND_GEN',         // Visual/Social feeds (YouTube, Discover, Gmail)
    SHOPPING: 'SHOPPING',             // Retail product feeds
    VIDEO: 'VIDEO',                   // YouTube video campaign variants
    HOTEL: 'HOTEL',                   // Hotel / Travel placement systems
    LOCAL: 'LOCAL',                   // Local business store visit campaigns
    APP: 'APP'                        // App installs and engagement pushes
};

Object.freeze(GOOGLE_CAMPAIGN_TYPES);


const GOOGLE_CAMPAIGN_SUB_TYPES = {
    SEARCH_MOBILE_APP: 'SEARCH_MOBILE_APP',
    DISPLAY_MOBILE_APP: 'DISPLAY_MOBILE_APP',
    SHOPPING_PRODUCT_ADS: 'SHOPPING_PRODUCT_ADS',
    SHOPPING_SMART_ADS: 'SHOPPING_SMART_ADS',
    VIDEO_OUTSTREAM: 'VIDEO_OUTSTREAM',
    VIDEO_ACTION: 'VIDEO_ACTION',
    TRAVEL_GOALS: 'TRAVEL_GOALS' // Specifically for localized/hotel variants
};

Object.freeze(GOOGLE_CAMPAIGN_SUB_TYPES);

const GOOGLE_BIDDING_STRATEGIES = {
    // Automated Smart Bidding (Focuses on Conversions)
    MAXIMIZE_CONVERSIONS: 'MAXIMIZE_CONVERSIONS',
    MAXIMIZE_CONVERSION_VALUE: 'MAXIMIZE_CONVERSION_VALUE',
    TARGET_CPA: 'TARGET_CPA',   // Target Cost Per Acquisition
    TARGET_ROAS: 'TARGET_ROAS', // Target Return on Ad Spend

    // Traffic / Impression Focused Strategies
    MAXIMIZE_CLICKS: 'MAXIMIZE_CLICKS',
    TARGET_IMPRESSION_SHARE: 'TARGET_IMPRESSION_SHARE',

    // Manual Control Strategies
    MANUAL_CPC: 'MANUAL_CPC', // Pure Manual Cost-Per-Click
    MANUAL_CPM: 'MANUAL_CPM', // Cost per thousand impressions
    MANUAL_CPV: 'MANUAL_CPV', // Cost per view (Video)

    // Custom Niche Strategies
    PERCENT_CPC: 'PERCENT_CPC' // Used heavily in Hotel placement configurations
};

Object.freeze(GOOGLE_BIDDING_STRATEGIES);


const GOOGLE_NETWORK_FIELDS = {
    TARGET_GOOGLE_SEARCH: 'campaign.network_settings.target_google_search',
    TARGET_SEARCH_PARTNERS: 'campaign.network_settings.target_search_partners',
    TARGET_CONTENT_NETWORK: 'campaign.network_settings.target_content_network', // Display Network
    TARGET_PARTNER_SEARCH_NETWORK: 'campaign.network_settings.target_partner_search_network'
};

Object.freeze(GOOGLE_NETWORK_FIELDS);

import { GOOGLE_CAMPAIGN_TYPES, GOOGLE_BIDDING_STRATEGIES } from './googleCampaignConfig.js';

function buildStructuralAuditQuery() {
    return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      campaign.bidding_strategy_type,
      campaign.network_settings.target_google_search,
      campaign.network_settings.target_search_partners,
      campaign.network_settings.target_content_network,
      campaign.target_cpa.target_cpa_micros,
      campaign.target_roas.target_roas,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status IN ('ENABLED', 'PAUSED')
      AND campaign.advertising_channel_type = '${GOOGLE_CAMPAIGN_TYPES.PERFORMANCE_MAX}'
  `;
}

console.log(buildStructuralAuditQuery());


const GOOGLE_ADS_CAMPAIGN_HIERARCHY = {
    // Core Entry Point (Root)
    RESOURCE_NAME: 'campaign',

    // Node 1: Channel Segmentation & Inventory Type
    channelStructure: {
        field: 'campaign.advertising_channel_type',
        types: {
            SEARCH: {
                value: 'SEARCH',
                subTypes: ['SEARCH_MOBILE_APP', 'STANDARD']
            },
            DISPLAY: {
                value: 'DISPLAY',
                subTypes: ['DISPLAY_MOBILE_APP', 'STANDARD']
            },
            SHOPPING: {
                value: 'SHOPPING',
                subTypes: ['SHOPPING_PRODUCT_ADS', 'SHOPPING_SMART_ADS']
            },
            PERFORMANCE_MAX: {
                value: 'PERFORMANCE_MAX',
                subTypes: ['STANDARD']
            },
            DEMAND_GEN: {
                value: 'DEMAND_GEN',
                subTypes: ['STANDARD']
            },
            VIDEO: {
                value: 'VIDEO',
                subTypes: ['VIDEO_OUTSTREAM', 'VIDEO_ACTION', 'VIDEO_NON_SKIPPABLE']
            }
        }
    },

    // Node 2: Financial & Valuation Engine
    biddingHierarchy: {
        strategyField: 'campaign.bidding_strategy_type',
        schemes: {
            // Conversion Focus Tree
            CONVERSION_DRIVEN: {
                MAXIMIZE_CONVERSIONS: {
                    value: 'MAXIMIZE_CONVERSIONS',
                    metaField: 'campaign.maximize_conversions'
                },
                TARGET_CPA: {
                    value: 'TARGET_CPA',
                    metaField: 'campaign.target_cpa.target_cpa_micros' // Nested target node
                }
            },
            // Value / Revenue Focus Tree
            VALUE_DRIVEN: {
                MAXIMIZE_CONVERSION_VALUE: {
                    value: 'MAXIMIZE_CONVERSION_VALUE',
                    metaField: 'campaign.maximize_conversion_value'
                },
                TARGET_ROAS: {
                    value: 'TARGET_ROAS',
                    metaField: 'campaign.target_roas.target_roas' // Float multiplier ratio
                }
            },
            // Traffic Volume Focus Tree
            VOLUME_DRIVEN: {
                MAXIMIZE_CLICKS: {
                    value: 'MAXIMIZE_CLICKS',
                    metaField: 'campaign.maximize_clicks.target_cpc_micros'
                },
                TARGET_IMPRESSION_SHARE: {
                    value: 'TARGET_IMPRESSION_SHARE',
                    metaField: 'campaign.target_impression_share'
                }
            },
            // Manual Control Core
            MANUAL_DRIVEN: {
                MANUAL_CPC: { value: 'MANUAL_CPC', metaField: 'campaign.manual_cpc' },
                MANUAL_CPM: { value: 'MANUAL_CPM', metaField: 'campaign.manual_cpm' },
                MANUAL_CPV: { value: 'MANUAL_CPV', metaField: 'campaign.manual_cpv' }
            }
        }
    },

    // Node 3: Environment Distribution Boundaries
    networkSettings: {
        rootField: 'campaign.network_settings',
        nodes: [
            { name: 'googleSearch', field: 'campaign.network_settings.target_google_search' },
            { name: 'searchPartners', field: 'campaign.network_settings.target_search_partners' },
            { name: 'contentNetwork', field: 'campaign.network_settings.target_content_network' }, // Display
            { name: 'partnerSearch', field: 'campaign.network_settings.target_partner_search_network' }
        ]
    }
};

Object.freeze(GOOGLE_ADS_CAMPAIGN_HIERARCHY);
export default GOOGLE_ADS_CAMPAIGN_HIERARCHY;

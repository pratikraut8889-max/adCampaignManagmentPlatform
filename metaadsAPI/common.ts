const META_CAMPAIGN_OBJECTIVES = {
    OUTCOMES_AWARENESS: 'OUTCOMES_AWARENESS',   // Reach, brand awareness, video views
    OUTCOMES_TRAFFIC: 'OUTCOMES_TRAFFIC',       // Link clicks, landing page views
    OUTCOMES_ENGAGEMENT: 'OUTCOMES_ENGAGEMENT', // Messages, video views, post engagement
    OUTCOMES_LEADS: 'OUTCOMES_LEADS',           // Instant forms, registrations
    OUTCOMES_APP_PROMOTION: 'OUTCOMES_APP_PROMOTION', // App installs and events
    OUTCOMES_SALES: 'OUTCOMES_SALES'            // Conversions, catalog sales
};

Object.freeze(META_CAMPAIGN_OBJECTIVES);

const META_BUYING_TYPES = {
    AUCTION: 'AUCTION',         // Standard competitive auction system
    REACH_AND_FREQUENCY: 'RF'   // Fixed price, guaranteed distribution model
};

Object.freeze(META_BUYING_TYPES);


const META_BID_STRATEGIES = {
    LOWEST_COST_WITHOUT_CAP: 'LOWEST_COST_WITHOUT_CAP', // Meta volume maximization (Highest Volume)
    LOWEST_COST_WITH_BID_CAP: 'LOWEST_COST_WITH_BID_CAP', // Strict maximum ceiling limit (Bid Cap)
    COST_MIN: 'COST_MIN',                               // System works around average targets (Cost Cap)
    ROI_MIN: 'ROI_MIN'                                  // Specific purchase value engine (Minimum ROAS)
};

Object.freeze(META_BID_STRATEGIES);


const META_SMART_PROMOTION_TYPES = {
    NONE: 'NONE',                                     // Standard manual targeting framework
    ADVANTAGE_PLUS_SHOPPING: 'ASC_CAMPAIGN',          // Advantage+ Shopping Campaign
    ADVANTAGE_PLUS_APP_PROMOTION: 'AAA_CAMPAIGN',     // Automated App Ads
    ADVANTAGE_PLUS_LEADS: 'ADVANTAGE_LEADS_CAMPAIGN'  // Tailored Lead Generation
};

Object.freeze(META_SMART_PROMOTION_TYPES);


const META_CAMPAIGN_STRUCTURAL_HIERARCHY = {
    // --- PARENT NODE: CAMPAIGN LEVEL ---
    campaign: {
        fields: {
            id: 'string (unique key)',
            name: 'string',
            status: ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'],
            buying_type: META_BUYING_TYPES,
            objective: META_CAMPAIGN_OBJECTIVES,
            smart_promotion_type: META_SMART_PROMOTION_TYPES,

            // Budget Fluidity Logic (Advantage Campaign Budget)
            bid_strategy: META_BID_STRATEGIES,
            daily_budget: 'string (represented in cents/micros)',
            lifetime_budget: 'string (represented in cents/micros)'
        },

        // --- CHILD NODE: AD SET LEVEL ---
        children: {
            adset: {
                fields: {
                    id: 'string (unique key)',
                    campaign_id: 'string (foreign key)',
                    name: 'string',
                    status: ['ACTIVE', 'PAUSED'],

                    // Ad Set Level Budgets (Populated only if not active at the parent campaign level)
                    billing_event: ['IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS'],
                    optimization_goal: ['LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'OFFSITE_CONVERSIONS'],
                    bid_strategy: META_BID_STRATEGIES,
                    daily_budget: 'string',
                    lifetime_budget: 'string',

                    // Targeting Parameters Matrix
                    targeting: {
                        geo_locations: { countries: 'array', regions: 'array' },
                        age_min: 'int',
                        age_max: 'int',
                        genders: 'array [1 = Male, 2 = Female]',
                        flexible_spec: 'array (Detailed interest/behavior targeting maps)'
                    }
                },

                // --- GRANDCHILD NODE: AD LEVEL ---
                children: {
                    ad: {
                        fields: {
                            id: 'string (unique key)',
                            adset_id: 'string (foreign key)',
                            campaign_id: 'string (foreign key)',
                            name: 'string',
                            status: ['ACTIVE', 'PAUSED'],

                            // Creative Setup Maps
                            creative: {
                                id: 'string (creative reference asset id)',
                                title: 'string',
                                body: 'string',
                                image_url: 'string',
                                video_id: 'string',
                                call_to_action_type: ['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP']
                            }
                        }
                    }
                }
            }
        }
    }
};

Object.freeze(META_CAMPAIGN_STRUCTURAL_HIERARCHY);

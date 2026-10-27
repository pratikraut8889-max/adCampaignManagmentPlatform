
export const META_METRIC_DEFINITIONS = [
    { key: "impressions", label: "Impressions", type: "number" },
    { key: "reach", label: "Reach", type: "number" },
    { key: "clicks", label: "Clicks", type: "number" },
    { key: "inline_link_clicks", label: "Link Clicks", type: "number" },
    { key: "spend", label: "Amount Spent", type: "currency" },
    { key: "ctr", label: "CTR", type: "percentage" },
    { key: "cpc", label: "CPC", type: "currency" },
    { key: "cpm", label: "CPM", type: "currency" },
    { key: "frequency", label: "Frequency", type: "decimal" },
    { key: "actions", label: "Actions", type: "array" },
    { key: "cost_per_action_type", label: "Cost Per Action", type: "array" },
] as const;

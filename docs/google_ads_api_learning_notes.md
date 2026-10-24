# Google Ads API Learning Notes

## Project setup
- Backend: Node.js + TypeScript + Express.
- Google Ads API: REST API v25; direct HTTP requests, not the Google Ads SDK.
- Existing helpers: `getAccessToken()` from `../google_config.js`, `getGoogleAdsConfig(res)`, `googleAdsRequest(endpoint, accessToken, developerToken, body)`, `GOOGLE_ADS_BASE_URL = https://googleads.googleapis.com/v25/customers`, and `getErrorMessage()`.
- Learning customer ID: `8229327311`.
- Existing Search campaign ID: `24326130621`.
- Existing ad group ID: `202452874962`.
- Existing responsive search ad ID: `827726882382`.

## Learning roadmap
1. Campaigns and budgets — completed.
2. Ad groups — completed.
3. Keyword management — completed.
4. Ads management — completed.
5. Assets management — in progress.
6. Image assets and YouTube video ads.
7. Performance reporting.
8. Targeting.
9. Conversion tracking and reporting.
10. Production hardening.

## SaaS campaign creation flow
For a standard Search campaign, guide the user through a wizard:
1. Campaign basics and budget.
2. Create the campaign.
3. Create an ad group.
4. Add keywords.
5. Create responsive search ads.
6. Add optional assets.
7. Review, validate, and publish.

Important:
- Create the budget before attaching it to a campaign.
- Responsive Search Ad headlines and descriptions belong to the ad itself; they are not automatically standalone campaign assets.
- Performance Max uses asset groups and a different workflow from Search campaigns.
- Prefer validation-only/dry-run during setup. Apply live changes only after clear user confirmation.

## Existing Google Ads entities
- Campaign: `Website traffic-Search-1`
- Ad group: `Ad group 1 now Ad Group only`
- RSA final URL: `https://angular-nvidia-nemotron-ai-chatbot.onrender.com`
- RSA headlines include `AI Chatbot Online`, `Next-Gen AI Chat`, `OpenAI Powered App`, `chatgpt4`.
- RSA descriptions describe the conversational AI chatbot.

## Assets: key concepts
- An **asset** is reusable content such as text, an image, a call, or a sitelink.
- An **association** attaches an asset to an account, campaign, ad group, or (for Performance Max) an asset group, depending on the supported asset type and API resource.
- Creating an asset does not automatically attach it to a campaign or ad group.
- Association resources include `campaign_asset`, `ad_group_asset`, and `asset_group_asset`.
- The association's `field_type` indicates its role, such as a Performance Max headline or description.
- Not every asset type can be attached at every level; check API support and policy requirements.

## Current account asset findings
The account asset query returned 8 assets: 2 IMAGE, 1 CALL, and 5 TEXT.

Text asset examples:
- `429571439538` — `Simple Invoice Software`
- `429571439541` — `Create Invoices Online`
- `429571439544` — `Manage Business Billing`
- `429571439547` — `Create professional invoices and manage your billing in one place.`
- `429571439550` — `Save time with simple invoicing tools designed for your business.`

These invoice-related assets do not obviously match the chatbot RSA, so do not assume they should be associated with that campaign.

## Useful GAQL patterns

### List account assets
```sql
SELECT asset.id, asset.name, asset.resource_name, asset.type
FROM asset
```

### Get text asset content
```sql
SELECT asset.id, asset.name, asset.type, asset.text_asset.text
FROM asset
WHERE asset.type = 'TEXT'
```

### Inspect campaign asset associations
```sql
SELECT campaign.id, campaign.name,
       campaign_asset.asset, campaign_asset.field_type,
       campaign_asset.status, asset.id, asset.name, asset.type
FROM campaign_asset
WHERE campaign_asset.status != 'REMOVED'
```

### Inspect ad group asset associations
```sql
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
       ad_group_asset.asset, ad_group_asset.field_type,
       ad_group_asset.status, asset.id, asset.name, asset.type
FROM ad_group_asset
WHERE ad_group_asset.status != 'REMOVED'
```

The account currently returned zero campaign-asset and ad-group-asset associations for these queries. This means no matching associations were returned, not that the account has no assets.

## Parsing responses
The observed asset-query rows were at:
```ts
responseData?.data?.results ?? []
```
For account-asset queries, map each row to `row.asset`. Check the actual wrapper shape for each helper/endpoint instead of assuming all response shapes are identical.

## Important API lessons
- `asset.status` was not a valid general asset status filter in the query we tried. Status commonly belongs to an association resource, such as `campaign_asset.status` or `ad_group_asset.status`.
- For Performance Max, text content is `asset.text_asset.text`; its role is defined by `asset_group_asset.field_type` (such as `HEADLINE`, `DESCRIPTION`, or `LONG_HEADLINE`).
- Do not query `asset.type = 'HEADLINE'` to find RSA headlines. RSA headlines are nested inside `ad_group_ad.ad.responsive_search_ad.headlines`.
- Zero association results do not mean the account has zero assets.
- When changing associations, create and verify the new supported association before removing an old one.

## Safe mutation workflow
1. Validate inputs and resource names.
2. Run a validate-only request when supported.
3. Show the intended changes to the user.
4. Require explicit confirmation before live create/update/remove actions.
5. Execute the live mutation only after confirmation.
6. Read the resource back and report the result.
7. Log errors without exposing access tokens or developer tokens.

## Current learning status
Continue **standard Assets Management** first:
- Inspect existing asset content by subtype.
- Learn to create sitelink, callout, and structured snippet assets where applicable.
- Learn to associate supported assets with a campaign or ad group.
- Learn to update, pause, or remove associations safely.
- Test read/validation paths before live mutations.

After standard asset management is complete, continue to image assets and YouTube video ads, then reporting and targeting.

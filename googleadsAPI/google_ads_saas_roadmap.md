# \_~Google Ads SaaS Integration Roadmap

> **Scope rule:** Build and test one feature at a time. Performance reporting is its own feature after Ads & Assets; it is not part of the ad-group or keyword filtering work.
>
> **Status key:** `[x]` completed · `[~]` in progress · `[ ]` not started

## Progress at a glance

- [x] **1. Campaigns and budgets** — read, create, and update campaigns and budgets.
- [x] **2. Ad groups** — read, create, and update ad groups.
- [x] **3. Keyword management** — read/filter and create keywords; finish update, pause/enable, remove, validation, and testing.
- [x] **4. Ads & Assets** — responsive search ads and asset management.
- [ ] **5. Performance Reporting** — a separate read-only reporting feature covering available performance data at campaign, ad-group, ad, and keyword levels.
- [ ] **6. Targeting** — locations, languages, and audiences.
- [ ] **7. Conversion Tracking** — conversion actions, configuration, and checks that conversion data is recording.
- [ ] **8. Production hardening** — consistent validation, errors, pagination, retry/rate-limit handling, security, and tests across the integration.

---

<details>
<summary><strong>1. Campaigns and budgets — COMPLETED</strong></summary>

### Goal

Read campaign and budget data, create new resources safely, and update supported fields without accidentally changing live campaign behavior.

### Scope checklist

- [x] List campaigns and retrieve useful campaign attributes.
- [x] Read campaign status, type, and bidding-strategy information where requested.
- [x] List and inspect campaign budgets.
- [x] Create campaigns and budgets through Google Ads mutate endpoints.
- [x] Update supported campaign and budget fields.
- [ ] Later QA: exercise invalid IDs, invalid amounts, Google Ads API errors, and shared-budget cases.

### Key concepts

- A campaign uses a campaign budget resource; a budget is not the campaign itself.
- Budget amounts are represented in micros by the API. Convert them for display and preserve the account currency.
- A campaign's bidding strategy affects which bid fields are valid and whether bid changes are compatible.
- Shared budgets can affect more than one campaign; inspect `explicitlyShared` and associations before modifying a budget.

### Completion standard

The list/read/create/update routes behave consistently, reject malformed input, return useful API errors, and use validation-only mode before an explicitly confirmed live mutation.

</details>

<details>
<summary><strong>2. Ad groups — COMPLETED</strong></summary>

### Goal

Read, create, and update ad groups within a campaign.

### Scope checklist

- [x] List ad groups, optionally restricted by campaign ID.
- [x] Read an individual ad group's details.
- [x] Create an ad group in a selected campaign.
- [x] Update supported ad-group fields such as name and status.
- [x] Filter the list by campaign ID, status, and partial name.
- [ ] Later QA: test invalid/nonexistent campaign IDs, invalid status values, and Google Ads API errors.

### Key concepts

- Every ad group belongs to a campaign.
- Ad-group status and campaign status are separate. An enabled ad group under a paused campaign will not by itself make the campaign serve.
- Bid fields depend on the campaign's bidding strategy. Do not assume an ad-group CPC bid can be changed for every strategy.
- Performance data currently returned by a detail endpoint is not the full reporting feature; reporting will be built separately in Phase 5.

### Completion standard

Listing, detail reads, create, update, and filters work against the expected customer; mutations use validation-only mode unless live execution is explicitly confirmed.

</details>

<details>
<summary><strong>3. Keyword management — IN PROGRESS</strong></summary>

### Goal

Manage positive and negative keywords attached to an ad group, including bulk creation and filters.

### A. Read and filter keywords

- [x] List keywords for one ad group.
- [x] Filter by keyword status (`ENABLED` or `PAUSED`).
- [x] Filter by match type (`BROAD`, `PHRASE`, or `EXACT`).
- [x] Search by partial keyword text.
- [x] Filter positive versus negative keywords.
- [ ] Verify every filter combination against real results and handle an empty result set cleanly.

### B. Create keywords

- [~] Create one keyword.
- [~] Create multiple keywords in one request.

- [x] Test all supported match types and invalid payloads.
- [x] Make validation-only the default; require both `validateOnly: false` and explicit `confirm: true` before applying live changes.
- [x] Validate `adGroupId` before building the resource name.
- [x] Return a clear per-request result and surface Google Ads errors without hiding useful details.

### C. Update, pause, and enable keywords

- [x] Update an individual keyword using its criterion ID and the correct resource name format.
- [x] Allow `ENABLED` and `PAUSED` status values only.
- [x] Reject requests that contain no fields to update.
- [x] Build `updateMask` from the fields actually being changed.
- [x] Only support bid updates when compatible with the campaign's bidding strategy; test with validation-only first.

### D. Remove keywords

- [x] Add a `DELETE` API route for a keyword.
- [x] Send a Google Ads `remove` operation to the criterion mutation endpoint.
- [x] Keep validation-only as the default and require explicit confirmation for a live removal.
- [x] Explain that removal marks the criterion as removed; it does not mean reporting history is erased.

### Implementation details

- Read: use `GoogleAdsService` with the `ad_group_criterion` resource.
- Mutate: use the `adGroupCriteria:mutate` endpoint, not `adGroups:mutate`.
- A criterion resource name has the form `customers/{customerId}/adGroupCriteria/{adGroupId}~{criterionId}`.
- For keyword creation, `keyword` must be an object containing `text` and `matchType`.
- Keep keyword match type/status values allow-listed; do not interpolate arbitrary user strings into GAQL.

### Completion standard

The keyword read/create/update/remove lifecycle is implemented, filters return correct data, invalid inputs are rejected, and live mutations are protected by an explicit confirmation step.

</details>

<details>
<summary><strong>4. Ads & Assets — NOT STARTED</strong></summary>

### Goal

Create and manage the ads shown to users, starting with Responsive Search Ads, then add reusable assets and associations as needed.

### A. Read ads

- [ ] List ads within a selected ad group or campaign.
- [ ] Return ad ID, ad type, ad status, final URLs, and available headline/description information.
- [ ] Exclude removed ads by default, with an explicit option if historical/removed records are needed.
- [ ] Handle different ad types safely; fields available for a Responsive Search Ad may not exist for another type.

### B. Create Responsive Search Ads

- [ ] Accept an ad-group ID, final URL(s), headlines, and descriptions.
- [ ] Validate required content and applicable Google Ads limits before sending the request.
- [ ] Create the ad in a paused/safe state where supported by the workflow, and default to validation-only.
- [ ] Return the created resource identifiers and review/serving status when provided.
- [ ] Explain that API acceptance does not guarantee the ad is approved or eligible to serve; policy review can happen separately.

### C. Update and control ads

- [ ] Update supported fields using the correct ad-group-ad mutation resource and update mask.
- [ ] Pause and enable an ad.
- [ ] Remove an ad when needed, with confirmation and validation-only protection.
- [ ] Validate that the ad belongs to the expected customer/ad group before mutation.

### D. Assets

- [ ] Understand asset types relevant to the product (for example, headlines/descriptions in responsive search ads, sitelinks, callouts, and images where applicable).
- [ ] Read existing assets and their associations where supported.
- [ ] Create reusable assets only where needed.
- [ ] Associate assets with the correct customer, campaign, or ad group level.
- [ ] Remove or update associations carefully; asset ownership and association are distinct concepts.

### Completion standard

A user can read and safely manage supported search ads and their relevant assets; inputs, resource names, status, review state, and mutation errors are handled clearly.

</details>

<details>
<summary><strong>5. Performance Reporting — NEW SEPARATE FEATURE · NOT STARTED</strong></summary>

### Goal

Build a read-only reporting module that explains how campaigns, ad groups, ads, and keywords perform. It is separate from CRUD routes and separate from ordinary list filters.

### A. First report: campaign summary

- [ ] Add a dedicated campaign performance route for a defined date range (initially the last 30 days).
- [ ] Return campaign ID, name, status, and supported summary metrics.
- [ ] Start with impressions, clicks, CTR, average CPC, cost, conversions, conversion value, cost per conversion, and conversion value per cost where compatible.
- [ ] Convert micros to currency units for presentation and expose the account currency.
- [ ] Return zero/empty results cleanly and make it clear what date range was queried.

### B. Reports by entity

- [ ] Campaign performance summary.
- [ ] Ad-group performance.
- [ ] Individual ad performance.
- [ ] Keyword performance.
- [ ] Keep one report/query per logical level at first; don't force incompatible fields into one GAQL query.

### C. Core metrics and definitions

- [ ] **Impressions:** number of times ads were shown.
- [ ] **Clicks:** recorded clicks.
- [ ] **CTR:** clicks divided by impressions; format as a percentage in the UI.
- [ ] **Cost:** returned in micros; divide by 1,000,000 for the currency-unit value.
- [ ] **Average CPC:** average cost per click, where applicable.
- [ ] **Conversions:** conversions attributed to configured conversion actions and included in this metric.
- [ ] **Conversion value:** reported value associated with conversions.
- [ ] **Cost per conversion / CPA:** cost relative to conversions, where supported.
- [ ] **Conversion value per cost / ROAS-style ratio:** conversion value divided by cost, where supported.
- [ ] Optionally add all-conversions metrics, conversion rate, and other metrics after validating definitions and compatibility.

### D. Date ranges and time series

- [ ] Support predefined date ranges such as the last 7, 30, or 90 days.
- [ ] Add explicit start/end date parameters with format and range validation.
- [ ] Add daily rows using the date segment for trend charts.
- [ ] Add period-over-period comparisons only after consistent date semantics are in place.
- [ ] Distinguish aggregate reports (one row per entity for the period) from segmented daily reports (multiple rows per entity).

### E. Further report types — after the core reports

- [ ] Device breakdown (such as mobile, desktop, and tablet), where supported.
- [ ] Network breakdowns where available for the campaign type.
- [ ] Search-term reports, explaining that reported terms can be limited and not all campaign types share the same search-term reporting resource.
- [ ] Impression-share and search-visibility metrics, when compatible with the selected resource and campaign type.
- [ ] Geographic breakdowns where supported.
- [ ] Conversion-action breakdowns after conversion tracking is covered.
- [ ] Video/engagement metrics only for campaign types that support them.

### F. API and data considerations

- [ ] Use `GoogleAdsService.Search` initially; consider `SearchStream` or pagination handling for larger datasets.
- [ ] Check GAQL field compatibility for each resource, metric, and segment combination.
- [ ] Do not interpret a missing report row as proof that the entity does not exist; a segmented report may omit rows with no reportable activity.
- [ ] Explain that conversion metrics depend on configured conversion actions and attribution/data availability.
- [ ] Handle partial/unavailable reporting data, date boundaries, API errors, and account time-zone semantics.
- [ ] Add sorting and UI filters after the underlying report results and definitions are correct.

### G. Dashboard and export — later

- [ ] KPI cards for spend, clicks, impressions, conversions, CPA, and ROAS-style value/cost.
- [ ] Trend charts by day.
- [ ] Ranked tables for campaigns, ad groups, ads, and keywords.
- [ ] Export results to CSV.
- [ ] Show applied date range, currency, and report level on every view.

### Completion standard

Campaign, ad-group, ad, and keyword report endpoints return valid data with clear metric definitions and date semantics. Only then move on to advanced segmentation and dashboards.

</details>

<details>
<summary><strong>6. Targeting — NOT STARTED</strong></summary>

### Goal

Read and manage the supported targeting settings that control where and to whom ads may be shown.

### A. Locations

- [ ] Read location targeting criteria.
- [ ] Add supported location targets using valid Google Ads geo target constants.
- [ ] Exclude supported locations where needed.
- [ ] Validate location IDs and distinguish target locations from excluded locations.

### B. Languages

- [ ] Read language targeting criteria.
- [ ] Add or update supported language targets.
- [ ] Validate IDs and avoid confusing language targeting with the user's browser/app language setting.

### C. Audiences

- [ ] Read supported audience criteria and targeting mode where exposed.
- [ ] Add supported audience segments at the correct campaign/ad-group level.
- [ ] Distinguish observation from targeting where the campaign type supports that distinction.
- [ ] Respect eligibility, privacy, and policy restrictions for audience data.

### Safety and completion standard

Start read-only; add mutations after resource types and campaign compatibility are understood. Every targeting mutation should validate the parent campaign/ad group, allowed criterion type, and confirmation flags.

</details>

<details>
<summary><strong>7. Conversion Tracking — NOT STARTED</strong></summary>

### Goal

Understand and manage conversion actions so performance reports can measure meaningful business outcomes.

### Scope checklist

- [ ] Read available conversion actions and their main settings.
- [ ] Understand conversion action category, status, counting settings, value configuration, and related attribution settings where exposed.
- [ ] Determine which actions are included in the main `conversions` metric versus broader conversion metrics.
- [ ] Add or update conversion actions only after the read-only implementation is verified.
- [ ] Document the website/app implementation needed to send conversion events; creating an API resource alone does not make the website record conversions.
- [ ] Add checks for recent conversion activity and explain reporting delays or missing data.
- [ ] Keep sensitive customer/event data out of logs and API error responses.

### Completion standard

The SaaS can inspect the account's conversion configuration, explain what its performance metrics count, and verify that the expected data is being recorded without implying that API configuration alone installs site tracking.

</details>

<details>
<summary><strong>8. Production hardening — AFTER CORE FEATURES</strong></summary>

- [ ] Keep OAuth credentials and refresh tokens protected; never send them to the browser or log them.
- [ ] Keep developer tokens and customer configuration on the server.
- [ ] Validate route parameters, request bodies, enums, IDs, dates, amounts, and array sizes.
- [ ] Use a consistent error response shape while retaining useful diagnostics on the server.
- [ ] Respect Google Ads API quotas and rate limits; apply controlled retries only to retryable errors.
- [ ] Add request timeouts, cancellation where appropriate, and safe handling for network failures.
- [ ] Paginate/stream large reads and avoid assuming every account fits in one response.
- [ ] Add tests for validation, validation-only mode, API errors, empty results, and successful mutations.
- [ ] Make customer/account selection explicit before supporting multiple linked accounts.
- [ ] Add audit/change-history features before building high-risk bulk-edit workflows.
- [ ] Ensure live mutations always require a deliberate confirmation path in the server-side implementation.

### Completion standard

The integration remains predictable for multiple users and larger accounts, and mistakes or API failures are easy to understand and recover from.

</details>

---

## Working rules for every feature

1. **Build read-only behavior first**, verify the returned fields, then add mutations.
2. **Default mutations to validation-only.** Only apply real changes when the request explicitly opts in and the server validates confirmation.
3. **Check resource and field compatibility.** Google Ads API resources do not all support the same fields, metrics, or status values.
4. **Keep routes focused.** CRUD endpoints manage resources; Performance Reporting endpoints retrieve and summarize metrics; UI filters refine results but do not change account data.
5. **Test safely.** Use a test account where possible and validate-only requests before any live change.
6. **Keep scope incremental.** Finish Keyword Management before starting Ads & Assets; build Performance Reporting after Ads & Assets, before moving to Targeting and Conversion Tracking.

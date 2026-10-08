# Google Ads API — Node.js Learning Project

A simple **Node.js + TypeScript** project for learning how to integrate the **Google Ads API** from scratch.

The project currently focuses on learning the fundamentals before turning the integration into a multi-tenant SaaS platform:

- Google OAuth 2.0
- Google Ads access tokens and refresh tokens
- Persistent token storage for local development
- Discovering accessible Google Ads customer accounts
- Google Ads REST API calls
- GAQL (Google Ads Query Language)
- Campaign reporting and metrics
- GAQL segments
- Campaign mutations
- `resourceName`
- `updateMask`
- `validateOnly`
- Campaign status updates
- Campaign name updates
- Campaign and budget creation concepts

> **Current learning approach:** REST API + `google-auth-library`.
>
> The `google-ads-api` npm package is installed/considered as a future abstraction, but this project intentionally uses direct REST calls so the underlying Google Ads API can be understood first.

---

## 1. Goal of the project

The long-term goal is to build a SaaS platform where customers can connect their own Google Ads accounts and the SaaS can manage them on the customer's behalf.

The future SaaS flow is:

```text
Customer
   |
   | Connect Google Ads
   v
Google OAuth
   |
   | access token + refresh token
   v
Your Node.js backend
   |
   | customer ID + OAuth access token
   v
Google Ads API
   |
   +--> Reports / GAQL
   +--> Campaigns
   +--> Budgets
   +--> Ad groups
   +--> Ads
   +--> Keywords
   +--> Assets
   +--> Conversions
```

For the learning project, however, we are first using **one Google account and one Google Ads account**.

---

## 2. Important architecture concept

A customer does **not** need to be added as a child account of your MCC for the direct OAuth model.

For direct advertiser access, the customer authorizes your OAuth application and your backend operates on the Google Ads customer account that the authorized Google user can access.

Conceptually:

```text
Your SaaS
   |
   +--> OAuth application
   |
   +--> Customer refresh token
   |
   +--> Google Ads customer ID
   |
   v
Customer's Google Ads account
```

A Manager Account (MCC) is a separate Google Ads account-hierarchy concept. It is not the core requirement for the direct user-authorized integration being learned here.

---

## 3. Tech stack

- Node.js
- TypeScript
- Express
- `google-auth-library`
- Native `fetch`
- Google Ads API REST
- Nodemon for development

Typical packages:

```bash
npm install express google-auth-library dotenv
npm install -D typescript tsx nodemon @types/node @types/express
```

### Why REST in this learning project?

Direct REST calls make the underlying Google Ads API visible:

```text
HTTP method
URL
headers
OAuth bearer token
customer ID
resourceName
operations
updateMask
GAQL
JSON response
```

This makes it easier to understand what a higher-level client library does internally.

Google also has a community-maintained Node.js package named [`google-ads-api`](https://www.npmjs.com/package/google-ads-api). It can reduce boilerplate and provide TypeScript helpers. It is **not an official Google-maintained client library**. We can switch to it after the REST fundamentals are understood.

---

## 4. Project structure

Current simple structure:

```text
google-ads-simple/
│
├── src/
│   └── index.ts
│
├── data/
│   └── google-token.json
│
├── nodemon.json
├── .env
├── .gitignore
├── package.json
└── README.md
```

### Purpose of each file

| File | Purpose |
|---|---|
| `src/index.ts` | Express server, OAuth flow, token handling, Google Ads API calls |
| `data/google-token.json` | Local-development token storage |
| `nodemon.json` | Watches source code while ignoring token-file changes |
| `.env` | Local secrets/configuration |
| `.gitignore` | Prevents secrets and dependencies from being committed |
| `package.json` | Dependencies and scripts |

> In a real SaaS, `google-token.json` must be replaced with encrypted database storage per customer/tenant.

---

## 5. Google Cloud setup

### Create a Google Cloud project

Create a project in:

https://console.cloud.google.com/

Example:

```text
google-ads-learning
```

### Enable Google Ads API

In the Cloud project:

```text
APIs & Services
  -> Library
  -> Google Ads API
  -> Enable
```

### Configure Google Auth Platform / OAuth

Configure the OAuth consent screen and add your own Google account as a **test user** while developing.

Create a **Web application** OAuth client and configure the local callback URL:

```text
http://localhost:5000/auth/google/callback
```

### OAuth scope used by this project

```text
https://www.googleapis.com/auth/adwords
```

This is the Google Ads OAuth scope used for Google Ads API access.

---

## 6. Environment variables

Create a `.env` file:

```env
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
GOOGLE_ADS_DEVELOPER_TOKEN=YOUR_DEVELOPER_TOKEN
GOOGLE_ADS_CUSTOMER_ID=YOUR_CUSTOMER_ID
PORT=5000
```

### Notes

- `GOOGLE_CLIENT_ID`: OAuth client ID from Google Cloud.
- `GOOGLE_CLIENT_SECRET`: OAuth client secret. Keep it server-side.
- `GOOGLE_REDIRECT_URI`: Must exactly match the URI configured in Google Cloud.
- `GOOGLE_ADS_DEVELOPER_TOKEN`: Google Ads API developer token required by the REST API requests in this project.
- `GOOGLE_ADS_CUSTOMER_ID`: Google Ads customer ID used for campaign/report requests.
- `PORT`: Local Express port.

Customer IDs used in Google Ads API URLs should be written without hyphens, for example:

```text
123-456-7890
```

becomes:

```text
1234567890
```

### Never commit secrets

`.gitignore` should include:

```text
node_modules
.env
data/google-token.json
dist
```

Do not put real client secrets, refresh tokens, or developer tokens into README files, GitHub, screenshots, or frontend code.

---

## 7. Start the project

Install dependencies:

```bash
npm install
```

Start development:

```bash
npm run dev
```

Expected output:

```text
Server running at http://localhost:5000
```

Open:

```text
http://localhost:5000
```

---

# 8. OAuth flow

The project uses OAuth 2.0 to let the Google user authorize Google Ads access.

The main route is:

```text
GET /auth/google
```

The flow is:

```text
Browser
  |
  | GET /auth/google
  v
Node.js
  |
  | generate OAuth URL
  v
Google
  |
  | user logs in + grants access
  v
/auth/google/callback
  |
  | authorization code
  v
Node.js
  |
  | exchange code
  v
access_token + refresh_token
```

## Why `state` exists

The OAuth route generates a random state:

```ts
const state = crypto.randomBytes(32).toString("hex");
```

It is stored temporarily and sent to Google.

Google returns the same value to the callback.

The callback verifies that it matches a state generated by our server.

This helps protect the OAuth flow against CSRF/request-forgery attacks.

---

# 9. Understanding `generateAuthUrl()`

The current code is conceptually:

```ts
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: [GOOGLE_ADS_SCOPE],
  include_granted_scopes: true,
  prompt: "consent",
  state,
});
```

### `access_type: "offline"`

The application needs to continue accessing Google Ads when the user is not actively on the website.

This is why we request offline access and retain the refresh token.

### `scope`

```text
https://www.googleapis.com/auth/adwords
```

Requests Google Ads access.

### `include_granted_scopes`

Supports incremental authorization behavior and preservation of previously granted scopes.

### `prompt: "consent"`

Forces the Google consent UI. This is useful while learning/testing OAuth. A production SaaS should avoid unnecessarily forcing consent on every connection attempt.

### `state`

A temporary security value tying the callback to the authorization request we started.

---

# 10. Access token vs refresh token

This distinction is essential.

## Access token

Short-lived credential used on Google Ads API requests.

```text
access_token
   |
   +--> Authorization: Bearer <access_token>
```

It expires and needs to be refreshed.

## Refresh token

Long-lived credential used by the backend to obtain new access tokens.

```text
refresh_token
      |
      v
Google OAuth
      |
      v
new access_token
```

### Correct SaaS model

```text
Store securely:
  refresh token
  customer ID

Use temporarily:
  access token
```

Do not require the customer to log into Google every time they open your SaaS.

---

# 11. Why the server used to restart

During early development, the token was being written to:

```text
data/google-token.json
```

Nodemon was watching that file, so saving a token triggered a restart.

The solution was `nodemon.json`:

```json
{
  "watch": ["src"],
  "ext": "ts",
  "ignore": [
    "data/**",
    "node_modules/**"
  ]
}
```

This tells Nodemon to watch source code, not the token file.

---

# 12. Discover accessible Google Ads accounts

Endpoint:

```text
GET /google-ads/accounts
```

The backend obtains a fresh access token and calls:

```text
GET https://googleads.googleapis.com/v25/customers:listAccessibleCustomers
```

The response can contain:

```json
{
  "resourceNames": [
    "customers/1234567890"
  ]
}
```

The numeric ID is the Google Ads **customer ID**.

For the current learning project, we put it in `.env`:

```env
GOOGLE_ADS_CUSTOMER_ID=1234567890
```

Later, the SaaS will store the selected customer ID per connected tenant/user.

---

# 13. What is GAQL?

**GAQL = Google Ads Query Language.**

GAQL is used mainly for reading/querying Google Ads data and reporting.

It looks similar to SQL, but it is Google Ads-specific.

Example:

```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status
FROM campaign
```

Meaning:

> Return campaign ID, campaign name, and campaign status.

---

# 14. GAQL mental model

A useful formula is:

```text
GAQL report
  = resource fields
  + metrics
  + segments
  + filters
  + optional ordering
```

### Resource fields

Examples:

```text
campaign.id
campaign.name
campaign.status
```

### Metrics

Examples:

```text
metrics.clicks
metrics.impressions
metrics.cost_micros
metrics.conversions
metrics.ctr
metrics.average_cpc
```

Metrics answer:

> How much? How many?

### Segments

Examples:

```text
segments.date
segments.device
segments.ad_network_type
```

Segments answer:

> How should the data be broken down?

Example:

```sql
SELECT
  campaign.name,
  segments.date,
  metrics.clicks
FROM campaign
```

This can produce results like:

```text
Summer Sale | 2026-10-01 | 100
Summer Sale | 2026-10-02 | 150
Summer Sale | 2026-10-03 | 200
```

The segment creates additional rows because the metrics are now grouped by that dimension.

### Filters

Example:

```sql
WHERE segments.date DURING LAST_30_DAYS
```

Filters restrict the rows included in the result.

---

# 15. First campaign report

A useful campaign report is:

```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  metrics.conversions
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
```

The backend sends the query to:

```text
POST https://googleads.googleapis.com/v25/customers/{customerId}/googleAds:search
```

The Google Ads REST request contains the OAuth bearer token and developer token.

---

# 16. Understanding micros

Google Ads monetary fields use **micros**.

```text
1 currency unit = 1,000,000 micros
```

Example:

```text
500,000,000 micros
÷ 1,000,000
= 500
```

So:

```ts
const amount = Number(costMicros) / 1_000_000;
```

For INR, for example:

```text
500,000,000 micros -> ₹500
```

The account currency determines how the final amount is displayed.

---

# 17. GAQL vs Mutation

This is one of the most important concepts in the project.

```text
READ
  |
  v
GoogleAdsService
  |
  v
GAQL
```

GAQL is primarily for retrieving data and performance.

For writes:

```text
WRITE
  |
  v
Resource-specific Mutate service
  |
  +--> CampaignService
  +--> CampaignBudgetService
  +--> AdGroupService
  +--> AdGroupAdService
  +--> AdGroupCriterionService
  +--> etc.
```

Think:

```text
GAQL       = ask Google Ads for information
Mutations  = change Google Ads
```

---

# 18. What is `resourceName`?

A Google Ads `resourceName` is the full unique path of a resource.

Campaign example:

```text
customers/1234567890/campaigns/456789
```

Breakdown:

```text
customers/
1234567890/
    -> Google Ads customer/account ID

campaigns/
456789
    -> specific campaign ID
```

Think of it as the object's full address inside Google Ads.

### Why not only use `campaignId`?

Because the full path makes the object unambiguous:

```text
customers/1111111111/campaigns/123
customers/2222222222/campaigns/123
```

The campaign ID could be the same in different customer accounts, but the full resource name identifies the exact object.

The same idea appears for other resources:

```text
customers/1234567890/campaignBudgets/888888
customers/1234567890/adGroups/555555
```

---

# 19. Mutation structure

The basic update pattern is:

```json
{
  "operations": [
    {
      "updateMask": "status",
      "update": {
        "resourceName": "customers/1234567890/campaigns/456789",
        "status": "PAUSED"
      }
    }
  ]
}
```

Read it as:

```text
resourceName
  -> Which exact object?

update
  -> What values should it have?

updateMask
  -> Which fields should change?

operations
  -> One or more requested operations
```

---

# 20. What is `updateMask`?

`updateMask` tells Google exactly which fields you want to modify.

Example:

```json
"updateMask": "status"
```

means:

> Change only `status`.

Example:

```json
"updateMask": "name,status"
```

means:

> Change both `name` and `status`.

This is called a sparse/partial update rather than replacing the entire resource.

---

# 21. Pausing or enabling a campaign

Campaign status can be changed through `CampaignService.MutateCampaigns`.

Pause:

```json
{
  "updateMask": "status",
  "update": {
    "resourceName": "customers/1234567890/campaigns/456789",
    "status": "PAUSED"
  }
}
```

Enable:

```json
{
  "updateMask": "status",
  "update": {
    "resourceName": "customers/1234567890/campaigns/456789",
    "status": "ENABLED"
  }
}
```

The same mutation mechanism is used; only the new value changes.

---

# 22. `validateOnly`

`validateOnly` is a top-level mutation-request option.

```json
{
  "operations": [
    {
      "updateMask": "status",
      "update": {
        "resourceName": "customers/1234567890/campaigns/456789",
        "status": "PAUSED"
      }
    }
  ],
  "validateOnly": true
}
```

When `validateOnly` is true, Google validates the request without applying the final mutation.

Think:

```text
validateOnly = true
   -> check request
   -> do not change Ads account

validateOnly = false
   -> execute mutation
   -> change Ads account
```

This is very useful while developing a SaaS because accidental mutations can affect a real customer's advertising account.

---

# 23. Campaign update vs campaign create

`CampaignService` supports the campaign mutation lifecycle.

Conceptually:

```text
CampaignService
   |
   +--> create
   +--> update
   +--> remove
```

### Update

An existing campaign is identified by its `resourceName`.

```json
{
  "update": {
    "resourceName": "customers/123/campaigns/456",
    "status": "PAUSED"
  },
  "updateMask": "status"
}
```

### Create

There is no existing campaign ID yet, so you send a `create` object:

```json
{
  "operations": [
    {
      "create": {
        "name": "My New Campaign",
        "status": "PAUSED"
      }
    }
  ]
}
```

Google creates the resource and returns a new resource name/ID.

---

# 24. Campaign creation and budgets

For a normal Search campaign, campaign creation is tied to a campaign budget resource.

The conceptual flow is:

```text
Create CampaignBudget
      |
      v
Receive budget resourceName
      |
      v
Create Campaign
      |
      +--> campaignBudget = budget resourceName
```

Example budget resource:

```text
customers/1234567890/campaignBudgets/987654321
```

Then the campaign uses that resource.

For development, create the campaign as:

```text
status = PAUSED
```

This is safer because the rest of the campaign setup (targeting, ad groups, ads, keywords, etc.) may not be finished yet.

---

# 25. Main Google Ads services useful for this SaaS

## Core

| Service | Main purpose |
|---|---|
| `CustomerService` | Customer/account access and account-level operations |
| `GoogleAdsService` | GAQL queries, reporting, search/search stream |
| `CampaignService` | Create/update/remove campaigns |
| `CampaignBudgetService` | Manage campaign budgets |
| `AdGroupService` | Create/update/remove ad groups |
| `AdGroupAdService` | Create/update/remove ads |
| `AdGroupCriterionService` | Keywords and ad-group criteria |
| `GoogleAdsFieldService` | Inspect fields and metadata for GAQL |

## Important later

| Service | Main purpose |
|---|---|
| `AssetService` | Manage creative assets |
| `CampaignAssetService` | Associate assets with campaigns |
| `CampaignCriterionService` | Campaign-level criteria/targeting |
| `ConversionActionService` | Manage conversion actions |
| `ConversionUploadService` | Upload offline conversions |
| `GeoTargetConstantService` | Geo targeting constants |
| `RecommendationService` | Google recommendations |

## Advanced / specialized

| Area | Examples |
|---|---|
| Performance Max | `AssetGroupService`, related asset-group services |
| Experiments | `ExperimentService`, `ExperimentArmService` |
| User access | `CustomerUserAccessService`, invitation service |
| Billing | `BillingSetupService`, account-budget services |

Do not try to learn all of these at once. The core learning path is much smaller.

---

# 26. Current learning path

We have completed:

```text
✅ Google OAuth
✅ Access token
✅ Refresh token
✅ Local persistent token storage
✅ Account discovery
✅ Customer ID
✅ GAQL basics
✅ Metrics
✅ Segments
✅ Resource names
✅ Mutations
✅ updateMask
✅ validateOnly
✅ Campaign status update
✅ Campaign name update
✅ Campaign create concept
✅ Campaign budget dependency concept
```

Recommended next topics:

```text
1. Campaign budget
2. Ad group creation
3. Ad creation
4. Keyword creation
5. Campaign/ad-group/keyword hierarchy
6. More useful GAQL reports
7. Budget updates
8. Safer production mutation patterns
9. Multi-tenant SaaS architecture
10. Database token storage
11. Switch REST implementation to google-ads-api if desired
```

---

# 27. Future SaaS architecture

Once the single-user learning project is understood, move to:

```text
                          YOUR SAAS
                              |
                    +---------+---------+
                    |                   |
                  Frontend            Backend
                    |                   |
                    |             OAuth service
                    |                   |
                    |             Token service
                    |                   |
                    |          Google Ads service
                    |                   |
                    +---------+---------+
                              |
                         PostgreSQL
                              |
                 +------------+-------------+
                 |                          |
              Tenant A                   Tenant B
                 |                          |
          refresh token A            refresh token B
          customer ID A              customer ID B
```

Each connected customer should have their own stored Google Ads connection.

A conceptual database record is:

```text
GoogleAdsConnection
--------------------
id
tenantId
googleUserId
customerId
refreshTokenEncrypted
status
createdAt
updatedAt
```

The browser should **not** store the refresh token or OAuth client secret.

---

# 28. Production token strategy

Local learning:

```text
data/google-token.json
```

Production SaaS:

```text
Database
   |
   +--> tenantId
   +--> customerId
   +--> encrypted refresh token
```

At request time:

```text
Tenant
  |
  v
Load connection from DB
  |
  v
Decrypt refresh token
  |
  v
Get current access token
  |
  v
Call Google Ads API
```

If the refresh token is revoked/invalid, mark the connection as disconnected and require reauthorization.

---

# 29. Security checklist

- Never commit `.env`.
- Never commit `data/google-token.json`.
- Never put the Google OAuth client secret in frontend code.
- Never put refresh tokens in frontend/local browser storage.
- Encrypt refresh tokens at rest in production.
- Use a real session/Redis/database-backed OAuth `state` mechanism in production.
- Expire/clean up old OAuth states.
- Do not log access tokens or refresh tokens.
- Use HTTPS in production.
- Validate campaign IDs and request values on the backend.
- Use safe defaults during development, especially `validateOnly = true`.
- Keep mutation permissions behind authenticated application users/tenants.

---

# 30. API endpoint map for this project

Current learning endpoints:

```text
GET /
    Simple status/home page.

GET /auth/google
    Starts Google OAuth.

GET /auth/google/callback
    Handles the OAuth authorization code.

GET /google-ads/accounts
    Lists Google Ads customers accessible to the authorized user.

GET /google-ads/campaigns
    Reads campaigns using GAQL.

POST /google-ads/campaigns/campaign
    Updates campaign status.

POST /google-ads/campaigns/rename
    Updates campaign name.

POST /google-ads/budgets/create
    Creates a campaign budget.

POST /google-ads/campaigns/create
    Creates a campaign using an existing campaign budget resource.
```

These endpoints are intentionally simple learning endpoints, not production API contracts.

---

# 31. Example request patterns

## Read campaigns

```bash
curl http://localhost:5000/google-ads/campaigns
```

## Validate campaign pause

```bash
curl -X POST \
  http://localhost:5000/google-ads/campaigns/campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "123456789",
    "status": "PAUSED",
    "validateOnly": true
  }'
```

## Actually pause campaign

```bash
curl -X POST \
  http://localhost:5000/google-ads/campaigns/campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "123456789",
    "status": "PAUSED",
    "validateOnly": false
  }'
```

## Validate campaign rename

```bash
curl -X POST \
  http://localhost:5000/google-ads/campaigns/rename \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "123456789",
    "name": "Summer Sale 2026",
    "validateOnly": true
  }'
```

---

# 32. REST request anatomy

A Google Ads request typically contains:

```text
HTTP method
      |
      v
Google Ads REST URL
      |
      +--> API version
      +--> customer ID
      +--> resource/service
      |
      v
Headers
      |
      +--> Authorization: Bearer <access_token>
      +--> developer-token: <developer_token>
      |
      v
JSON body
      |
      +--> GAQL query
      or
      +--> mutation operations
```

This mental model makes the client-library abstraction much easier to understand later.

---

# 33. REST vs `google-ads-api`

## Direct REST

```text
Your code
   |
   v
fetch()
   |
   v
Google Ads REST API
```

Pros:

- Full control over HTTP requests
- Closely matches Google documentation
- No third-party Ads abstraction
- Excellent for learning how the API actually works

Cons:

- More boilerplate
- Manual request/response handling
- More work around helpers, pagination, types, and enums

## `google-ads-api`

```text
Your code
   |
   v
google-ads-api
   |
   v
Google Ads API
```

Pros:

- Less boilerplate
- TypeScript support
- Higher-level reporting/mutation helpers
- Easier resource handling

Cons:

- Community maintained rather than Google maintained
- Adds an abstraction you need to understand/debug
- Package version needs to track Google Ads API versions

Recommended approach for this learning project:

```text
Learn REST first
      |
      v
Understand Google Ads concepts
      |
      v
Optionally rewrite using google-ads-api
      |
      v
Choose the abstraction for the production SaaS
```

---

# 34. Official documentation

Use the official Google documentation as the final source of truth because API versions and requirements change.

- Google Ads API overview: https://developers.google.com/google-ads/api/docs/start
- Authentication / OAuth: https://developers.google.com/google-ads/api/docs/oauth/overview
- REST overview: https://developers.google.com/google-ads/api/rest/overview
- Reporting and GAQL: https://developers.google.com/google-ads/api/docs/reporting/overview
- GAQL query structure: https://developers.google.com/google-ads/api/docs/query/structure
- Google Ads API query cookbook: https://developers.google.com/google-ads/api/docs/query/cookbook
- Mutations: https://developers.google.com/google-ads/api/docs/concepts/changing-objects
- Campaigns: https://developers.google.com/google-ads/api/docs/campaigns/overview
- Campaign creation: https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns
- Campaign budgets: https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview
- v25 reference: https://developers.google.com/google-ads/api/reference/rpc/v25/overview

---

# 35. Troubleshooting

## `ERR_CONNECTION_REFUSED`

Usually the Node.js server is not running.

Run:

```bash
npm run dev
```

and confirm:

```text
Server running at http://localhost:5000
```

## Nodemon keeps restarting

Make sure `nodemon.json` ignores:

```text
data/**
```

because `google-token.json` changes during OAuth/token refresh.

## OAuth warning: "Google hasn't verified this app"

During development, make sure your Google account is configured as a test user in the Google Auth Platform project.

Do not treat the development/testing warning as a production-ready OAuth setup.

## `No refresh token found`

The local token file is missing or has no `refresh_token`.

Reconnect through:

```text
http://localhost:5000/auth/google
```

## Google Ads API `401` / `403`

Check:

- access token
- refresh token
- OAuth client configuration
- developer token
- Google Ads API access/project configuration
- customer ID
- user permission on the Ads account

## GAQL query errors

Check:

- field names
- resource name in `FROM`
- field compatibility
- date/segment usage
- metric availability

Google's field/reference documentation should be used when a field combination fails.

---

# 36. Important production warning

This repository is a **learning project**, not production SaaS code.

Before allowing external customers to connect accounts, add:

```text
Authentication / sessions
Multi-tenancy
Database-backed OAuth state
Encrypted token storage
Token rotation/revocation handling
Rate limiting
Request validation
Audit logs
Permission checks
Error normalization
Retry/backoff strategy
Background jobs
Monitoring
Secrets management
HTTPS
OAuth app configuration/verification as required
```

Do not expose raw Google API errors or credentials to users.

---

# 37. Core concepts to remember

```text
OAuth
  = lets a Google user authorize your application

Access token
  = short-lived credential used in API requests

Refresh token
  = backend credential used to obtain new access tokens

Customer ID
  = Google Ads account ID

resourceName
  = full unique path of a Google Ads resource

GAQL
  = query language for reading/reporting Ads data

Metrics
  = performance numbers such as clicks/impressions/cost

Segments
  = dimensions that break metrics into groups, such as date/device

Mutation
  = a write/change operation

updateMask
  = fields that should be changed during an update

validateOnly
  = validate a mutation without executing it

CampaignService
  = campaign create/update/remove

CampaignBudgetService
  = campaign budget management

GoogleAdsService
  = reporting/search using GAQL
```

---

# 38. The big picture

The complete learning architecture is:

```text
                    GOOGLE ACCOUNT
                           |
                           | OAuth
                           v
                  +----------------+
                  | Your Node.js   |
                  | application    |
                  +----------------+
                           |
                access/refresh token
                           |
                           v
                 Google Ads API v25
                           |
            +--------------+--------------+
            |                             |
          READ                          WRITE
            |                             |
      GoogleAdsService              Mutate services
            |                             |
          GAQL              +-------------+-------------+
            |               |             |             |
      +-----+-----+      Campaign      Budget        AdGroup
      |     |     |      Service       Service       Service
    Metrics Segments ...
```

This is the foundation for the future SaaS platform.

---

## License

This is a personal learning project. Add your preferred license here before publishing the repository.

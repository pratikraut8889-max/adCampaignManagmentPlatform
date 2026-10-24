# Code improvements patch (against the 19 Oct upload)

Copy the files in this folder over your project (same paths), then run:

    npm run typecheck
    npm run dev

`changes.patch` is the same change as a unified diff, for review.

IMPORTANT: these changes were type-checked with stubbed third-party types and were
NOT run against the Google Ads API. Test every route on a test account with
`"validateOnly": true` first.

## Security
| File | Change |
| --- | --- |
| `src/routes/account.routes.ts` | The YouTube refresh token is printed only when `NODE_ENV` is not `production`. |
| `src/routes/budget.routes.ts` | `developer-token` header added to the 6 Google calls that were missing it (list, update, assignments, assign-budget validation, remove read, remove). |
| `src/routes/assets.routes.ts` | YouTube upload needs `confirm=true`, and privacy now defaults to `private` (`privacyStatus` may be `private`, `unlisted` or `public`). A rejected upload deletes the temporary file. |
| `.gitignore`, `.env.example` | `data/`, `.env.*`, `*.zip`, `*.docx`, `code.txt` ignored. `.env.example` replaces the misspelt `.env.exapmle` and holds names only. |
| `package.json` | `npm run pack:source` builds `source-only.zip` from Git (tracked files only), so `.env`, `data/`, `.git/` and `node_modules/` can never be shared by accident. Commit first. |

## Safety (breaking: live writes now need `confirm: true`)
New helper `src/helper/safety.ts` -> `parseMutationMode(body)`.
A live change needs BOTH `"validateOnly": false` AND `"confirm": true`.
`validateOnly: false` without `confirm: true` returns 400 and nothing is sent live.

Applied to: campaign create, campaign status, campaign rename, campaign target CPA,
budget create, budget update, keyword create, keyword status update.
(Bidding, ad group, ad, asset and association routes already followed this rule.)

## Bugs fixed
| Where | Bug |
| --- | --- |
| `conversionReport.routes.ts` | A stray `con` in a catch block threw a ReferenceError and broke `tsc`. Replaced with a `console.error`. |
| `adsGroup.routes.ts` | RSA description check was inverted and limited to 50. It now rejects anything that is not 1 to 90 characters. |
| `adsGroup.routes.ts` | Keyword status PATCH sent `operations` as an object. It is now an array; ids and status (`ENABLED` or `PAUSED`) are validated. Keyword create validates `adGroupId`. |
| `campaign.routes.ts` | Target CPA always said "No changes were applied". The message now follows `validateOnly`. |
| `campaign.routes.ts` | Duplicate `GET /google-ads/campaigns/setup-options` removed (the two copies were identical). |
| `campaign.routes.ts` | List response now has `campaigns`; the misspelt `capaigns` is kept for now so clients do not break. Remove it after the frontend moves. |
| `index.ts` | Home page link pointed to `/google-ads/accounts`; the route is `/accounts`. |

## Reliability
| File | Change |
| --- | --- |
| `src/google_config.ts` | The access token is cached until about a minute before it expires. Before, every API call asked Google for a new token and rewrote the token file. |
| `src/google_config.ts` | Missing YouTube settings now log a warning instead of stopping the whole server at startup. |
| `src/index.ts` | Added `GET /health`, a JSON 404, a last-resort error handler, and `x-powered-by` is off. |

## New: ad retrieval (`src/routes/adRetrieval.routes.ts`, mounted under `/google-ads`)
| Route | Purpose |
| --- | --- |
| `GET /google-ads/ads` | Account-wide list. Filters: `campaignId`, `adGroupId`, `status`, `types` (comma list), `adStrength`, `approvalStatus`, `includeRemoved=true`. Follows `nextPageToken` (up to 20 pages, `truncated` tells you if more exist). |
| `GET /google-ads/ads/:adId` | One ad, flattened. |
| `GET /google-ads/ads/:adId/assets` | Asset-level performance (`performanceLabel`, `pinnedField`, `enabled`, policy status). |

Every item includes: resource names, status, `primaryStatus` and reasons, ad strength
and action items, approval and review status, policy topics, final URLs, tracking
template, and headlines/descriptions/paths for responsive search ads.
All filters are allow-listed or digits only.

## Test checklist (use the test account)
1. `GET /health` returns `{"status":"ok"}`.
2. `GET /google-ads/ads?status=ENABLED` returns ads.  Try `?types=BAD` -> 400.
3. `GET /google-ads/ads/{adId}/assets` on a responsive search ad.
4. `PATCH` a keyword with `{"status":"PAUSED"}` -> validate-only.
   With `{"validateOnly":false}` -> 400.  With `{"validateOnly":false,"confirm":true}` -> live.
5. Budget list/update/remove now succeed with the developer token header.
6. `POST /google-ads/ad-groups/{id}/ads` with a 60-character description is accepted; 91 is rejected.
7. YouTube upload without `confirm=true` -> 400, with it -> private video.

## Not done yet (see the master doc, "Code structure review")
Splitting the 2,000-line route files, a shared Google client for every route, schema
validation, automated tests, token store in a database, app login.

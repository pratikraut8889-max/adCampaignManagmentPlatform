/**
 * META MARKETING API — PHASE 6, AUDIENCES (Lessons 6.1–6.9)
 * =========================================================
 * One-file reference implementation for Express + TypeScript (Node 18+).
 * Saved for FUTURE use, NOT yet tested against your account.
 *
 * HOW TO ACTIVATE LATER
 * ---------------------
 * 1) Copy this file into src/routes/audience-module.routes.ts
 * 2) Import: import { createAudienceModuleRouter } from './routes/audience-module.routes';
 * 3) Mount:  app.use(createAudienceModuleRouter(readAccessToken));
 *    readAccessToken must return Promise<string | null | undefined> (or a string).
 * 4) Ensure app.use(express.json({ limit: '1mb' })) is registered first.
 * 5) Avoid registering the older routes with identical URLs simultaneously.
 * 6) Set META_GRAPH_API_VERSION=v25.0 (or your verified supported version).
 * 7) Protect all routes with your application's authentication/authorization
 *    before exposing them to other users. These are educational admin routes.
 *
 * Examples use act_1820194389321017; replace IDs with YOUR real IDs.
 * All operations here manage audiences only; NONE activates campaigns or ads.
 *
 * LESSON INDEX
 * 6.1 GET    /meta/ad-accounts/:accountId/audience-overview
 * 6.2 GET    /meta/ad-accounts/:accountId/saved-audiences
 *     POST   /meta/ad-accounts/:accountId/saved-audiences
 *     GET    /meta/ad-accounts/:accountId/saved-audiences/:audienceId
 * 6.3 GET    /meta/ad-accounts/:accountId/custom-audiences
 *     POST   /meta/ad-accounts/:accountId/custom-audiences
 * 6.4 POST   /meta/ad-accounts/:accountId/lookalike-audiences
 *     GET    /meta/ad-accounts/:accountId/lookalike-audiences
 * 6.5 GET    /meta/ad-accounts/:accountId/custom-audiences/:audienceId
 *     PATCH  /meta/ad-accounts/:accountId/custom-audiences/:audienceId
 *     DELETE /meta/ad-accounts/:accountId/custom-audiences/:audienceId
 * 6.6 GET    /meta/targeting/search?type=adinterest&q=fitness
 *     GET    /meta/targeting/suggestions?interestIds=6003139266461
 *     GET    /meta/targeting/locations?q=India&locationTypes=country
 * 6.7 POST   /meta/ad-accounts/:accountId/custom-audiences/:audienceId/users
 *     DELETE /meta/ad-accounts/:accountId/custom-audiences/:audienceId/users
 * 6.8 POST   /meta/ad-accounts/:accountId/website-audiences
 *     POST   /meta/ad-accounts/:accountId/engagement-audiences
 * 6.9 GET    /meta/audience-guidance
 *
 * POSTMAN SAMPLE BODIES
 * ---------------------
 * Create saved audience:
 * {"name":"Learning - Saved Audience","targeting":{"geo_locations":{"countries":["IN"]},"age_min":21,"age_max":55}}
 *
 * Create empty customer-list custom audience:
 * {"name":"Learning - Customer List","description":"Empty test","subtype":"CUSTOM","customer_file_source":"USER_PROVIDED_ONLY"}
 *
 * Create lookalike (requires eligible, populated seed + supported location):
 * {"name":"Learning - Lookalike","origin_audience_id":"SEED_AUDIENCE_ID","country":"IN","ratio":0.01}
 *
 * Rename custom audience:
 * {"name":"Renamed Audience","description":"Updated description"}
 *
 * Delete custom audience (irreversible; test audiences only):
 * {"confirmAudienceId":"AUDIENCE_ID"}
 *
 * Add consenting customer identifiers (the server hashes them):
 * {"confirmedPermission":true,"schema":["EMAIL","PHONE"],"data":[["buyer@example.com","+919876543210"]]}
 *
 * Remove customer identifiers (server hashes the same way):
 * {"confirmedPermission":true,"schema":["EMAIL"],"data":[["buyer@example.com"]]}
 *
 * Website audience: Rule shapes are version / event-source dependent.
 * Pass a VERIFIED Meta rule object rather than inventing one:
 * {"name":"Learning Website Audience","pixel_id":"PIXEL_ID","rule":{"inclusions":{"operator":"or","rules":[...]}}}
 *
 * Engagement audience: exact rule structure depends on chosen engagement source.
 * {"name":"Learning Engagement Audience","rule":{"inclusions":{"operator":"or","rules":[...]}}}
 *
 * REFERENCES (review before activating a later Graph API version)
 * https://developers.facebook.com/docs/marketing-api/audiences/
 * https://developers.facebook.com/docs/marketing-api/reference/custom-audience/
 * https://developers.facebook.com/docs/marketing-api/reference/ad-account/customaudiences/
 * https://developers.facebook.com/docs/marketing-api/targeting-search/
 * https://www.postman.com/meta/facebook-marketing-api/overview
 */

import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';

type TokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
type Verb = 'GET' | 'POST' | 'DELETE';
type MetaResult = { ok: boolean; status: number; body: any };

const GRAPH_VERSION = () => process.env.META_GRAPH_API_VERSION || 'v25.0';
const ACCOUNT_ID = (v: unknown) => String(v ?? '').replace(/^act_/, '');
const IS_ID = (v: unknown) => /^\d+$/.test(String(v ?? ''));
const CUSTOMER_FIELDS = 'id,account_id,name,description,subtype,customer_file_source';
const SAVED_FIELDS = 'id,name,description,targeting';
const LOOKALIKE_FIELDS = 'id,account_id,name,description,subtype,lookalike_spec';
const MAX_PAGE = 100;

function bad(res: Response, message: string, code = 400) {
    return res.status(code).json({ success: false, message });
}

function accountFrom(req: Request, res: Response): string | null {
    const id = ACCOUNT_ID(req.params.accountId);
    if (!IS_ID(id)) { bad(res, 'Invalid Ad Account ID'); return null; }
    return id;
}

function audienceFrom(req: Request, res: Response): string | null {
    const id = String(req.params.audienceId ?? '');
    if (!IS_ID(id)) { bad(res, 'Invalid Audience ID'); return null; }
    return id;
}

function pageParams(req: Request, res: Response): URLSearchParams | null {
    const n = Number(req.query.limit ?? 25);
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PAGE) {
        bad(res, `limit must be an integer from 1 to ${MAX_PAGE}`);
        return null;
    }
    const p = new URLSearchParams({ limit: String(n) });
    if (req.query.after !== undefined) {
        if (typeof req.query.after !== 'string' || !req.query.after || req.query.after.length > 2048) {
            bad(res, 'Invalid after cursor'); return null;
        }
        p.set('after', req.query.after);
    }
    return p;
}

function pageOutput(body: any, limit: number) {
    const next = Boolean(body?.paging?.next);
    return {
        count: Array.isArray(body?.data) ? body.data.length : 0,
        audiences: Array.isArray(body?.data) ? body.data : [],
        pagination: {
            limit,
            hasNextPage: next,
            nextCursor: next ? body?.paging?.cursors?.after ?? null : null,
        },
    };
}

function metaError(res: Response, result: MetaResult) {
    const e = result.body?.error ?? {};
    const status = result.status === 401 || result.status === 403 ? result.status : 502;
    return res.status(status).json({
        success: false,
        message: e.message ?? 'Meta request failed',
        metaError: {
            type: e.type ?? null,
            code: e.code ?? null,
            subcode: e.error_subcode ?? null,
            fbtraceId: e.fbtrace_id ?? null,
        },
    });
}

async function graph(
    token: string,
    path: string,
    method: Verb = 'GET',
    params = new URLSearchParams(),
): Promise<MetaResult> {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION()}/${path.replace(/^\/+/, '')}`);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30000) };
    if (method === 'POST' || (method === 'DELETE' && params.has('payload'))) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = params.toString();
    } else {
        url.search = params.toString();
    }
    const response = await fetch(url.toString(), init);
    const raw = await response.text();
    let body: any;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { body = { error: { message: 'Meta returned non-JSON data' } }; }
    return { ok: response.ok, status: response.status, body };
}

async function requireToken(getToken: TokenProvider, res: Response): Promise<string | null> {
    const token = await getToken();
    if (!token) { bad(res, 'Meta access token not found', 401); return null; }
    return token;
}

async function verifyOwner(token: string, id: string, accountId: string, res: Response) {
    const lookup = await graph(token, id, 'GET', new URLSearchParams({ fields: 'id,account_id,subtype' }));
    if (!lookup.ok) { metaError(res, lookup); return null; }
    if (ACCOUNT_ID(lookup.body.account_id) !== accountId) {
        bad(res, 'Audience does not belong to this Ad Account', 403); return null;
    }
    return lookup.body as { id: string; account_id: string; subtype?: string };
}

// IMPORTANT: For actual multi-user production systems, add app authorization,
// rate limiting, consent audit logging, and enforce account-level access.
// Do not log tokens, raw customer identifiers, hashed identifiers or Meta URLs.
export function createAudienceModuleRouter(readAccessToken: TokenProvider): Router {
    const router = Router();

    const safe = (handler: (req: Request, res: Response) => Promise<unknown>) =>
        async (req: Request, res: Response) => {
            try { await handler(req, res); }
            catch (error) {
                console.error('Audience module request failed:', error instanceof Error ? error.name : 'Unknown error');
                if (!res.headersSent) bad(res, 'Internal server error', 500);
            }
        };

    // LESSON 6.1: Audience types and fundamentals (informational route).
    router.get('/meta/ad-accounts/:accountId/audience-overview', safe(async (req, res) => {
        const accountId = accountFrom(req, res);
        if (!accountId) return;
        return res.json({
            success: true, adAccountId: `act_${accountId}`,
            types: [
                { type: 'SAVED', description: 'Reusable ad set targeting configuration', lesson: '6.2' },
                { type: 'CUSTOM', description: 'Existing customers or event-based engagement', lesson: '6.3/6.7/6.8' },
                { type: 'LOOKALIKE', description: 'Find people similar to an eligible source', lesson: '6.4' },
            ],
            note: 'This route is local guidance, not a Meta Graph API endpoint.',
        });
    }));

    // LESSON 6.2: Saved audience: list / create / details.
    router.get('/meta/ad-accounts/:accountId/saved-audiences', safe(async (req, res) => {
        const id = accountFrom(req, res); const p = pageParams(req, res);
        if (!id || !p) return;
        const token = await requireToken(readAccessToken, res); if (!token) return;
        p.set('fields', SAVED_FIELDS);
        const result = await graph(token, `act_${id}/saved_audiences`, 'GET', p);
        if (!result.ok) return metaError(res, result);
        return res.json({ success: true, adAccountId: `act_${id}`, ...pageOutput(result.body, Number(p.get('limit'))) });
    }));

    router.post('/meta/ad-accounts/:accountId/saved-audiences', safe(async (req, res) => {
        const id = accountFrom(req, res); if (!id) return;
        const { name, description = '', targeting } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim() || name.length > 255) return bad(res, 'Valid name required');
        if (typeof description !== 'string') return bad(res, 'description must be a string');
        if (!targeting || typeof targeting !== 'object' || Array.isArray(targeting)) return bad(res, 'A valid targeting object is required');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, `act_${id}/saved_audiences`, 'POST',
            new URLSearchParams({ name: name.trim(), description, targeting: JSON.stringify(targeting) }));
        if (!result.ok) return metaError(res, result);
        return res.status(201).json({ success: true, id: result.body?.id ?? null, message: 'Saved Audience created (if supported by account)' });
    }));

    router.get('/meta/ad-accounts/:accountId/saved-audiences/:audienceId', safe(async (req, res) => {
        const accountId = accountFrom(req, res); const id = audienceFrom(req, res);
        if (!accountId || !id) return;
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, id, 'GET', new URLSearchParams({ fields: `${SAVED_FIELDS},account_id` }));
        if (!result.ok) return metaError(res, result);
        if (result.body?.account_id && ACCOUNT_ID(result.body.account_id) !== accountId) return bad(res, 'Wrong Ad Account', 403);
        return res.json({ success: true, audience: result.body });
    }));

    // LESSON 6.3: Custom Audience list / create. Creation is an EMPTY list container.
    router.get('/meta/ad-accounts/:accountId/custom-audiences', safe(async (req, res) => {
        const id = accountFrom(req, res); const p = pageParams(req, res);
        if (!id || !p) return;
        const token = await requireToken(readAccessToken, res); if (!token) return;
        p.set('fields', CUSTOMER_FIELDS);
        const result = await graph(token, `act_${id}/customaudiences`, 'GET', p);
        if (!result.ok) return metaError(res, result);
        return res.json({ success: true, adAccountId: `act_${id}`, ...pageOutput(result.body, Number(p.get('limit'))) });
    }));

    router.post('/meta/ad-accounts/:accountId/custom-audiences', safe(async (req, res) => {
        const id = accountFrom(req, res); if (!id) return;
        const { name, description = '', subtype, customer_file_source } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim() || name.length > 255) return bad(res, 'Valid name required');
        if (typeof description !== 'string' || description.length > 1000) return bad(res, 'Invalid description');
        if (subtype !== 'CUSTOM') return bad(res, 'This endpoint supports subtype CUSTOM only');
        const sources = ['USER_PROVIDED_ONLY', 'PARTNER_PROVIDED_ONLY', 'BOTH_USER_AND_PARTNER_PROVIDED'];
        if (!sources.includes(customer_file_source)) return bad(res, 'Invalid customer_file_source');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, `act_${id}/customaudiences`, 'POST',
            new URLSearchParams({ name: name.trim(), description, subtype, customer_file_source }));
        if (!result.ok) return metaError(res, result);
        return res.status(201).json({ success: true, audience: { id: result.body?.id ?? null, name: name.trim(), subtype } });
    }));

    // LESSON 6.4: Lookalike audience list and create.
    // Actual eligibility depends on populated seed, country support, account and privacy policies.
    router.get('/meta/ad-accounts/:accountId/lookalike-audiences', safe(async (req, res) => {
        const id = accountFrom(req, res); const p = pageParams(req, res);
        if (!id || !p) return;
        const token = await requireToken(readAccessToken, res); if (!token) return;
        p.set('fields', LOOKALIKE_FIELDS);
        const result = await graph(token, `act_${id}/customaudiences`, 'GET', p);
        if (!result.ok) return metaError(res, result);
        const filtered = (result.body.data ?? []).filter((item: any) => item.subtype === 'LOOKALIKE');
        return res.json({
            success: true, adAccountId: `act_${id}`, count: filtered.length, audiences: filtered,
            pagination: pageOutput(result.body, Number(p.get('limit'))).pagination,
            note: 'Filtering is per page; fetch subsequent pages to discover all lookalikes.'
        });
    }));

    router.post('/meta/ad-accounts/:accountId/lookalike-audiences', safe(async (req, res) => {
        const accountId = accountFrom(req, res); if (!accountId) return;
        const { name, origin_audience_id, country, ratio = 0.01 } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim() || name.length > 255) return bad(res, 'Valid name required');
        if (!IS_ID(origin_audience_id)) return bad(res, 'Valid origin_audience_id required');
        if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return bad(res, 'country must be an ISO 2-letter uppercase code');
        if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.01 || ratio > 0.20) return bad(res, 'ratio must be 0.01 to 0.20; actual supported range is account/region dependent');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const seed = await verifyOwner(token, String(origin_audience_id), accountId, res); if (!seed) return;
        if (seed.subtype === 'LOOKALIKE') return bad(res, 'Use an eligible non-lookalike source audience');
        const lookalike_spec = JSON.stringify({ type: 'similarity', country, ratio });
        const result = await graph(token, `act_${accountId}/customaudiences`, 'POST',
            new URLSearchParams({ name: name.trim(), subtype: 'LOOKALIKE', origin_audience_id: String(origin_audience_id), lookalike_spec }));
        if (!result.ok) return metaError(res, result);
        return res.status(201).json({
            success: true, id: result.body?.id ?? null,
            note: 'Created only if Meta approved the source audience and parameters.'
        });
    }));

    // LESSON 6.5: Custom Audience details / update / delete.
    router.get('/meta/ad-accounts/:accountId/custom-audiences/:audienceId', safe(async (req, res) => {
        const accountId = accountFrom(req, res); const id = audienceFrom(req, res);
        if (!accountId || !id) return;
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, id, 'GET', new URLSearchParams({ fields: CUSTOMER_FIELDS }));
        if (!result.ok) return metaError(res, result);
        if (ACCOUNT_ID(result.body?.account_id) !== accountId) return bad(res, 'Wrong Ad Account', 403);
        return res.json({ success: true, audience: result.body });
    }));

    router.patch('/meta/ad-accounts/:accountId/custom-audiences/:audienceId', safe(async (req, res) => {
        const accountId = accountFrom(req, res); const id = audienceFrom(req, res);
        if (!accountId || !id) return;
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
            Object.keys(body).some(k => !['name', 'description'].includes(k))) return bad(res, 'Only name and description may be updated');
        if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255)) return bad(res, 'Invalid name');
        if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 1000)) return bad(res, 'Invalid description');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        if (!await verifyOwner(token, id, accountId, res)) return;
        const p = new URLSearchParams();
        if (body.name !== undefined) p.set('name', body.name.trim());
        if (body.description !== undefined) p.set('description', body.description);
        const result = await graph(token, id, 'POST', p); // Meta update uses POST.
        if (!result.ok) return metaError(res, result);
        if (result.body?.success !== true) return bad(res, 'Meta did not confirm update', 502);
        return res.json({ success: true, audienceId: id, updatedFields: Object.keys(body) });
    }));

    router.delete('/meta/ad-accounts/:accountId/custom-audiences/:audienceId', safe(async (req, res) => {
        const accountId = accountFrom(req, res); const id = audienceFrom(req, res);
        if (!accountId || !id) return;
        if (req.body?.confirmAudienceId !== id) return bad(res, 'confirmAudienceId must match URL ID');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        if (!await verifyOwner(token, id, accountId, res)) return;
        const result = await graph(token, id, 'DELETE');
        if (!result.ok) return metaError(res, result);
        if (result.body?.success !== true) return bad(res, 'Meta did not confirm deletion', 502);
        return res.json({ success: true, audienceId: id, deleted: true });
    }));

    // LESSON 6.6: Targeting search and suggestions.
    // Meta may retire or restrict certain targeting types or suggestions.
    router.get('/meta/targeting/search', safe(async (req, res) => {
        const type = req.query.type ?? 'adinterest';
        const q = req.query.q;
        if (type !== 'adinterest' && type !== 'adbehavior') return bad(res, 'type must be adinterest or adbehavior');
        if (typeof q !== 'string' || !q.trim() || q.length > 100) return bad(res, 'q is required (1–100 chars)');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const p = new URLSearchParams({ type: String(type), q: q.trim(), limit: '25' });
        const result = await graph(token, 'search', 'GET', p);
        if (!result.ok) return metaError(res, result);
        return res.json({ success: true, results: result.body?.data ?? [] });
    }));

    router.get('/meta/targeting/suggestions', safe(async (req, res) => {
        const ids = typeof req.query.interestIds === 'string' ? req.query.interestIds.split(',') : [];
        if (!ids.length || ids.length > 10 || ids.some(id => !IS_ID(id))) return bad(res, 'interestIds must be 1–10 comma-separated numeric IDs');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, 'search', 'GET', new URLSearchParams({
            type: 'adinterestsuggestion', interest_list: JSON.stringify(ids.map(id => ({ id }))),
        }));
        if (!result.ok) return metaError(res, result);
        return res.json({
            success: true, results: result.body?.data ?? [],
            note: 'Suggestions are version-dependent and may be unsupported.'
        });
    }));

    router.get('/meta/targeting/locations', safe(async (req, res) => {
        const q = req.query.q;
        const types = typeof req.query.locationTypes === 'string' ? req.query.locationTypes.split(',') : ['country'];
        const supported = ['country', 'region', 'city', 'zip'];
        if (typeof q !== 'string' || !q.trim() || q.length > 100) return bad(res, 'q is required');
        if (!types.length || types.some(t => !supported.includes(t))) return bad(res, 'Invalid locationTypes');
        const token = await requireToken(readAccessToken, res); if (!token) return;
        const result = await graph(token, 'search', 'GET', new URLSearchParams({
            type: 'adgeolocation', q: q.trim(), location_types: JSON.stringify(types),
        }));
        if (!result.ok) return metaError(res, result);
        return res.json({ success: true, results: result.body?.data ?? [] });
    }));

    // LESSON 6.7: Customer list upload/removal with SHA-256.
    // EDUCATIONAL IMPLEMENTATION: Sending raw personal data to your server requires
    // HTTPS, explicit legal basis/consent, retention policies, and strict access control.
    // NEVER run this with real people until those controls have been implemented.
    // A small demo batch only; for production use batching/queues & Meta guidelines.
    function customerPayload(body: any, res: Response): string | null {
        if (body?.confirmedPermission !== true) {
            bad(res, 'confirmedPermission:true required; use only data you are authorized to process'); return null;
        }
        const schema: unknown = body?.schema;
        const rows: unknown = body?.data;
        if (!Array.isArray(schema) || schema.length < 1 || schema.length > 2 ||
            schema.some((x: unknown) => x !== 'EMAIL' && x !== 'PHONE') || new Set(schema).size !== schema.length) {
            bad(res, 'schema must contain distinct EMAIL and/or PHONE identifiers'); return null;
        }
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100 ||
            rows.some((r: unknown) => !Array.isArray(r) || r.length !== schema.length ||
                r.some((x: unknown) => typeof x !== 'string' || !x.trim() || x.length > 320))) {
            bad(res, 'data must contain 1–100 matching identifier rows'); return null;
        }
        const normalized = rows.map((row: string[]) => row.map((value, column) => {
            let v = value.trim().toLowerCase();
            if (schema[column] === 'EMAIL') v = v.replace(/\s+/g, '');
            if (schema[column] === 'PHONE') {
                // Must include country calling code in input; strip separators & plus.
                v = v.replace(/[^0-9]/g, '');
                if (v.length < 8 || v.length > 15) throw new Error('Invalid phone number');
            }
            return createHash('sha256').update(v, 'utf8').digest('hex');
        }));
        return JSON.stringify({ schema, data: normalized });
    }

    for (const method of ['POST', 'DELETE'] as const) {
        const path = '/meta/ad-accounts/:accountId/custom-audiences/:audienceId/users';
        const handler = safe(async (req, res) => {
            const accountId = accountFrom(req, res); const id = audienceFrom(req, res);
            if (!accountId || !id) return;
            let payload: string | null;
            try { payload = customerPayload(req.body, res); }
            catch { return bad(res, 'Invalid customer identifier format'); }
            if (!payload) return;
            const token = await requireToken(readAccessToken, res); if (!token) return;
            const owner = await verifyOwner(token, id, accountId, res); if (!owner) return;
            if (owner.subtype !== 'CUSTOM') return bad(res, 'Customer uploads require CUSTOM subtype');
            const params = new URLSearchParams({ payload });
            // Meta expects payload on /{custom_audience_id}/users for both operations.
            const result = await graph(token, `${id}/users`, method, params);
            if (!result.ok) return metaError(res, result);
            return res.json({
                success: true, audienceId: id, action: method === 'POST' ? 'add' : 'remove',
                numReceived: result.body?.num_received ?? null,
                numInvalidEntries: result.body?.num_invalid_entries ?? null,
                note: 'User identifiers are not echoed back.'
            });
        });
        if (method === 'POST') router.post(path, handler);
        else router.delete(path, handler);
    }

    // LESSON 6.8: Website and engagement-based audiences.
    // Rule schemas are source-specific: caller must supply Meta-compatible rule.
    for (const subtype of ['WEBSITE', 'ENGAGEMENT'] as const) {
        const suffix = subtype === 'WEBSITE' ? 'website-audiences' : 'engagement-audiences';
        router.post(`/meta/ad-accounts/:accountId/${suffix}`, safe(async (req, res) => {
            const accountId = accountFrom(req, res); if (!accountId) return;
            const { name, description = '', rule, pixel_id } = req.body ?? {};
            if (typeof name !== 'string' || !name.trim() || name.length > 255) return bad(res, 'Valid name required');
            if (typeof description !== 'string' || description.length > 1000) return bad(res, 'Invalid description');
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return bad(res, 'A Meta-compatible rule object is required');
            if (JSON.stringify(rule).length > 12000) return bad(res, 'rule too large');
            if (subtype === 'WEBSITE' && !IS_ID(pixel_id)) return bad(res, 'A valid pixel_id is required for Website Audience');
            const token = await requireToken(readAccessToken, res); if (!token) return;
            const params = new URLSearchParams({ name: name.trim(), description, subtype, rule: JSON.stringify(rule) });
            if (subtype === 'WEBSITE') params.set('pixel_id', String(pixel_id));
            const result = await graph(token, `act_${accountId}/customaudiences`, 'POST', params);
            if (!result.ok) return metaError(res, result);
            return res.status(201).json({
                success: true, id: result.body?.id ?? null, subtype,
                note: 'Meta accepted the supplied source-specific rule.'
            });
        }));
    }

    // LESSON 6.9: Privacy, permission and restrictions — local guidance.
    router.get('/meta/audience-guidance', safe(async (_req, res) => {
        return res.json({
            success: true,
            guidance: {
                permissions: ['ads_read for reading as applicable', 'ads_management for mutations', 'Account/business asset access', 'Appropriate Meta app access level'],
                customerData: ['Obtain a valid lawful basis and required notices/consents', 'Normalize and SHA-256 hash identifiers before upload', 'Use HTTPS; avoid logs and unnecessary storage', 'Respect data deletion requests and retention rules'],
                eligibility: ['Lookalike source audience must meet Meta size/quality/geography requirements', 'Website/engagement rules vary by source and version', 'Meta may restrict targeting by region or Special Ad Category'],
                safety: ['Keep learning Campaigns/Ad Sets/Ads PAUSED', 'Do not use real customer data for practice', 'Review current Meta terms and endpoint support before production'],
            },
            note: 'This is educational guidance; not a real-time permissions or eligibility verification.',
        });
    }));

    return router;
}

export default createAudienceModuleRouter;

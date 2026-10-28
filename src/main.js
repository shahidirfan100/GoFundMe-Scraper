import { randomUUID } from 'node:crypto';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

import { dedupeConfigs, extractConfigCandidates } from './credentials.js';

const SEARCH_PAGE_URL = 'https://www.gofundme.com/s/fundraisers';
const ALGOLIA_PATH = '/1/indexes/*/queries';
const ORIGIN = 'https://www.gofundme.com';

const HITS_PER_PAGE = 16;
const BASE_FILTERS = 'status=1 AND custom_complete=1 AND has_redirect_url!=1';

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 5;

// Product default for runs with no search input.
// Must match the schema default so omitted-input runs and the Store test agree.
const DEFAULT_QUERY = 'medical';

// Last known good credentials. They rotate, so each value is a hint that gets
// validated before use; discovery re-derives current values when validation fails.
const BUILTIN_CONFIGS = [
    {
        appId: 'E7PHE9BB38',
        apiKey: '113bf60bccbbcc611baacee9a82a1cf9',
        indexName: 'prod_funds_feed_replica_1',
    },
    {
        appId: 'E7PHE9BB38',
        apiKey: '2a43f30c25e7719436f10fed6d788170',
        indexName: 'prod_funds_feed_replica_1',
    },
];

// All 23 impit 0.14.7 profiles passed the page and search probe on 2026-10-28.
// Chrome is the default; the rest are transport-failure fallbacks.
const BROWSER_PROFILES = ['chrome', 'chrome151', 'chrome142', 'firefox144', 'ios18', 'okhttp5'];

const REQUESTED_ATTRIBUTES = [
    'objectID',
    'url',
    'fundname',
    'username',
    'bene_name',
    'locationtext',
    'city',
    'state',
    'country',
    'balance',
    'realbalance',
    'goalamount',
    'amount_to_goal',
    'goal_progress',
    'donation_count_full',
    'currencycode',
    'funddescription',
    'category_id',
    'cause_category_ids',
    'charity_name',
    'thumb_img_url',
    'main_img_url',
    'created_at',
    'last_donation_at',
];

// Raw fields published by earlier versions. Keeping the list explicit stops new
// attributes from leaking into the dataset under their raw names.
const PRESERVED_RAW_FIELDS = [
    'objectID',
    'url',
    'fundname',
    'username',
    'bene_name',
    'balance',
    'goal_progress',
    'amount_to_goal',
    'donation_count_full',
    'currencycode',
    'thumb_img_url',
];

const REQUEST_TIMEOUT_MS = 45_000;
const GEOCODE_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_PAGE = 4;
const MAX_REFRESHES_PER_RUN = 3;
const MAX_RETRY_DELAY_MS = 20_000;
const MAX_DISCOVERY_SCRIPTS = 24;
const GEOCODE_USER_AGENT = 'GoFundMeFundraiserScraper/1.1 (Apify Actor; contact via Apify Console)';

const delay = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toNumberOrUndefined = (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
};

const toPositiveInt = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 1) return fallback;
    return Math.floor(num);
};

const toIsoFromUnixSeconds = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return new Date(num * 1000).toISOString();
};

const isBlank = (value) => value === undefined || value === null || value === '';

const cleanRecord = (value) => {
    if (Array.isArray(value)) {
        const cleaned = value.map(cleanRecord).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, val]) => [key, cleanRecord(val)])
            .filter(([, val]) => val !== undefined);

        if (!entries.length) return undefined;
        return Object.fromEntries(entries);
    }

    if (isBlank(value)) return undefined;
    return value;
};

const safeJsonParse = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

const isAuthFailure = (status, bodyText) => {
    if (status === 401 || status === 403) return true;
    if (!bodyText) return false;
    return /invalid application-id|invalid application id|invalid api key|api key|forbidden|unauthorized/i.test(
        bodyText,
    );
};

const rotate = (items, offset) => {
    if (!items.length) return items;
    const index = ((offset % items.length) + items.length) % items.length;
    return [...items.slice(index), ...items.slice(0, index)];
};

const buildAlgoliaHosts = (appId) => {
    const prefix = String(appId || '').toLowerCase();
    return [
        `${prefix}-dsn.algolia.net`,
        `${prefix}-1.algolianet.com`,
        `${prefix}-2.algolianet.com`,
        `${prefix}-3.algolianet.com`,
    ];
};

const pickUrlInput = (input) => {
    const candidates = [input.url, input.startUrl, Array.isArray(input.startUrls) ? input.startUrls[0] : undefined];

    for (const candidate of candidates) {
        const raw = typeof candidate === 'string' ? candidate : candidate?.url;
        const text = normalizeText(raw);
        if (!text) continue;

        try {
            const parsed = new URL(text);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('unsupported protocol');
            }
            return parsed.toString();
        } catch {
            log.warning(`Ignoring invalid URL input: ${text}`);
        }
    }

    return '';
};

const parseSearchUrl = (startUrl) => {
    try {
        const parsed = new URL(startUrl);
        return {
            query: normalizeText(
                parsed.searchParams.get('q') || parsed.searchParams.get('query') || parsed.searchParams.get('keyword'),
            ),
            locationDescription: normalizeText(
                parsed.searchParams.get('location-description') || parsed.searchParams.get('location'),
            ),
            lat: toNumberOrUndefined(parsed.searchParams.get('location-lat') ?? parsed.searchParams.get('lat')),
            lng: toNumberOrUndefined(parsed.searchParams.get('location-lng') ?? parsed.searchParams.get('lng')),
        };
    } catch {
        return {};
    }
};

const parseLatLng = (locationText) => {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(locationText || '');
    if (!match) return undefined;

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

    return { lat, lng, label: `${lat},${lng}` };
};

const geocodeLocation = async (locationText) => {
    const direct = parseLatLng(locationText);
    if (direct) return direct;

    const endpoint = new URL('https://nominatim.openstreetmap.org/search');
    endpoint.searchParams.set('q', locationText);
    endpoint.searchParams.set('format', 'jsonv2');
    endpoint.searchParams.set('limit', '1');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

    try {
        const response = await fetch(endpoint, {
            headers: {
                accept: 'application/json',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': GEOCODE_USER_AGENT,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            log.warning(`Location lookup returned HTTP ${response.status}. Continuing without a location filter.`);
            return undefined;
        }

        const data = await response.json();
        const first = Array.isArray(data) ? data[0] : undefined;
        const lat = toNumberOrUndefined(first?.lat);
        const lng = toNumberOrUndefined(first?.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            log.warning(`No coordinates found for location "${locationText}". Continuing without a location filter.`);
            return undefined;
        }

        return { lat, lng, label: normalizeText(first.display_name) || locationText };
    } catch (error) {
        log.warning(
            `Location lookup failed for "${locationText}": ${error.message}. Continuing without a location filter.`,
        );
        return undefined;
    } finally {
        clearTimeout(timer);
    }
};

const buildAlgoliaParams = ({ query, page, userToken, geo }) => {
    const params = new URLSearchParams();

    params.set(
        'analyticsTags',
        JSON.stringify(['platform:web', 'page:srp', 'framework:nextjs', 'flow:federated_entity']),
    );
    params.set('attributesToHighlight', JSON.stringify(['fundname', 'username', 'bene_name', 'amount_to_goal']));
    params.set('attributesToRetrieve', JSON.stringify(REQUESTED_ATTRIBUTES));
    params.set('clickAnalytics', 'true');
    params.set('exactOnSingleWordQuery', 'word');
    params.set('filters', BASE_FILTERS);
    params.set('hitsPerPage', String(HITS_PER_PAGE));
    params.set('page', String(page));
    params.set('query', query);
    params.set('ruleContexts', JSON.stringify(['federated_search']));
    params.set('userToken', userToken);

    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        params.set('aroundLatLng', `${geo.lat}, ${geo.lng}`);
        params.set('aroundRadius', '80467');
        params.set('aroundPrecision', '100');
        params.set('enableReRanking', 'false');
    }

    return params;
};

const extractScriptUrls = (html, baseUrl) => {
    const urls = [];

    for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
        try {
            urls.push(new URL(match[1], baseUrl).toString());
        } catch {
            // ignore malformed script URLs
        }
    }

    return [...new Set(urls)]
        .filter((url) => url.includes('/_next/static/'))
        .filter((url) => !/google|feroot|recaptcha/i.test(url))
        .slice(0, MAX_DISCOVERY_SCRIPTS);
};

const mapFundraiser = ({ hit, query, page, rank }) => {
    const slug = normalizeText(hit.url);
    const city = normalizeText(hit.city);
    const state = normalizeText(hit.state);
    const country = normalizeText(hit.country);
    const location =
        normalizeText(hit.locationtext) || [city, state].filter(Boolean).join(', ') || country || undefined;

    const raw = {};
    for (const field of PRESERVED_RAW_FIELDS) {
        if (hit[field] !== undefined) raw[field] = hit[field];
    }

    const normalized = {
        ...raw,
        fundraiser_id: hit.objectID,
        fundraiser_slug: slug || undefined,
        fundraiser_url: slug ? `${ORIGIN}/f/${slug}` : undefined,
        title: hit.fundname,
        organizer_name: hit.username,
        beneficiary_name: hit.bene_name,
        location,
        city: city || undefined,
        state: state || undefined,
        country: country || undefined,
        amount_raised: toNumberOrUndefined(hit.balance),
        real_balance: toNumberOrUndefined(hit.realbalance),
        goal_amount: toNumberOrUndefined(hit.goalamount),
        amount_to_goal: toNumberOrUndefined(hit.amount_to_goal),
        goal_progress: toNumberOrUndefined(hit.goal_progress),
        donation_count: toNumberOrUndefined(hit.donation_count_full),
        currency: hit.currencycode,
        description: normalizeText(hit.funddescription) || undefined,
        category_id: toNumberOrUndefined(hit.category_id),
        cause_category_ids: Array.isArray(hit.cause_category_ids) ? hit.cause_category_ids : undefined,
        charity_name: normalizeText(hit.charity_name) || undefined,
        image_url: normalizeText(hit.main_img_url) || normalizeText(hit.thumb_img_url) || undefined,
        created_at: toIsoFromUnixSeconds(hit.created_at),
        last_donation_at: toIsoFromUnixSeconds(hit.last_donation_at),
        search_query: query || undefined,
        page,
        rank_on_page: rank,
        scraped_at: new Date().toISOString(),
    };

    return cleanRecord(normalized);
};

const createHttpLayer = () => {
    let browserIndex = 0;
    let proxyConfiguration;
    let client;
    let proxyUrl;

    const open = async () => {
        const browser = BROWSER_PROFILES[browserIndex % BROWSER_PROFILES.length];

        if (proxyConfiguration) {
            try {
                proxyUrl = await proxyConfiguration.newUrl(`gfm-${randomUUID()}`);
            } catch (error) {
                log.warning(`Proxy session creation failed: ${error.message}. Continuing without a proxy.`);
                proxyUrl = undefined;
            }
        }

        client = new Impit({
            browser,
            ...(proxyUrl ? { proxyUrl } : {}),
            timeout: REQUEST_TIMEOUT_MS,
            vanillaFallback: true,
        });

        return { browser, proxied: Boolean(proxyUrl) };
    };

    return {
        attachProxy(configuration) {
            proxyConfiguration = configuration;
        },
        async start() {
            return open();
        },
        async rotate(reason) {
            browserIndex += 1;
            const state = await open();
            log.warning(`Rotated HTTP profile after ${reason}.`, state);
            return state;
        },
        fetch(url, init) {
            return client.fetch(url, init);
        },
    };
};

const createSearchApi = async ({ proxyConfiguration, referer }) => {
    const http = createHttpLayer();
    http.attachProxy(proxyConfiguration);

    const state = {
        config: undefined,
        refreshes: 0,
        authMode: 'query',
        hostOffset: Math.floor(Math.random() * 4),
    };

    const opened = await http.start();
    log.info('HTTP transport ready.', opened);

    const retryDelay = (response, attempt) => {
        const header = response?.headers?.get?.('retry-after');
        if (header) {
            const seconds = Number(header);
            if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
            const date = Date.parse(header);
            if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
        }
        const base = Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
        return base + Math.floor(Math.random() * 400);
    };

    const buildRequest = ({ config, host }, { params, mode, refererUrl }) => {
        const url = new URL(`https://${host}${ALGOLIA_PATH}`);
        const headers = {
            'content-type': 'application/x-www-form-urlencoded',
            origin: ORIGIN,
            referer: refererUrl || referer,
        };

        if (mode === 'query') {
            url.searchParams.set('x-algolia-application-id', config.appId);
            url.searchParams.set('x-algolia-api-key', config.apiKey);
        } else {
            headers['x-algolia-application-id'] = config.appId;
            headers['x-algolia-api-key'] = config.apiKey;
        }

        return {
            url: url.toString(),
            init: {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    requests: [{ indexName: config.indexName, params: params.toString() }],
                }),
            },
        };
    };

    const fetchText = async (url, { headers, attempts = 3, quiet = false } = {}) => {
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const response = await http.fetch(url, { headers });
                const text = await response.text();

                if (response.status === 200) return text;

                if (response.status === 429 || response.status >= 500) {
                    lastError = new Error(`HTTP ${response.status}`);
                    await delay(retryDelay(response, attempt));
                    continue;
                }

                lastError = new Error(`HTTP ${response.status}`);
                break;
            } catch (error) {
                lastError = error;
                if (attempt < attempts) await delay(retryDelay(undefined, attempt));
            }
        }

        if (!quiet) log.warning(`Request failed: ${url.split('?')[0]} (${lastError?.message || 'unknown error'})`);
        throw lastError || new Error('Request failed');
    };

    const probe = async (config) => {
        const hosts = buildAlgoliaHosts(config.appId);
        const params = new URLSearchParams({
            query: '',
            hitsPerPage: '1',
            page: '0',
            filters: BASE_FILTERS,
            userToken: randomUUID(),
        });

        for (const host of hosts.slice(0, 2)) {
            const request = buildRequest({ config, host }, { params, mode: 'query' });
            try {
                const response = await http.fetch(request.url, request.init);
                const text = await response.text();

                if (response.status === 200) {
                    const parsed = safeJsonParse(text);
                    if (Array.isArray(parsed?.results?.[0]?.hits)) return true;
                    continue;
                }

                if (isAuthFailure(response.status, text)) return false;
            } catch {
                // try the next host
            }
        }

        return false;
    };

    const discover = async () => {
        const found = [];
        const pageUrl = referer || `${SEARCH_PAGE_URL}?q=${encodeURIComponent(DEFAULT_QUERY)}`;

        try {
            const html = await fetchText(pageUrl, {
                headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
            });
            found.push(...extractConfigCandidates(html, BUILTIN_CONFIGS[0].indexName));

            if (dedupeConfigs(found).length < 3) {
                const scripts = extractScriptUrls(html, pageUrl);

                for (let index = 0; index < scripts.length; index += 5) {
                    const batch = scripts.slice(index, index + 5);
                    const texts = await Promise.all(
                        batch.map(async (scriptUrl) => {
                            try {
                                return await fetchText(scriptUrl, {
                                    headers: { accept: '*/*' },
                                    attempts: 1,
                                    quiet: true,
                                });
                            } catch {
                                return '';
                            }
                        }),
                    );

                    for (const text of texts)
                        found.push(...extractConfigCandidates(text, BUILTIN_CONFIGS[0].indexName));
                    if (dedupeConfigs(found).length >= 3) break;
                }
            }
        } catch (error) {
            log.warning(`Credential discovery could not read the search page: ${error.message}`);
        }

        return dedupeConfigs(found);
    };

    const refresh = async () => {
        if (state.refreshes >= MAX_REFRESHES_PER_RUN) {
            log.warning('Credential refresh budget exhausted.');
            return false;
        }
        state.refreshes += 1;

        const candidates = dedupeConfigs([...(await discover()), ...BUILTIN_CONFIGS]);

        for (const candidate of candidates) {
            if (!(await probe(candidate))) continue;

            state.config = candidate;
            log.info('Search configuration validated.', {
                appId: candidate.appId,
                indexName: candidate.indexName,
            });
            return true;
        }

        log.error('No live or built-in search configuration passed validation.');
        return false;
    };

    const ensureConfig = async () => {
        if (state.config) return;

        for (const candidate of BUILTIN_CONFIGS) {
            if (await probe(candidate)) {
                state.config = candidate;
                return;
            }
        }

        if (!(await refresh())) {
            throw new Error('No working search configuration found. The upstream search credentials may have rotated.');
        }
    };

    const fetchPage = async ({ query, page, geo }) => {
        await ensureConfig();

        let lastError;
        let attempt = 0;

        while (attempt < MAX_ATTEMPTS_PER_PAGE) {
            attempt += 1;
            const params = buildAlgoliaParams({ query, page, userToken: randomUUID(), geo });
            const hosts = rotate(
                buildAlgoliaHosts(state.config.appId).map((host) => ({ config: state.config, host })),
                state.hostOffset + attempt - 1,
            );
            const mode = attempt % 2 === 1 ? state.authMode : 'header';
            let retrySamePage = false;

            for (const target of hosts) {
                const request = buildRequest(target, { params, mode });

                let response;
                try {
                    response = await http.fetch(request.url, request.init);
                } catch (error) {
                    lastError = error;
                    continue;
                }

                const text = await response.text().catch(() => '');

                if (response.status === 200) {
                    const parsed = safeJsonParse(text);
                    const result = parsed?.results?.[0];

                    if (Array.isArray(result?.hits)) {
                        return {
                            hits: result.hits,
                            nbPages: Number(result.nbPages),
                            nbHits: Number(result.nbHits),
                        };
                    }

                    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') : 'none';
                    lastError = new Error(`Unexpected search response shape (top-level keys: ${keys})`);
                    log.warning('Search response did not contain results[0].hits. Refreshing credentials.');
                    await refresh();
                    retrySamePage = true;
                    break;
                }

                if (isAuthFailure(response.status, text)) {
                    lastError = new Error(`Search credentials rejected (HTTP ${response.status})`);
                    log.warning('Search credentials were rejected. Refreshing from the live site.');
                    await refresh();
                    retrySamePage = true;
                    break;
                }

                if (response.status === 429) {
                    const waitMs = retryDelay(response, attempt);
                    log.warning(`Search endpoint rate limited the request. Waiting ${Math.round(waitMs / 1000)}s.`);
                    await delay(waitMs);
                    retrySamePage = true;
                    break;
                }

                if (response.status >= 500) {
                    lastError = new Error(`Search endpoint returned HTTP ${response.status}`);
                    continue;
                }

                lastError = new Error(`Search endpoint returned HTTP ${response.status}`);
            }

            if (retrySamePage) continue;

            if (attempt === 2) {
                await http.rotate('repeated search transport failures');
            } else if (attempt < MAX_ATTEMPTS_PER_PAGE) {
                await delay(retryDelay(undefined, attempt));
            }
        }

        throw lastError || new Error('Search request failed after bounded retries');
    };

    return { fetchPage, ensureConfig };
};

const buildProxyConfiguration = async (proxyInput) => {
    if (!proxyInput || typeof proxyInput !== 'object') return undefined;

    const hasCustomUrls = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;
    const wantsApifyProxy = Boolean(proxyInput.useApifyProxy);

    if (!hasCustomUrls && !wantsApifyProxy) return undefined;

    if (wantsApifyProxy && !hasCustomUrls && !Actor.isAtHome()) {
        log.warning('Apify Proxy was requested outside the Apify platform. Continuing without a proxy.');
        return undefined;
    }

    return Actor.createProxyConfiguration(proxyInput);
};

const main = async () => {
    const input = (await Actor.getInput()) || {};

    const resultsWanted = toPositiveInt(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = Math.min(toPositiveInt(input.max_pages, DEFAULT_MAX_PAGES), 1000);

    const urlInput = pickUrlInput(input);
    const parsedUrl = urlInput ? parseSearchUrl(urlInput) : {};
    const keyword = normalizeText(input.keyword);
    const location = normalizeText(input.location);

    // Keyword, then location, then URL. URL carries the schema default, so keeping it
    // last stops that default from contaminating a keyword or location run.
    let mode;
    let query;
    let locationText;
    let referer = SEARCH_PAGE_URL;
    let geo;

    if (keyword) {
        mode = 'keyword';
        query = keyword;
        locationText = location;
    } else if (location) {
        mode = 'location';
        query = '';
        locationText = location;
    } else if (urlInput) {
        mode = 'url';
        query = parsedUrl.query || '';
        locationText = parsedUrl.locationDescription;
        referer = urlInput;
        if (Number.isFinite(parsedUrl.lat) && Number.isFinite(parsedUrl.lng)) {
            geo = {
                lat: parsedUrl.lat,
                lng: parsedUrl.lng,
                label: locationText || `${parsedUrl.lat},${parsedUrl.lng}`,
            };
        }
    } else {
        mode = 'default';
        query = DEFAULT_QUERY;
    }

    if (!geo && locationText) {
        geo = await geocodeLocation(locationText);
    }

    const proxyConfiguration = await buildProxyConfiguration(input.proxyConfiguration);

    log.info('Starting GoFundMe fundraiser scrape.', {
        mode,
        query: query || '(trending)',
        location: geo?.label || locationText || '(none)',
        resultsWanted,
        maxPages,
        proxy: Boolean(proxyConfiguration),
    });

    const searchApi = await createSearchApi({
        proxyConfiguration,
        referer: mode === 'url' ? referer : `${SEARCH_PAGE_URL}${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    });
    await searchApi.ensureConfig();

    const seen = new Set();
    let saved = 0;
    let pagesProcessed = 0;
    let stopReason = 'max_pages';
    let lastError;

    for (let page = 0; page < maxPages && saved < resultsWanted; page += 1) {
        let payload;

        try {
            payload = await searchApi.fetchPage({ query, page, geo });
        } catch (error) {
            lastError = error;
            log.error(`Search page ${page + 1} failed: ${error.message}`);
            stopReason = 'request_failed';
            break;
        }

        pagesProcessed += 1;

        const { hits } = payload;
        if (!hits.length) {
            stopReason = 'no_hits';
            break;
        }

        const rows = [];
        for (const [index, hit] of hits.entries()) {
            if (saved + rows.length >= resultsWanted) break;
            const uniqueKey = normalizeText(String(hit?.objectID || hit?.url || ''));

            if (!uniqueKey || seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);

            try {
                const mapped = mapFundraiser({ hit, query, page: page + 1, rank: index + 1 });
                if (mapped && Object.keys(mapped).length) rows.push(mapped);
            } catch (error) {
                log.warning(`Skipped malformed result on page ${page + 1}: ${error.message}`);
            }
        }

        if (rows.length) {
            await Actor.pushData(rows);
            saved += rows.length;
            log.info(`Saved ${rows.length} fundraisers from page ${page + 1}. Total ${saved}/${resultsWanted}.`);
        }

        if (!rows.length) {
            stopReason = 'no_new_results';
            break;
        }

        if (hits.length < HITS_PER_PAGE) {
            stopReason = 'short_page';
            break;
        }

        if (Number.isFinite(payload.nbPages) && page + 1 >= payload.nbPages) {
            stopReason = 'last_page';
            break;
        }
    }

    log.info(`Finished. Saved ${saved} fundraisers from ${pagesProcessed} page(s). Stop reason: ${stopReason}.`);

    if (saved === 0) {
        if (lastError) throw lastError;
        log.warning('No fundraisers matched the supplied search. Nothing was saved.');
    }
};

await Actor.init();

let exitCode = 0;
try {
    await main();
} catch (error) {
    log.exception(error, 'GoFundMe fundraiser scrape failed.');
    exitCode = 1;
}

await Actor.exit({ exitCode });

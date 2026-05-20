import { randomUUID } from 'node:crypto';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const DEFAULT_ALGOLIA_APP_ID = 'E7PHE9BB38';
const DEFAULT_ALGOLIA_API_KEY = '2a43f30c25e7719436f10fed6d788170';
const ALGOLIA_INDEX = 'prod_funds_feed_replica_1';
const DEFAULT_SEARCH_URL = 'https://www.gofundme.com/s/fundraisers';

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 5;
const HITS_PER_PAGE = 16;

await Actor.init();

const input = (await Actor.getInput()) || {};

const toPositiveInt = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(1, Math.floor(num));
};

const toNumberOrUndefined = (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
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

const firstString = (...values) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
};

const extractStartUrl = (rawInput) => {
    const candidates = [
        rawInput.url,
        rawInput.startUrl,
        Array.isArray(rawInput.startUrls) ? rawInput.startUrls[0] : undefined,
    ];

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'string') continue;
        try {
            return new URL(candidate.trim()).toString();
        } catch {
            log.warning(`Ignoring invalid URL input: ${candidate}`);
        }
    }

    return '';
};

const parseSearchUrl = (startUrl) => {
    if (!startUrl) return {};

    try {
        const parsed = new URL(startUrl);
        const keyword = firstString(
            parsed.searchParams.get('q'),
            parsed.searchParams.get('query'),
            parsed.searchParams.get('keyword'),
        );

        const locationDescription = firstString(
            parsed.searchParams.get('location-description'),
            parsed.searchParams.get('location'),
        );

        const lat = toNumberOrUndefined(
            parsed.searchParams.get('location-lat') ?? parsed.searchParams.get('lat'),
        );
        const lng = toNumberOrUndefined(
            parsed.searchParams.get('location-lng') ?? parsed.searchParams.get('lng'),
        );

        return {
            keyword,
            locationDescription,
            lat,
            lng,
        };
    } catch {
        return {};
    }
};

const parseLatLngFromLocation = (locationText) => {
    if (!locationText) return undefined;
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(locationText);
    if (!match) return undefined;

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

    return { lat, lng, label: `${lat},${lng}` };
};

const geocodeLocation = async (locationText, proxyUrl) => {
    const parsedLatLng = parseLatLngFromLocation(locationText);
    if (parsedLatLng) return parsedLatLng;

    const endpoint = 'https://nominatim.openstreetmap.org/search';

    try {
        const response = await gotScraping.get(endpoint, {
            proxyUrl,
            searchParams: {
                q: locationText,
                format: 'json',
                limit: '1',
            },
            headers: {
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': 'Mozilla/5.0 (compatible; ApifyGoFundMeScraper/1.0; +https://apify.com)',
            },
            timeout: { request: 30000 },
        });

        const data = JSON.parse(response.body || '[]');
        const first = Array.isArray(data) ? data[0] : undefined;

        if (!first) return undefined;

        const lat = toNumberOrUndefined(first.lat);
        const lng = toNumberOrUndefined(first.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;

        return {
            lat,
            lng,
            label: first.display_name || locationText,
        };
    } catch (error) {
        log.warning(`Could not geocode location "${locationText}": ${error.message}`);
        return undefined;
    }
};

const buildAlgoliaParams = ({ query, page, userToken, geo }) => {
    const params = new URLSearchParams();

    params.set('analyticsTags', JSON.stringify(['platform:web', 'page:srp', 'framework:nextjs', 'flow:federated_entity']));
    params.set('aroundLatLngViaIP', 'false');
    params.set('attributesToHighlight', JSON.stringify(['fundname', 'username', 'bene_name', 'amount_to_goal']));
    params.set('clickAnalytics', 'true');
    params.set('exactOnSingleWordQuery', 'word');
    params.set('filters', 'status=1 AND custom_complete=1 AND has_redirect_url!=1');
    params.set('hitsPerPage', String(HITS_PER_PAGE));
    params.set('page', String(page));
    params.set('query', query);
    params.set('ruleContexts', JSON.stringify(['federated_search']));
    params.set('userToken', userToken);

    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        params.set('aroundLatLng', `${geo.lat}, ${geo.lng}`);
        params.set('aroundPrecision', '100');
        params.set('aroundRadius', '80467');
        params.set('enableReRanking', 'false');
    }

    return params.toString();
};

const mapFundraiser = ({ hit, query, page, rank }) => {
    const cleanHit = { ...hit };
    Reflect.deleteProperty(cleanHit, '_highlightResult');

    const slug = typeof hit.url === 'string' ? hit.url.trim() : '';
    const fundraiserUrl = slug ? `https://www.gofundme.com/f/${slug}` : undefined;

    const normalized = {
        ...cleanHit,
        fundraiser_id: hit.objectID,
        fundraiser_slug: slug || undefined,
        fundraiser_url: fundraiserUrl,
        title: hit.fundname,
        organizer_name: hit.username,
        beneficiary_name: hit.bene_name,
        location: hit.locationtext,
        amount_raised: toNumberOrUndefined(hit.balance),
        amount_to_goal: toNumberOrUndefined(hit.amount_to_goal),
        donation_count: toNumberOrUndefined(hit.donation_count_full),
        goal_progress: toNumberOrUndefined(hit.goal_progress),
        currency: hit.currencycode,
        search_query: query || undefined,
        page,
        rank_on_page: rank,
        scraped_at: new Date().toISOString(),
    };

    return cleanRecord(normalized);
};

const buildAlgoliaHosts = (appId) => {
    const prefix = String(appId || '').toLowerCase();
    return [
        `${prefix}-2.algolianet.com`,
        `${prefix}-dsn.algolia.net`,
        `${prefix}-1.algolianet.com`,
    ];
};

const extractAlgoliaCredentialsFromText = (text) => {
    if (!text) return undefined;

    const appMatch = text.match(/ALGOLIA_SEARCH_APP_ID\|\|"([A-Z0-9]+)"/i)
        || text.match(/x-algolia-application-id(?:=|%3D)([A-Z0-9]+)/i);

    const keyMatch = text.match(/ALGOLIA_SEARCH_API_KEY\|\|"([a-z0-9]{20,})"/i)
        || text.match(/x-algolia-api-key(?:=|%3D)([a-z0-9]{20,})/i);

    if (!appMatch || !keyMatch) return undefined;

    return {
        appId: appMatch[1],
        apiKey: keyMatch[1],
    };
};

const extractBundleUrls = (html, baseUrl) => {
    const scriptSrcRegex = /<script[^>]+src="([^"]+)"/gi;
    const urls = [];
    let match;

    while ((match = scriptSrcRegex.exec(html)) !== null) {
        const src = match[1];
        try {
            urls.push(new URL(src, baseUrl).toString());
        } catch {
            // ignore malformed URLs
        }
    }

    const unique = [...new Set(urls)];
    const prioritized = unique.filter((url) => /\/chunks\/pages\/_app-/i.test(url));
    const secondary = unique.filter((url) => /\/_next\/static\/chunks\//i.test(url) && !/\/chunks\/pages\/_app-/i.test(url));

    return [...prioritized, ...secondary].slice(0, 12);
};

const buildSearchPageUrl = ({ startUrl, query }) => {
    if (startUrl) return startUrl;

    const u = new URL(DEFAULT_SEARCH_URL);
    if (query) u.searchParams.set('q', query);
    return u.toString();
};

const discoverAlgoliaCredentials = async ({ startUrl, query, proxyUrl }) => {
    const searchPageUrl = buildSearchPageUrl({ startUrl, query });

    let html;
    try {
        const pageResponse = await gotScraping.get(searchPageUrl, {
            proxyUrl,
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
            },
            timeout: { request: 45000 },
        });
        html = pageResponse.body || '';
    } catch (error) {
        log.warning(`Credential refresh page fetch failed: ${error.message}`);
        return undefined;
    }

    const fromHtml = extractAlgoliaCredentialsFromText(html);
    if (fromHtml) return { ...fromHtml, source: 'page_html' };

    const bundleUrls = extractBundleUrls(html, searchPageUrl);
    for (const bundleUrl of bundleUrls) {
        try {
            const bundleResponse = await gotScraping.get(bundleUrl, {
                proxyUrl,
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
                    'referer': searchPageUrl,
                },
                timeout: { request: 45000 },
            });

            const creds = extractAlgoliaCredentialsFromText(bundleResponse.body || '');
            if (creds) return { ...creds, source: 'app_bundle' };
        } catch {
            // continue with next bundle
        }
    }

    return undefined;
};

const isAlgoliaAuthFailure = ({ statusCode, bodyText }) => {
    if (statusCode === 401 || statusCode === 403) return true;

    if (!bodyText) return false;
    return /invalid application-id|api key|forbidden|unauthorized/i.test(bodyText);
};

const createAlgoliaClient = ({ startUrl, query, proxyConfiguration }) => {
    const state = {
        appId: DEFAULT_ALGOLIA_APP_ID,
        apiKey: DEFAULT_ALGOLIA_API_KEY,
        source: 'default',
    };

    const refresh = async () => {
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        const discovered = await discoverAlgoliaCredentials({ startUrl, query, proxyUrl });
        if (!discovered) return false;

        if (state.appId === discovered.appId && state.apiKey === discovered.apiKey) return false;

        state.appId = discovered.appId;
        state.apiKey = discovered.apiKey;
        state.source = discovered.source;
        log.warning(`Refreshed search credentials from ${discovered.source}.`);
        return true;
    };

    const fetchResults = async ({ requestBody, referer }) => {
        let refreshed = false;

        for (let attempt = 0; attempt < 2; attempt++) {
            const hosts = buildAlgoliaHosts(state.appId);

            for (const host of hosts) {
                const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

                try {
                    const response = await gotScraping.post(`https://${host}/1/indexes/*/queries`, {
                        proxyUrl,
                        throwHttpErrors: false,
                        searchParams: {
                            'x-algolia-application-id': state.appId,
                            'x-algolia-api-key': state.apiKey,
                        },
                        headers: {
                            'accept': 'application/json',
                            'content-type': 'application/x-www-form-urlencoded',
                            'origin': 'https://www.gofundme.com',
                            'referer': referer,
                            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
                        },
                        body: requestBody,
                        timeout: { request: 45000 },
                    });

                    const bodyText = response.body || '';
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        return JSON.parse(bodyText);
                    }

                    if (isAlgoliaAuthFailure({ statusCode: response.statusCode, bodyText })) {
                        if (!refreshed) {
                            const changed = await refresh();
                            refreshed = true;
                            if (changed) break;
                        }
                        throw new Error(`Search auth failed (${response.statusCode})`);
                    }

                    throw new Error(`Search endpoint ${host} returned ${response.statusCode}`);
                } catch (error) {
                    if (attempt === 1 && host === hosts[hosts.length - 1]) {
                        throw error;
                    }
                }
            }
        }

        throw new Error('Could not fetch search results from available hosts');
    };

    return { fetchResults, refresh };
};

const main = async () => {
    const resultsWanted = toPositiveInt(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toPositiveInt(input.max_pages, DEFAULT_MAX_PAGES);
    const startUrl = extractStartUrl(input);
    const parsedUrlInput = parseSearchUrl(startUrl);

    const query = firstString(parsedUrlInput.keyword, input.keyword);
    const locationInput = firstString(parsedUrlInput.locationDescription, input.location);

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    const proxyUrlForGeo = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

    let geo;
    if (Number.isFinite(parsedUrlInput.lat) && Number.isFinite(parsedUrlInput.lng)) {
        geo = {
            lat: parsedUrlInput.lat,
            lng: parsedUrlInput.lng,
            label: parsedUrlInput.locationDescription || locationInput,
        };
    } else if (locationInput) {
        geo = await geocodeLocation(locationInput, proxyUrlForGeo);
    }

    log.info('Starting GoFundMe scrape', {
        mode: startUrl ? 'url_or_mixed' : 'keyword_or_trending',
        query: query || '(trending)',
        location: geo?.label || locationInput || '(none)',
        resultsWanted,
        maxPages,
    });

    const algoliaClient = createAlgoliaClient({
        startUrl,
        query,
        proxyConfiguration,
    });

    const uniqueIds = new Set();
    let totalSaved = 0;

    for (let page = 0; page < maxPages && totalSaved < resultsWanted; page++) {
        const userToken = randomUUID();
        const requestBody = JSON.stringify({
            requests: [
                {
                    indexName: ALGOLIA_INDEX,
                    params: buildAlgoliaParams({
                        query,
                        page,
                        userToken,
                        geo,
                    }),
                },
            ],
        });

        let parsed;
        try {
            parsed = await algoliaClient.fetchResults({
                requestBody,
                referer: startUrl || DEFAULT_SEARCH_URL,
            });
        } catch (error) {
            log.error(`Request failed on page ${page + 1}: ${error.message}`);
            break;
        }

        const pageResult = parsed?.results?.[0] || {};
        const hits = Array.isArray(pageResult.hits) ? pageResult.hits : [];

        if (!hits.length) {
            log.info(`No hits returned on page ${page + 1}; stopping.`);
            break;
        }

        const rowsToPush = [];
        for (let index = 0; index < hits.length && totalSaved + rowsToPush.length < resultsWanted; index++) {
            const hit = hits[index];
            const uniqueKey = String(hit.objectID || hit.url || `${page}-${index}`);
            if (uniqueIds.has(uniqueKey)) continue;
            uniqueIds.add(uniqueKey);

            const mapped = mapFundraiser({
                hit,
                query,
                page: page + 1,
                rank: index + 1,
            });

            if (mapped && Object.keys(mapped).length) {
                rowsToPush.push(mapped);
            }
        }

        if (rowsToPush.length) {
            await Dataset.pushData(rowsToPush);
            totalSaved += rowsToPush.length;
            log.info(`Saved ${rowsToPush.length} records from page ${page + 1} (total ${totalSaved}/${resultsWanted}).`);
        }

        if (hits.length < HITS_PER_PAGE) {
            log.info('Last page reached by API hit count.');
            break;
        }
    }

    log.info(`Finished. Total records saved: ${totalSaved}`);
};

try {
    await main();
} finally {
    await Actor.exit();
}
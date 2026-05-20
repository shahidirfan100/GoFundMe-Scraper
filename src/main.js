import { randomUUID } from 'node:crypto';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const ALGOLIA_APP_ID = 'E7PHE9BB38';
const ALGOLIA_API_KEY = '2a43f30c25e7719436f10fed6d788170';
const ALGOLIA_INDEX = 'prod_funds_feed_replica_1';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-2.algolianet.com/1/indexes/*/queries`;
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

        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

        let apiResponse;
        try {
            apiResponse = await gotScraping.post(ALGOLIA_URL, {
                proxyUrl,
                searchParams: {
                    'x-algolia-application-id': ALGOLIA_APP_ID,
                    'x-algolia-api-key': ALGOLIA_API_KEY,
                },
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/x-www-form-urlencoded',
                    'origin': 'https://www.gofundme.com',
                    'referer': startUrl || 'https://www.gofundme.com/s/fundraisers',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
                },
                body: requestBody,
                timeout: { request: 45000 },
            });
        } catch (error) {
            log.error(`Request failed on page ${page + 1}: ${error.message}`);
            break;
        }

        let parsed;
        try {
            parsed = JSON.parse(apiResponse.body);
        } catch {
            log.error(`Non-JSON API response on page ${page + 1}`);
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

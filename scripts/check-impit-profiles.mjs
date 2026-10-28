/* eslint-disable no-console */
/**
 * Impit browser-profile compatibility probe.
 *
 * Run with: node scripts/check-impit-profiles.mjs
 *
 * For every browser profile supported by the installed impit version this script
 * performs the two requests the actor depends on:
 *   1. GET the GoFundMe search page (used for credential discovery)
 *   2. POST the Algolia multi-query endpoint (used for fundraiser data)
 *
 * It prints a compact table so the actor's default profile order can be based on
 * evidence rather than assumption. Credentials are read from the live page, the
 * same way the actor does it, so the probe also verifies the discovery path.
 */
import { Impit } from 'impit';

import { extractConfigCandidates } from '../src/credentials.js';

const SEARCH_PAGE_URL = 'https://www.gofundme.com/s/fundraisers?q=medical';
const FALLBACK_INDEX = 'prod_funds_feed_replica_1';
const PROFILES = [
    'chrome',
    'chrome100',
    'chrome101',
    'chrome104',
    'chrome107',
    'chrome110',
    'chrome116',
    'chrome124',
    'chrome125',
    'chrome131',
    'chrome136',
    'chrome142',
    'chrome151',
    'firefox',
    'firefox128',
    'firefox133',
    'firefox135',
    'firefox144',
    'okhttp',
    'okhttp3',
    'okhttp4',
    'okhttp5',
    'ios18',
];

const extractConfig = (text) => {
    const [candidate] = extractConfigCandidates(text, FALLBACK_INDEX);
    return candidate ? { appId: candidate.appId, apiKey: candidate.apiKey, index: candidate.indexName } : {};
};

const isAuthFailure = (status, body) =>
    status === 401 ||
    status === 403 ||
    /invalid application-id|invalid application id|api key|forbidden|unauthorized/i.test(body);

const discover = async (client) => {
    const page = await client.fetch(SEARCH_PAGE_URL, {
        headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const html = await page.text();
    let config = extractConfig(html);

    if (!config.appId || !config.apiKey || !config.index) {
        const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))]
            .map((src) => {
                try {
                    return new URL(src, SEARCH_PAGE_URL).toString();
                } catch {
                    return undefined;
                }
            })
            .filter(Boolean)
            .filter((url) => url.includes('/_next/static/'));

        for (let i = 0; i < scripts.length; i += 6) {
            const batch = await Promise.all(
                scripts.slice(i, i + 6).map(async (url) => {
                    try {
                        const res = await client.fetch(url, { headers: { accept: '*/*' } });
                        if (!res.ok) return '';
                        return await res.text();
                    } catch {
                        return '';
                    }
                }),
            );
            for (const text of batch) {
                const found = extractConfig(text);
                if (found.appId && found.apiKey && found.index) {
                    config = found;
                    break;
                }
            }
            if (config.appId && config.apiKey && config.index) break;
        }
    }

    return { htmlStatus: page.status, html, config };
};

const run = async () => {
    const results = [];

    for (const profile of PROFILES) {
        const row = { profile, page: '-', html: '-', search: '-', hits: '-' };
        let client;
        try {
            client = new Impit({ browser: profile, timeout: 45000, vanillaFallback: true });
            const { htmlStatus, html, config } = await discover(client);
            row.page = htmlStatus;
            row.html = /__NEXT_DATA__/.test(html) ? 'yes' : 'no';
            if (process.env.DEBUG_PROFILE) console.log('  config:', config);

            if (!config.appId || !config.apiKey || !config.index) {
                row.search = 'no-config';
            } else {
                const params = new URLSearchParams({
                    query: 'medical',
                    hitsPerPage: '3',
                    page: '0',
                    filters: 'status=1 AND custom_complete=1 AND has_redirect_url!=1',
                    userToken: crypto.randomUUID(),
                });
                const body = JSON.stringify({
                    requests: [{ indexName: config.index, params: params.toString() }],
                });
                const url = `https://${config.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=${config.appId}&x-algolia-api-key=${config.apiKey}`;
                const response = await client.fetch(url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        origin: 'https://www.gofundme.com',
                        referer: SEARCH_PAGE_URL,
                    },
                    body,
                });
                const text = await response.text();
                row.search = response.status;
                if (response.ok) {
                    try {
                        const hits = JSON.parse(text)?.results?.[0]?.hits;
                        row.hits = Array.isArray(hits) ? hits.length : 'no-hits';
                    } catch {
                        row.hits = 'bad-json';
                    }
                } else if (isAuthFailure(response.status, text)) {
                    row.hits = 'auth';
                }
            }
        } catch (error) {
            row.error = error.message.slice(0, 60);
        }

        results.push(row);
        console.log(
            [
                row.profile.padEnd(11),
                `page=${String(row.page).padEnd(4)}`,
                `next=${String(row.html).padEnd(4)}`,
                `search=${String(row.search).padEnd(9)}`,
                `hits=${String(row.hits).padEnd(8)}`,
                row.error ? `error=${row.error}` : '',
            ].join(' '),
        );
    }

    const working = results.filter((r) => r.page === 200 && r.html === 'yes' && r.search === 200 && Number(r.hits) > 0);
    console.log(
        `\nWorking profiles (${working.length}/${results.length}): ${working.map((r) => r.profile).join(', ')}`,
    );
};

await run();

const firstMatch = (text, patterns) => {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1]) return match[1];
    }
    return undefined;
};

/**
 * Pull Algolia credentials out of a Next.js bundle or page body.
 *
 * Credentials sit in an `algolia: { appId, searchApiKey, fundsHitIndex }` object.
 * Earlier versions matched `searchApiKey` inside `givingFundsSearchApiKey` and read
 * `"production"` from a ternary as the index name, so both shapes are guarded here.
 */
export const extractConfigCandidates = (text, fallbackIndexName) => {
    const candidates = [];
    if (!text) return candidates;

    const lower = text.toLowerCase();
    let cursor = 0;

    while (cursor < lower.length) {
        const at = lower.indexOf('algolia', cursor);
        if (at === -1) break;
        cursor = at + 7;

        // The bounded window avoids matching a different app's credentials in the same bundle.
        const window = text.slice(at, at + 1200);
        const appId = firstMatch(window, [/appId\s*:\s*["']([A-Z0-9]{8,})["']/]);
        const apiKey = firstMatch(window, [/(?<![A-Za-z])searchApiKey\s*:\s*["']([A-Za-z0-9]{20,})["']/]);
        const indexName = firstMatch(window, [
            /["']([a-z0-9_]*funds_feed[a-z0-9_]*)["']/i,
            /(?:fundsHitIndex|hitIndex)\s*:\s*["'](?!production|staging|test)([a-z0-9_]{4,})["']/i,
        ]);

        if (appId && apiKey) {
            candidates.push({ appId, apiKey, indexName: indexName || fallbackIndexName });
        }
    }

    const legacyAppId = firstMatch(text, [
        /x-algolia-application-id(?:=|%3D|["']\s*:\s*["'])([A-Z0-9]{8,})/,
        /ALGOLIA_SEARCH_APP_ID\s*\|\|\s*["']([A-Z0-9]{8,})["']/,
    ]);
    const legacyApiKey = firstMatch(text, [
        /x-algolia-api-key(?:=|%3D|["']\s*:\s*["'])([A-Za-z0-9]{20,})/,
        /ALGOLIA_SEARCH_API_KEY\s*\|\|\s*["']([A-Za-z0-9]{20,})["']/,
    ]);

    if (legacyAppId && legacyApiKey) {
        candidates.push({ appId: legacyAppId, apiKey: legacyApiKey, indexName: fallbackIndexName });
    }

    return candidates;
};

export const dedupeConfigs = (configs) => {
    const seen = new Set();
    return configs.filter((config) => {
        if (!config?.appId || !config?.apiKey) return false;
        const key = `${config.appId}|${config.apiKey}|${config.indexName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

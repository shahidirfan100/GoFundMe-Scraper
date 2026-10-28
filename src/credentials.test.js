import { describe, expect, it } from 'vitest';

import { dedupeConfigs, extractConfigCandidates } from './credentials.js';

const FALLBACK_INDEX = 'prod_funds_feed_replica_1';

describe('extractConfigCandidates', () => {
    it('reads app id, search key and index from the live config shape', () => {
        const bundle = `{algolia:{appId:"E7PHE9BB38",fundsHitIndex:"production"===e.host?"prod_funds_feed_replica_1":"test01_funds_feed_replica_1",givingFundsSearchApiKey:"40a9122be772e80f91ea7535394d8f11",searchApiKey:"113bf60bccbbcc611baacee9a82a1cf9"}}`;
        const [candidate] = extractConfigCandidates(bundle, FALLBACK_INDEX);

        expect(candidate).toEqual({
            appId: 'E7PHE9BB38',
            apiKey: '113bf60bccbbcc611baacee9a82a1cf9',
            indexName: 'prod_funds_feed_replica_1',
        });
    });

    it('does not treat givingFundsSearchApiKey as searchApiKey', () => {
        const bundle = `algolia:{appId:"E7PHE9BB38",givingFundsSearchApiKey:"40a9122be772e80f91ea7535394d8f11"}`;

        expect(extractConfigCandidates(bundle, FALLBACK_INDEX)).toEqual([]);
    });

    it('does not read the environment name from a ternary as the index', () => {
        const bundle = `algolia:{appId:"E7PHE9BB38",searchApiKey:"113bf60bccbbcc611baacee9a82a1cf9",hitIndex:"production"===e.host?"prod_funds_feed":"staging_funds_feed"}`;
        const [candidate] = extractConfigCandidates(bundle, FALLBACK_INDEX);

        expect(candidate.indexName).toBe('prod_funds_feed');
    });

    it('falls back to the supplied index when the bundle omits one', () => {
        const bundle = `algolia:{appId:"E7PHE9BB38",searchApiKey:"113bf60bccbbcc611baacee9a82a1cf9"}`;
        const [candidate] = extractConfigCandidates(bundle, FALLBACK_INDEX);

        expect(candidate.indexName).toBe(FALLBACK_INDEX);
    });

    it('reads the legacy query-string credential shape', () => {
        const body = 'x-algolia-application-id=E7PHE9BB38&x-algolia-api-key=2a43f30c25e7719436f10fed6d788170';
        const candidates = extractConfigCandidates(body, FALLBACK_INDEX);

        expect(candidates).toContainEqual({
            appId: 'E7PHE9BB38',
            apiKey: '2a43f30c25e7719436f10fed6d788170',
            indexName: FALLBACK_INDEX,
        });
    });

    it('returns nothing for empty or unrelated text', () => {
        expect(extractConfigCandidates('', FALLBACK_INDEX)).toEqual([]);
        expect(extractConfigCandidates('<html>no config</html>', FALLBACK_INDEX)).toEqual([]);
    });
});

describe('dedupeConfigs', () => {
    it('keeps the first copy of each app/key/index tuple', () => {
        const config = { appId: 'E7PHE9BB38', apiKey: 'abc123', indexName: FALLBACK_INDEX };

        expect(dedupeConfigs([config, { ...config }, { ...config, apiKey: 'other' }])).toHaveLength(2);
    });

    it('drops incomplete configs', () => {
        expect(dedupeConfigs([{ appId: 'E7PHE9BB38' }, null, { apiKey: 'abc123' }])).toEqual([]);
    });
});

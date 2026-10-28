# API Discovery

Fresh discovery performed 2026-10-28. The previous notes in this file described an Algolia key that no longer matches the live bundle layout and an extraction regex that silently produced wrong values. Everything below was re-derived from the current site build (`buildId: JHP3S5ESaZUzOMXt1osrI`) and verified with live requests.

Reading this file first is part of the failure checklist: it records what a correct request looks like, so a failing run can be compared against it instead of guessed at.

## Selected API

| Item            | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| Endpoint        | `POST https://{appId}-dsn.algolia.net/1/indexes/*/queries`                            |
| Alternate hosts | `{appId}-1.algolianet.com`, `{appId}-2.algolianet.com`, `{appId}-3.algolianet.com`    |
| Auth            | `x-algolia-application-id` + `x-algolia-api-key`, sent as query parameters or headers |
| Index           | `prod_funds_feed_replica_1`                                                           |
| Pagination      | `page` (0-based) + `hitsPerPage` (16), bounded by `nbPages`                           |
| Keyword         | `query`                                                                               |
| Location        | `aroundLatLng`, `aroundRadius` (80467 m), `aroundPrecision` (100)                     |
| Base filter     | `status=1 AND custom_complete=1 AND has_redirect_url!=1`                              |
| Response path   | `results[0].hits[]`, `results[0].nbHits`, `results[0].nbPages`                        |

### Request body

```json
{
    "requests": [
        {
            "indexName": "prod_funds_feed_replica_1",
            "params": "<url-encoded Algolia search parameters>"
        }
    ]
}
```

### Parameters the site sends

| Parameter                | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| `analyticsTags`          | `["platform:web","page:srp","framework:nextjs","flow:federated_entity"]` |
| `attributesToHighlight`  | `["fundname","username","bene_name","amount_to_goal"]`                   |
| `attributesToRetrieve`   | see field list below                                                     |
| `clickAnalytics`         | `true`                                                                   |
| `exactOnSingleWordQuery` | `word`                                                                   |
| `filters`                | `status=1 AND custom_complete=1 AND has_redirect_url!=1`                 |
| `hitsPerPage`            | `16`                                                                     |
| `page`                   | `0..nbPages-1`                                                           |
| `query`                  | user keyword, empty string for trending                                  |
| `ruleContexts`           | `["federated_search"]`                                                   |
| `userToken`              | random UUID per page                                                     |
| `aroundLatLng`           | `"lat, lng"` only when a location is resolved                            |
| `aroundRadius`           | `80467` only with `aroundLatLng`                                         |
| `aroundPrecision`        | `100` only with `aroundLatLng`                                           |
| `enableReRanking`        | `false` only with `aroundLatLng`                                         |

The site also adds `optionalFilters: ["country:XX"]` from the visitor country. The actor does not, so keyword searches stay global. A resolved location already scopes results geographically.

## Credentials and live discovery

There is no credential in the server-rendered HTML and no `__NEXT_DATA__` search payload (`__SWR_FALLBACK__` is empty). Results and credentials arrive client-side.

Credentials live in Next.js chunks that contain an `algolia: { ... }` config object:

```
appId: "E7PHE9BB38"
searchApiKey: "<32 hex chars>"
fundsHitIndex: production ? "prod_funds_feed_replica_1" : "test01_funds_feed_replica_1"
```

Two valid search keys were observed in different chunks during discovery:

| Key                                | Status     |
| ---------------------------------- | ---------- |
| `113bf60bccbbcc611baacee9a82a1cf9` | valid, 200 |
| `2a43f30c25e7719436f10fed6d788170` | valid, 200 |

Both work, which gives the refresh path more than one candidate. Keys are search-only and public by design. They rotate without notice, so the actor treats every embedded value as a hint and validates it before use.

Discovery order:

1. `GET https://www.gofundme.com/s/fundraisers?q=<query>` (or the supplied URL).
2. Scan the HTML for the credential shapes above.
3. If incomplete, fetch Next.js chunks in batches of 5, scanning each response.
4. Collect every candidate tuple (`appId`, `apiKey`, `indexName`).
5. Validate each candidate with a 1-hit probe. Only a `200` with `results[0].hits` as an array is accepted.
6. Fall back to the last known good built-in tuple if discovery finds nothing usable.

The old implementation matched `searchApiKey` inside `givingFundsSearchApiKey` and read `"production"` as the index name. Both bugs were reproduced during this rebuild. Candidate validation now catches that class of error before any data request.

## Field coverage

`attributesToRetrieve` includes every field the listing needs, plus the campaign metadata below.

| Raw field                        | Mapped field                        | Notes                                          |
| -------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `objectID`                       | `fundraiser_id`                     | numeric string                                 |
| `url`                            | `fundraiser_slug`, `fundraiser_url` | slug, then `https://www.gofundme.com/f/{slug}` |
| `fundname`                       | `title`                             |                                                |
| `username`                       | `organizer_name`                    |                                                |
| `bene_name`                      | `beneficiary_name`                  | often empty                                    |
| `locationtext`                   | `location`                          | city/state fallback when empty                 |
| `balance`                        | `amount_raised`                     |                                                |
| `goalamount`                     | `goal_amount`                       | new                                            |
| `realbalance`                    | `real_balance`                      | new                                            |
| `amount_to_goal`                 | `amount_to_goal`                    |                                                |
| `goal_progress`                  | `goal_progress`                     | ratio, can exceed 1                            |
| `donation_count_full`            | `donation_count`                    | total donations                                |
| `currencycode`                   | `currency`                          |                                                |
| `funddescription`                | `description`                       | new, full text                                 |
| `city` / `state` / `country`     | same names                          | new                                            |
| `category_id`                    | `category_id`                       | new                                            |
| `cause_category_ids`             | `cause_category_ids`                | new                                            |
| `charity_name`                   | `charity_name`                      | new                                            |
| `main_img_url` / `thumb_img_url` | `image_url`                         | new                                            |
| `created_at`                     | `created_at`                        | unix seconds converted to ISO                  |
| `last_donation_at`               | `last_donation_at`                  | unix seconds converted to ISO                  |

`created_at` and `last_donation_at` are unix seconds, not milliseconds.

## Candidate matrix

| Candidate                           | Marker               | Result                            | Decision                                        |
| ----------------------------------- | -------------------- | --------------------------------- | ----------------------------------------------- |
| Algolia `*/queries`, desktop Chrome | `results[0].hits`    | 200, 16 hits, 1.4M+ for `medical` | selected                                        |
| Algolia with header auth            | same                 | 200                               | used as second auth transport                   |
| Algolia with iOS Safari UA          | same                 | 200, identical payload            | no separate mobile endpoint needed              |
| Algolia with okhttp UA              | same                 | 200, identical payload            | no app-only API found                           |
| `graphql.gofundme.com/graphql`      | `data.__typename`    | 200, introspection disabled       | campaign detail surface, not search             |
| `gofundme.com/s/fundraisers` HTML   | `__NEXT_DATA__`      | 200 but zero results in payload   | not a data source                               |
| `api.gofundme.com/geolocation`      | country/city/lat/lng | 200                               | optional country hint, unused                   |
| `api.gofundme.com/location/address` | none                 | 403                               | native gateway is a different host, not exposed |
| `GET /1/indexes/{index}/search`     | none                 | 404 `ObjectID does not exist`     | rejected                                        |
| `POST /1/indexes/{index}/search`    | none                 | 404 path not supported            | rejected                                        |

No mobile or app-specific search endpoint exists in the bundles. The same Algolia index serves desktop, iOS and Android profiles, so mobile emulation adds nothing beyond TLS diversity.

## Impit profile verification

`node scripts/check-impit-profiles.mjs` runs the discovery page request and the Algolia request for every profile supported by impit 0.14.7.

Result on 2026-10-28: **23/23 profiles passed**, each returning the page with `__NEXT_DATA__` and 3 Algolia hits.

```
chrome, chrome100, chrome101, chrome104, chrome107, chrome110, chrome116,
chrome124, chrome125, chrome131, chrome136, chrome142, chrome151, firefox,
firefox128, firefox133, firefox135, firefox144, okhttp, okhttp3, okhttp4,
okhttp5, ios18
```

Because every profile works, the actor starts with `chrome` and rotates through `chrome151`, `chrome142`, `firefox144`, `ios18`, `okhttp5` only after a transport failure. `vanillaFallback: true` is enabled as a safety valve.

## Failure map

| Symptom                                 | Cause                     | Recovery                                           |
| --------------------------------------- | ------------------------- | -------------------------------------------------- |
| `403 Invalid Application-ID or API key` | search key rotated        | re-run discovery, validate candidates, retry page  |
| `429`                                   | rate limit                | honour `Retry-After`, cap at 20 s, retry same page |
| `5xx` or connection reset               | host or proxy issue       | next Algolia host, then rotate proxy/browser       |
| `200` without `results[0].hits`         | response contract changed | refresh credentials, log top-level keys, stop page |
| empty `hits` with valid `nbHits`        | page past the end         | normal stop condition                              |
| geocoding failure                       | Nominatim unavailable     | warn, run keyword-only instead of failing          |

## Verification

```bash
node scripts/check-impit-profiles.mjs   # all profiles, both endpoints
npm start                               # local actor run
npm run lint                            # must be clean
```

Live probe used during discovery:

```bash
curl -s -X POST \
  "https://e7phe9bb38-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=E7PHE9BB38&x-algolia-api-key=<key>" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data '{"requests":[{"indexName":"prod_funds_feed_replica_1","params":"query=medical&hitsPerPage=3"}]}'
```

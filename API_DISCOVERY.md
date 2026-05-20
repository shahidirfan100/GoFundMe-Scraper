# API Discovery

## Selected API

- Endpoint: `https://e7phe9bb38-2.algolianet.com/1/indexes/*/queries`
- Method: `POST`
- Auth: Public Algolia app credentials in query string (`x-algolia-application-id`, `x-algolia-api-key`)
- Pagination: `page` + `hitsPerPage`
- Base filter: `status=1 AND custom_complete=1 AND has_redirect_url!=1`
- Keyword parameter: `query`
- Location filter: `aroundLatLng`, `aroundRadius`, `aroundPrecision`
- Typical response path: `results[0].hits[]`

## Field Coverage

Compared with the legacy HTML actor, this endpoint returns richer fundraiser listing fields, including:

- `objectID`
- `fundname`
- `username`
- `bene_name`
- `balance`
- `amount_to_goal`
- `goal_progress`
- `donation_count_full`
- `currencycode`
- `thumb_img_url`
- `url`
- plus additional campaign metadata depending on result

## Why This API Was Chosen

- Direct JSON response with stable pagination controls
- Supports keyword and location-based search behavior
- Returns significantly more fields than listing-page HTML extraction
- Works with direct HTTP requests; browser rendering is not required for data extraction

## Rejected Candidates

- `api.gofundme.com/person/v2/account`: account endpoint, not search data
- `api.gofundme.com/geolocation`: only detects visitor geo context
- HTML listing pages: lower field density and less stable than direct JSON search endpoint
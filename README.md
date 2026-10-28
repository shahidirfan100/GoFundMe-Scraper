## What does GoFundMe Fundraiser Scraper do?

GoFundMe Fundraiser Scraper collects public fundraiser listings from GoFundMe search results and returns them as a structured dataset. Run it with a keyword, a location, or a full GoFundMe search URL to gather campaign titles, organizers, amounts raised, goals, donation counts, categories, and direct fundraiser links.

The Actor is built for recurring data work: fundraising research, giving trend monitoring, regional campaign comparisons, and outreach lists. Each run produces clean records you can download as CSV, Excel, JSON, or XML, or send straight into a spreadsheet, database, or automation.

## Why use GoFundMe Fundraiser Scraper?

- One row per campaign, with organizer, location, amounts, donation count, category, and description in the same record.
- Three ways to search: keyword, location, or a GoFundMe search URL with its filters intact.
- Recurring runs stay comparable because field names and search modes do not change between runs.
- Results are saved page by page, so a later request failure does not discard pages already collected.
- The default search runs without any input, so you can inspect the output before configuring a real query.

## What data can you extract from GoFundMe?

| Field                | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `fundraiser_id`      | GoFundMe campaign identifier                         |
| `fundraiser_slug`    | Campaign slug used in the GoFundMe URL               |
| `fundraiser_url`     | Direct link to the fundraiser page                   |
| `title`              | Campaign title                                       |
| `organizer_name`     | Organizer display name                               |
| `beneficiary_name`   | Beneficiary name when the campaign lists one         |
| `location`           | Campaign location such as city and state             |
| `city`               | City when available                                  |
| `state`              | State or region when available                       |
| `country`            | Two-letter country code                              |
| `amount_raised`      | Amount raised so far in the campaign currency        |
| `real_balance`       | Current balance reported for the campaign            |
| `goal_amount`        | Fundraising goal                                     |
| `amount_to_goal`     | Amount still needed to reach the goal                |
| `goal_progress`      | Progress ratio where 1 means 100 percent of the goal |
| `donation_count`     | Total donations recorded                             |
| `currency`           | Currency code such as USD, GBP, or EUR               |
| `description`        | Full campaign description text                       |
| `category_id`        | GoFundMe category identifier                         |
| `cause_category_ids` | Related cause category identifiers                   |
| `charity_name`       | Linked charity name when the campaign has one        |
| `image_url`          | Main campaign image URL                              |
| `created_at`         | Campaign creation time in ISO format                 |
| `last_donation_at`   | Most recent donation time in ISO format              |
| `search_query`       | Keyword used for the run                             |
| `page`               | Search result page where the campaign appeared       |
| `rank_on_page`       | Position on that page                                |
| `scraped_at`         | Time the record was saved                            |

## How to use GoFundMe Fundraiser Scraper

1. Open the Actor on Apify Store.
2. Choose one search mode: enter a keyword, enter a location, or paste a GoFundMe search URL.
3. Set `results_wanted` and `max_pages` to control run size.
4. Start the run.
5. Review the dataset, then download it or connect it to your workflow.

Search modes have a fixed priority. A keyword is used first. If no keyword is supplied, a location is used. If neither is supplied, the URL field is used. The URL field also carries the default search, so you can leave every field empty and still get a working sample run.

### Keyword search

Use a keyword when you want campaigns about a cause, a person, or an event. Broad terms return more results, while specific phrases return closer matches.

### Location search

Use a location when you want campaigns near a place. City names, regions, countries, and `lat,lng` coordinates are accepted. If the location cannot be resolved, the run continues without a location filter and logs a warning instead of failing.

### URL search

Paste a GoFundMe search URL to reuse an exact search, including filters that the site adds to its own URLs. The Actor reads `q`, `location-description`, `location-lat`, and `location-lng` from the URL.

### Keyword with location

Supply both fields to combine a topic with a place, for example `cancer` in New York. This is the most precise mode for regional research.

## Input Parameters

| Parameter            | Type    | Required | Default                                            | Description                                                                         |
| -------------------- | ------- | -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `url`                | String  | No       | `https://www.gofundme.com/s/fundraisers?q=medical` | Full GoFundMe search URL. Used only when no keyword or location is supplied.        |
| `keyword`            | String  | No       | -                                                  | Search term for fundraiser titles and related text. Highest priority.               |
| `location`           | String  | No       | -                                                  | City, region, country, or `lat,lng`. Combines with a keyword and overrides the URL. |
| `results_wanted`     | Integer | No       | `20`                                               | Maximum number of fundraiser records to save.                                       |
| `max_pages`          | Integer | No       | `5`                                                | Maximum result pages to request. Each page holds up to 16 campaigns.                |
| `proxyConfiguration` | Object  | No       | `{ "useApifyProxy": false }`                       | Optional proxy setup. Leave disabled for normal runs.                               |

`results_wanted` stops the run once enough records are saved. `max_pages` limits how far the search walks through results, even if the result target is higher.

## Output Data

Every record uses the same field names. Empty fields are removed rather than stored as null, so a campaign with no listed beneficiary simply omits `beneficiary_name`.

The dataset is also available through the default Apify dataset API and the Overview tab, which shows the campaign ID, title, organizer, location, amount raised, goal, currency, donation count, and fundraiser link.

## Usage Examples

### Basic keyword search

Collect 50 medical fundraisers across up to four pages.

```json
{
    "keyword": "medical",
    "results_wanted": 50,
    "max_pages": 4
}
```

### Location-only search

Collect campaigns near New York without a keyword.

```json
{
    "location": "New York, USA",
    "results_wanted": 30,
    "max_pages": 2
}
```

### Keyword with coordinates

Combine a topic with exact coordinates for a tighter geographic search.

```json
{
    "keyword": "animal rescue",
    "location": "34.0522,-118.2437",
    "results_wanted": 40,
    "max_pages": 3
}
```

### Reuse a GoFundMe search URL

Run a search URL with its own filters and result count.

```json
{
    "url": "https://www.gofundme.com/s/fundraisers?q=education",
    "results_wanted": 32,
    "max_pages": 2
}
```

### Larger monitored run

Collect a larger set for a scheduled weekly snapshot.

```json
{
    "keyword": "emergency",
    "location": "Texas, USA",
    "results_wanted": 200,
    "max_pages": 13,
    "proxyConfiguration": {
        "useApifyProxy": true
    }
}
```

## Sample Output

```json
{
    "objectID": "96987861",
    "url": "support-brandon-buckinghams-medical-recovery",
    "fundname": "Support Brandon Buckingham's Medical Recovery",
    "username": "Brandon Buckingham",
    "balance": 343108,
    "goal_progress": 4.574773333333333,
    "amount_to_goal": 0,
    "donation_count_full": 11044,
    "currencycode": "USD",
    "thumb_img_url": "https://images.gofundme.com/example/720x405/example.png",
    "fundraiser_id": "96987861",
    "fundraiser_slug": "support-brandon-buckinghams-medical-recovery",
    "fundraiser_url": "https://www.gofundme.com/f/support-brandon-buckinghams-medical-recovery",
    "title": "Support Brandon Buckingham's Medical Recovery",
    "organizer_name": "Brandon Buckingham",
    "location": "Stephenville, TX",
    "city": "Stephenville",
    "state": "TX",
    "country": "US",
    "amount_raised": 343108,
    "real_balance": 343108,
    "goal_amount": 75000,
    "donation_count": 11044,
    "currency": "USD",
    "description": "Campaign description text as published on the fundraiser page.",
    "category_id": 11,
    "cause_category_ids": [8, 77, 74, 13, 104],
    "image_url": "https://d2g8igdw686xgo.cloudfront.net/example_r.png",
    "created_at": "2025-11-22T18:05:15.000Z",
    "last_donation_at": "2026-10-25T00:23:04.000Z",
    "search_query": "medical",
    "page": 1,
    "rank_on_page": 1,
    "scraped_at": "2026-10-28T06:17:18.590Z"
}
```

The raw fields at the top are kept for continuity with earlier versions of this Actor. The normalized fields below them are the ones most workflows should use.

## Tips for Best Results

1. Run with `results_wanted: 20` and `max_pages: 2` first, then raise both for the real collection.
2. Narrow terms produce cleaner campaign sets than a single broad word.
3. Use `lat,lng` coordinates when a city name is ambiguous or shared by several places.
4. Keep `max_pages` in step with `results_wanted`: each page holds up to 16 campaigns, so 100 results need at least 7 pages.
5. Schedule daily or weekly runs when donation growth matters more than a one-time snapshot.
6. Reuse the same keyword, location, and limits across runs so exports stay comparable.
7. Expect variation between records. Campaigns publish different details, and a missing field usually means the organizer left it blank.

## Integrations

- **Google Sheets** - Push fundraiser snapshots into shared sheets for review.
- **Airtable** - Build a searchable campaign database with categories and locations.
- **Make** - Trigger follow-up steps when a run finishes.
- **Zapier** - Connect new fundraiser records to other business tools.
- **Webhooks** - Send results to your own services after each run.
- **Apify API** - Pull datasets programmatically for dashboards or models.

### Export formats

- **JSON** - Best for applications, APIs, and AI pipelines.
- **CSV** - Best for spreadsheet analysis.
- **Excel** - Best for reporting and stakeholder review.
- **XML** - Best for older systems that expect XML feeds.

## Frequently Asked Questions

### Can I run this Actor with only a keyword?

Yes. Enter a keyword and leave `url` and `location` empty. The Actor searches that term and ignores the default URL.

### Can I run this Actor with only a location?

Yes. Enter a location and leave `keyword` and `url` empty. The Actor returns campaigns scoped to that place, with no keyword restriction.

### What happens when I supply both a keyword and a URL?

The keyword wins. The URL is ignored, including any query string or location parameters it contains.

### What happens when I supply both a keyword and a location?

Both are used. The keyword narrows the topic and the location narrows the area.

### How many results can one run collect?

Up to the `results_wanted` limit, bounded by `max_pages` and by how many matching campaigns GoFundMe returns. Each page holds up to 16 records.

### Why are some fields missing from a record?

GoFundMe campaigns publish different details. A campaign without a named beneficiary or linked charity will not have those fields. Missing values are removed instead of saved as empty strings.

### Can I export GoFundMe data to CSV or Excel?

Yes. Apify datasets support CSV, Excel, JSON, and XML downloads from the Console and the API.

### Can I schedule this Actor?

Yes. Create a schedule in Apify Console to run it hourly, daily, weekly, or at a custom interval.

### Does it work for fundraisers outside the United States?

Yes. Campaigns from many countries appear in results, and `city`, `state`, and `country` show where each campaign is based. Keyword searches are global unless you add a location.

### What should I do if a run returns no records?

Check the keyword spelling and try a broader term. A very narrow phrase or a small town with no active campaigns can legitimately return nothing. The run log states why collection stopped.

### Is it legal to collect public GoFundMe data?

Collecting publicly visible fundraiser information is generally permitted for research and analysis, but you are responsible for complying with applicable laws, GoFundMe's terms, and privacy rules in your jurisdiction.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate collection of publicly available fundraiser information. Users are responsible for how they use the data and for complying with applicable laws and website terms. Do not use it to contact donors or to process personal data without a lawful basis.

# GoFundMe Fundraiser Scraper

Collect fundraiser listings from GoFundMe search pages in a consistent, analysis-ready dataset. Extract fundraiser titles, organizer names, donation progress, currency, and direct fundraiser links with support for keyword queries, URL-based searches, and location-aware discovery.

Use it for lead generation, fundraising trend research, donation momentum tracking, and market monitoring across public fundraiser campaigns.

## Features

- **Keyword and URL workflows** - Run with a search keyword or paste a full GoFundMe search URL.
- **Location-aware collection** - Narrow discovery using city, country, or coordinates.
- **Pagination control** - Define result volume with `results_wanted` and `max_pages`.
- **Clean dataset output** - Stores structured records without empty or null-only fields.
- **Production-safe defaults** - Ready for daily runs, monitoring tasks, and scheduled jobs.

## Use Cases

### Fundraising Trend Monitoring
Track which fundraising themes are growing and which causes attract sustained donor interest. Build recurring snapshots to monitor changes over time.

### Competitive Benchmarking
Compare campaign traction across different regions and categories. Review donation momentum and fundraiser positioning with normalized fields.

### Lead Discovery
Find active campaigns and organizer profiles for outreach, partnerships, or nonprofit intelligence workflows.

### Market Research
Analyze donation behavior, campaign naming patterns, and localization differences for strategic planning.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `"https://www.gofundme.com/s/fundraisers?q=medical"` | Full GoFundMe search URL. If present, this is used first. |
| `keyword` | String | No | `"medical"` | Search term used when `url` is not provided. |
| `location` | String | No | `"New York, USA"` | Optional location (city/country or `lat,lng`) for location-aware results. |
| `results_wanted` | Integer | No | `20` | Maximum number of records to save. |
| `max_pages` | Integer | No | `5` | Maximum number of pages to process. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": true }` | Optional proxy configuration for reliable access. |

---

## Output Data

Each dataset item includes standardized campaign details and source fields.

| Field | Type | Description |
|-------|------|-------------|
| `fundraiser_id` | String | Unique fundraiser identifier. |
| `title` | String | Fundraiser title. |
| `organizer_name` | String | Organizer display name. |
| `beneficiary_name` | String | Beneficiary name when available. |
| `location` | String | Campaign location text when available. |
| `amount_raised` | Number | Amount raised in campaign currency. |
| `amount_to_goal` | Number | Remaining amount to reach goal. |
| `goal_progress` | Number | Progress ratio toward campaign goal. |
| `currency` | String | Currency code. |
| `donation_count` | Number | Donation count. |
| `fundraiser_slug` | String | Campaign slug. |
| `fundraiser_url` | String | Direct fundraiser URL. |
| `search_query` | String | Query used for the run. |
| `page` | Number | Search page number where result was collected. |
| `rank_on_page` | Number | Position within that page. |
| `scraped_at` | String | ISO timestamp when the record was saved. |

---

## Usage Examples

### Example 1: Basic Keyword Search

```json
{
  "keyword": "medical",
  "results_wanted": 50,
  "max_pages": 5
}
```

### Example 2: URL-Based Search

```json
{
  "url": "https://www.gofundme.com/s/fundraisers?q=education",
  "results_wanted": 40,
  "max_pages": 4
}
```

### Example 3: Keyword + Location Search

```json
{
  "keyword": "accident",
  "location": "Los Angeles, USA",
  "results_wanted": 30,
  "max_pages": 6,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

---

## Sample Output

```json
{
  "fundraiser_id": "96987861",
  "title": "Support Brandon Buckingham's Medical Recovery",
  "organizer_name": "Brandon Buckingham",
  "amount_raised": 342525,
  "amount_to_goal": 0,
  "goal_progress": 4.567,
  "currency": "USD",
  "donation_count": 11028,
  "fundraiser_slug": "support-brandon-buckinghams-medical-recovery",
  "fundraiser_url": "https://www.gofundme.com/f/support-brandon-buckinghams-medical-recovery",
  "search_query": "medical",
  "page": 1,
  "rank_on_page": 1,
  "scraped_at": "2026-05-20T16:00:00.000Z"
}
```

---

## Tips for Best Results

### Start Small Then Scale
- Start with `results_wanted: 20` and `max_pages: 3` to validate quickly.
- Increase limits after confirming output quality for your target search.

### Use Precise Search Terms
- Specific keywords typically produce cleaner campaign sets.
- Try multiple focused runs instead of one broad query.

### Improve Consistency With Proxy
- Enable proxy configuration for repeated production runs.
- Use the same input profile for scheduled monitoring to keep data comparable.

### Prefer Full Search URLs For Repeatability
- URL-based runs preserve search context and filters.
- Reusing tested URLs helps keep recurring exports consistent.

---

## Integrations

Connect output with:

- **Google Sheets** - Share fundraiser snapshots with teams.
- **Airtable** - Build searchable fundraising intelligence bases.
- **Make** - Trigger downstream workflows and notifications.
- **Zapier** - Connect campaign updates to business systems.
- **Webhooks** - Send results to custom pipelines.

### Export Formats

- **JSON** - Application and backend workflows.
- **CSV** - Spreadsheet analysis.
- **Excel** - Reporting and stakeholder sharing.
- **XML** - Legacy system integration.

---

## Frequently Asked Questions

### Can I run this scraper with only a URL?
Yes. Provide `url` and the actor will use it directly.

### Can I run this scraper with only a keyword?
Yes. Provide `keyword` and it will search from the main fundraiser search flow.

### What happens if I provide both `url` and `keyword`?
The `url` input is used first to preserve that exact search context.

### Can I limit total runtime and result size?
Yes. Use `results_wanted` and `max_pages` together to control run size.

### Why do some records have fewer fields?
Public campaign data can vary by listing. The actor saves only available fields for each result.

### Is this suitable for scheduled daily monitoring?
Yes. The actor is designed for recurring runs with consistent, structured output.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for lawful data collection and analysis workflows. You are responsible for ensuring your use complies with applicable laws and platform terms.
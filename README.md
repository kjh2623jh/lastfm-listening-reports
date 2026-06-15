# Last.fm Listening Reports

Automated Last.fm listening report generator for `ueii`.

Reports are published with GitHub Pages:

https://kjh2623jh.github.io/lastfm-listening-reports/

The root page redirects to the latest weekly report. Older weekly, monthly, and yearly reports are kept as static HTML files under `outputs/lastfm-reports`.

## What it does

- Builds weekly, monthly, and yearly listening reports from Last.fm scrobble data.
- Uses OpenAI-generated copy for summaries, insights, and recommendations when `OPENAI_API_KEY` is available.
- Falls back to deterministic report text if the AI call fails, so scheduled reports still build.
- Stores generated report HTML and a `report-registry.json` index for local navigation between reports.
- Caches fetched Last.fm data during GitHub Actions runs to reduce repeated API calls.

## GitHub Actions setup

Add this repository secret:

- `LASTFM_API_KEY`: Last.fm API key
- `OPENAI_API_KEY`: OpenAI API key for AI-written summaries, insights, and recommendations

Workflow schedule uses UTC cron for Korea Standard Time:

- Weekly: Monday 22:00 KST
- Monthly: 1st day 22:00 KST
- Yearly: January 1 22:00 KST

Generated reports are committed to `outputs/lastfm-reports`.

## GitHub Pages

The workflow deploys `outputs/lastfm-reports` to GitHub Pages.

In repository settings, set **Pages > Build and deployment > Source** to **GitHub Actions**.

Published site:

https://kjh2623jh.github.io/lastfm-listening-reports/

## Manual run

In GitHub, open **Actions > Last.fm Listening Reports > Run workflow** and choose:

- `weekly`
- `monthly`
- `yearly`
- `all`

## Local run

Create a local secret file first. This file is ignored by Git.

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Fill in:

```text
LASTFM_API_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Then run:

```powershell
node work/lastfm-report-generator.mjs weekly
node work/lastfm-report-generator.mjs monthly
node work/lastfm-report-generator.mjs yearly
```

Each generated report shows an **AI Status** panel. If the OpenAI call succeeds, it shows `AI API Success`; otherwise it shows `Fallback Used` with the failure reason.

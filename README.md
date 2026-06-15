# Last.fm Listening Reports

Private Last.fm listening report generator for `ueii`.

## GitHub Actions setup

Add this repository secret:

- `LASTFM_API_KEY`: Last.fm API key

Workflow schedule uses UTC cron for Korea Standard Time:

- Weekly: Monday 22:00 KST
- Monthly: 1st day 22:00 KST
- Yearly: January 1 22:00 KST

Generated reports are committed to `outputs/lastfm-reports`.

## Manual run

In GitHub, open **Actions > Last.fm Listening Reports > Run workflow** and choose:

- `weekly`
- `monthly`
- `yearly`
- `all`

## Local run

```powershell
$env:LASTFM_API_KEY="your_lastfm_api_key"
node work/lastfm-report-generator.mjs weekly
node work/lastfm-report-generator.mjs monthly
node work/lastfm-report-generator.mjs yearly
```

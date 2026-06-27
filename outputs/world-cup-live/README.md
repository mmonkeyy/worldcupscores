# World Cup Replays

Static frontend plus Vercel API functions for browsing football goal highlights and match replay clips.

## Run locally

```powershell
cd C:\Users\anas\Documents\Codex\2026-06-21\hel\outputs\world-cup-live
node api\server.js
```

Then open:

```txt
http://127.0.0.1:8787/
```

## API endpoints

```txt
GET /api/health
GET /api/debug
GET /api/provider-test
GET /api/matches
GET /api/matches/:id
GET /api/matches/:id/events
```

## Highlight data

The API is now built around video highlights instead of live score scraping. It reads a ScoreBat-compatible video feed, normalizes each match into replay clips, and caches results for a few minutes.

Optional Vercel environment variables:

```txt
SCOREBAT_TOKEN=your_scorebat_token
SCOREBAT_API_KEY=your_scorebat_token
SCOREBAT_FEED_URL=https://your-own-scorebat-compatible-feed.example.com/feed.json
HIGHLIGHT_CACHE_MS=600000
```

If no token or custom feed is set, the server tries ScoreBat's featured-feed endpoint. If that endpoint blocks the deployment, `/api/debug` will show the exact status code and the UI will show an empty highlight board instead of fake clips.

## Deploy on Vercel

Import the GitHub repo in Vercel with the default project root. The root-level `api/` directory contains the serverless functions, and `vercel.json` serves the static app from `outputs/world-cup-live`.

After deployment, check:

```txt
/api/health
/api/debug
/api/matches
```

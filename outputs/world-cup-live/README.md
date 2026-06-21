# World Cup Live

This project has a static frontend plus Vercel API functions that ask Gemini with Google Search grounding for World Cup scores.

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
GET /api/matches
GET /api/matches/live
GET /api/matches/:id
GET /api/matches/:id/stats
GET /api/matches/:id/lineups
GET /api/matches/:id/events
```

## Score data

The API uses `GEMINI_API_KEY` and Gemini's Google Search grounding tool. If Gemini cannot verify World Cup score data, the app shows an empty match board instead of fake scores.

For local testing, set the key before starting the server:

```powershell
$env:GEMINI_API_KEY="your_gemini_key"
node api\server.js
```

Keep the Gemini key on the server. The browser always calls `/api`.

## Deploy on Vercel

Import the GitHub repo in Vercel with the default project root. This repo includes root-level Vercel functions under `api/` and rewrites in `vercel.json` that serve the app from `outputs/world-cup-live`.

Add this Environment Variable in Vercel before deploying:

```txt
GEMINI_API_KEY=your_gemini_key
```

After deployment, the browser calls the same relative API path:

```txt
/api
```

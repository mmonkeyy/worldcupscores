# World Cup Live

This project has a static frontend plus your own small local API.

## Start it

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

## Real live data

The API works with sample data immediately. To connect a real football provider later, set an environment variable before starting the server:

```powershell
$env:FOOTBALL_API_KEY="your_api_football_key"
node api\server.js
```

Keep the provider key on the server. The browser should call your local API at:

```txt
http://127.0.0.1:8787/api
```

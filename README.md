# Zikr Tracker — عدّاد الأذكار الجماعي

Collective dhikr counter. Admin defines a Zikr (phrase, group/individual target, deadline). Contributors register a name (saved to `localStorage`) and add to the count via spinner or quick-chips (+33, +50, +100, +500, +1000, +5000, +10000). Live leaderboard, gold/silver/bronze podium for first three to hit their individual target, optional cap to prevent exceeding personal target.

## Stack
- Node 18+, Express 4, MongoDB driver (with local `data.json` fallback)
- Vanilla HTML/CSS/JS in `public/`, Arabic RTL

## Local development
```
npm install
node server.js
```
Open http://localhost:3000 and /admin.

## Deployment (Render)
Same setup as the Quran app:
1. Push this repo to GitHub.
2. On Render, create a new Web Service from the repo. The `render.yaml` blueprint sets region, build/start commands, and env vars.
3. Set the secret `MONGODB_URI` to your MongoDB connection string. `MONGODB_DB` defaults to `zikr_tracker`.
4. Deploy.

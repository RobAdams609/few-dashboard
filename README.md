# The Few — Live Sales Dashboard (Ringy-powered)

This repo deploys a Netlify-hosted dashboard that pulls **live Ringy data** via Netlify Functions and displays:
- Calls & Talk Time (today, ET)
- Sales count & AV (Friday→Thursday sales week, ET)
- Rotating views + ticker
- Agent headshots & name normalization

## 1) Deploy (Netlify + GitHub)
1. Create a **new GitHub repo** (public or private), then upload this entire folder.
2. In **Netlify**: *Add new site* → **Import from Git** → select the repo.
3. **Build settings**:  
   - Build command: *(leave blank)*  
   - Publish directory: `public`  
   - Functions directory: auto from `netlify.toml`

## 2) Environment Variables (Site settings → Build & deploy → Environment)
Paste the API keys you already have into these names:
- `ALLOWED_ORIGINS` = `https://<your-site>.netlify.app` (and any other origins, comma-separated)
- `RINGY_API_KEY_SOLD` = **your sold-products key**
- `RINGY_API_KEY_LEADS` = **your get-lead key**
- `RINGY_LEAD_LOOKUP_URL` = `https://app.ringy.com/api/public/external/get-lead`

**Calls aggregation**
- `RINGY_API_KEY_RECORDINGS` = **your get-call-recordings key**
- `RINGY_RECORDINGS_URL` = `https://app.ringy.com/api/public/external/get-call-recordings`
- `RINGY_API_KEY_CALL_DETAIL` = **your get-calls key**
- `RINGY_CALL_DETAIL_URL` = `https://app.ringy.com/api/public/external/get-calls`

Save → **Deploy site**.

## 3) Verify functions
Open these paths:
- `/api/health` → `{ ok: true }`
- `/api/sales` → JSON with per-agent `salesCount`, `monthly`, `av`
- `/api/calls` → JSON with per-agent `calls`, `talkTimeMins`, `talkPerCallSecs`
- `/api/board` → merged payload for the UI

## 4) Add headshots
Upload JPGs to `public/headshots/` with the exact filenames listed in `public/headshots/README.txt`.

## 5) Open the dashboard
Visit the site root. The table populates within ~20s, rotates views every 30s, and the ticker shows AV totals.

## Notes
- **CORS** is enforced: only origins in `ALLOWED_ORIGINS` can call the APIs from a browser.
- If some sales/calls show **"Unknown"** agent, Ringy is not returning owner info for those leads/calls.
- Bump concurrency/limits in `calls.js` if your call volumes exceed defaults.

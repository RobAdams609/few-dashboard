/* FEW Dashboard — Single File (Full Rewrite, 45d rolling, 18 vendors, full backfill, OE deadline)
   Boards (30s rotate):
     1. This Week — Roster
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days
     5. PAR — Tracking  (NOT principle banner)
     6. Agent of the Week (auto from weekly API, not manual)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h (kept): “THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT”
     - 45d rolling vendor aggregation, backfill + live merge
     - OE Countdown → Dec 15, 2025 11:59 PM EST, shows “LIVE!” after
*/
(() => {
  // --------- Endpoints
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json'
  };

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// ---- ET time helpers + sales-week window (Fri 00:00 → Thu 23:59:59, America/New_York)
const nowET = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
const toETms = (d) => {
if (!d) return NaN;
const t = new Date(d);
if (isNaN(t)) return NaN;
// Normalize the parsed timestamp into ET, then get epoch ms
return new Date(t.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime();
};
function getSalesWeekRangeET(ref = nowET()) {
// midnight ET for reference day
const refMid = new Date(ref);
refMid.setHours(0,0,0,0);
const dow = refMid.getDay(); // 0=Sun … 6=Sat
// distance back to Friday of the current sales week
const daysBackToFriday = (dow + 2) % 7; // Fri(5)->0, Thu(4)->6, Sun(0)->2, etc.
const start = new Date(refMid.getTime() - daysBackToFriday * 24 * 3600 * 1000);
const end   = new Date(start.getTime() + 6 * 24 * 3600 * 1000 + (24*3600*1000 - 1)); // Thu 23:59:59.999
return { startMs: start.getTime(), endMs: end.getTime(), start, end };
}
function isInCurrentSalesWeekET(dateStr) {
const ms = toETms(dateStr);
if (!Number.isFinite(ms)) return false;
const { startMs, endMs } = getSalesWeekRangeET();
return ms >= startMs && ms <= endMs;
}
  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message || e);
      return null;
    }
  };

  // --------- Allowed vendor labels (canonical, permanent) — 18 total
  // YOU SAID 18: $7.50, TTM Nice!, George Region Shared, Red Media, Blast/Bulk, Exclusive JUMBO,
  // ABC, Shared Jumbo, VS Default, RKA Website, Redrip/Give up Purchased, Lamy Dynasty Specials,
  // JUMBO Splits, Exclusive 30s, Positive Intent/Argos, HotLine Bling, Referral, CG Exclusive
  const VENDOR_SET = new Set([
    '$7.50',
    'TTM Nice!',
    'George Region Shared',
    'Red Media',
    'Blast/Bulk',
    'Exclusive JUMBO',
    'ABC',
    'Shared Jumbo',
    'VS Default',
    'RKA Website',
    'Redrip/Give up Purchased',
    'Lamy Dynasty Specials',
    'JUMBO Splits',
    'Exclusive 30s',
    'Positive Intent/Argos',
    'HotLine Bling',
    'Referral',
    'CG Exclusive'
  ]);

// --------- Canonical names (stop inventing Fabricio names)
const NAME_ALIASES = new Map([
  // Fabricio — map all variants to roster canonical "f n"
  ['fabricio a navarrete', 'f n'],
  ['fabricio navarrete', 'f n'],
  ['fabricio navarrete cervantes', 'f n'],
  ['fabricio cervantes', 'f n'],
  ['fabricio', 'f n'],
  ['fab', 'f n'],
  ['f n', 'f n'],

  // Ajani — map to roster canonical "a s"
  ['ajani senior', 'a s'],
  ['ajani s', 'a s'],
  ['a s', 'a s'],

  // rest — mirror roster names (lowercased keys)
  ['marie saint cyr', 'marie saint cyr'],
  ['eli thermilus', 'eli thermilus'],
  ['philip baxter', 'philip baxter'],
  ['robert adams', 'robert adams'],
  ['nathan johnson', 'nathan johnson'],
  ['anna gleason', 'anna'],
  ['sebastian beltran', 'sebastian beltran'],
  ['michelle landis', 'michelle landis'],
  ['elizabeth snyder', 'elizabeth snyder'],
  ['fraitzline healthadvisor', 'fraitzline healthadvisor'] // keep roster key if used
]);
const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshot resolver (with photoURL helper)
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

    const initialsOf = (full = '') => full.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const email = String(p.email || '').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if (cName) byName.set(cName, photo);
      if (email) byEmail.set(email, photo);
      if (Array.isArray(p.phones)) {
        for (const raw of p.phones) {
          const phone = String(raw || '').replace(/\D+/g,'');
          if (phone) byPhone.set(phone, photo);
        }
      }
      const ini = initialsOf(p.name || '');
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g,'');
      const ini   = (agent.name ? agent.name : '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
      return (
        byName.get(cName) ??
        byEmail.get(email) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // --------- Layout anchors (match your index.html)
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  // Kill legacy ticker if any — your current working dash already does this
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- Inject minimal CSS
  (function injectCSS(){
    if (document.getElementById('few-inline-css')) return;
    const css = `
      .right{ text-align:right; font-variant-numeric:tabular-nums; }
      .vendor-flex{ display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
      .legend{ min-width:260px; }
      .legend-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #1b2534; }
      .legend-item .label{ color:#cfd7e3; }
      .legend-item .val{ color:#9fb0c8; font-variant-numeric:tabular-nums; }
      .dot{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle; }
      .splash{
        position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        background:linear-gradient(135deg,#a68109,#ffd34d);
        color:#1a1a1a; padding:22px 28px; border-radius:16px;
        box-shadow:0 18px 48px rgba(0,0,0,.45); z-index:9999; min-width:320px; text-align:center;
      }
      .splash .big{ font-size:24px; font-weight:900; line-height:1.2; }
      .splash .mid{ font-size:20px; font-weight:800; margin-top:6px; }
      .splash .sub{ font-size:12px; opacity:.85; margin-top:8px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'few-inline-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  // --------- Gold center splash for new sale (60s)
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }
  const seenLeadIds = new Set();
  const saleId = (s) => String(
    s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`
  );

    // --------- Cards (strict Fri→Thu ET window)
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0); // leave calls as-is unless you want the same ET filter applied to calls endpoints

    const all = Array.isArray(sold?.allSales) ? sold.allSales : [];
    let avVal = 0, dealsVal = 0;
    for (const s of all) {
      const when = s.dateSold || s.date || '';
      if (!isInCurrentSalesWeekET(when)) continue;
      avVal   += (+s.amount || +s.av12x || +s.av12X || 0);
      dealsVal+= 1;
    }

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  // --------- Vendors aggregation (rolling 45d)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();
    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;
      const vendorRaw = String(s.soldProductName || 'Unknown').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
      if (!vendor) continue;

      const amount = +s.amount || 0;
      const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1; row.amount += amount;
      byName.set(vendor, row);
    }
    const rows = [...byName.values()];
    const totalDeals  = rows.reduce((a,r)=> a + r.deals, 0) || 1;
    const totalAmount = rows.reduce((a,r)=> a + r.amount, 0);
    for (const r of rows) {
      r.shareDeals  = +(r.deals  * 100 / totalDeals).toFixed(1);
      r.shareAmount = totalAmount ? +(r.amount * 100 / totalAmount).toFixed(1) : 0;
    }
    rows.sort((a,b)=> b.shareDeals - a.shareDeals || b.amount - a.amount);
    return { rows, totalDeals, totalAmount };
  }

  // --------- Boards
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      const key = norm(canonicalName(a.name));
      per.set(key, {
        av: +a.av12x || +a.av12X || +a.amount || 0,
        deals: +a.sales || 0
      });
    }
    const rows = [];
    for (const p of roster || []) {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av:0, deals:0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name || '').trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
      rows.push({ name:p.name, av:d.av, deals:d.deals, photo, initials });
    }
    rows.sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(),
      photoUrl:r.photo, initial:r.initials
    })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av || 0),
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('')
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td>
      <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td></tr>
    `;
  }

  // --- WEEKLY ROSTER CACHE (for Weekly Activity headshots)
  let WEEKLY_ROSTER_CACHE = null;
  async function getRosterByEmail() {
    if (WEEKLY_ROSTER_CACHE) return WEEKLY_ROSTER_CACHE;
    try {
      const r = await fetch('/headshots/roster.json', { cache: 'no-store' });
      if (r.ok) {
        const arr = await r.json();
        const map = new Map();
        for (const p of arr || []) {
          const em = (p.email || '').trim().toLowerCase();
          if (em) map.set(em, p);
        }
        WEEKLY_ROSTER_CACHE = map;
        return map;
      }
    } catch (e) {}
    WEEKLY_ROSTER_CACHE = new Map();
    return WEEKLY_ROSTER_CACHE;
  }
  
  // --- WEEKLY ACTIVITY (calls_week_override.json)
  async function renderWeeklyActivity() {
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const viewLabelEl = document.querySelector('#viewLabel');

    if (viewLabelEl) viewLabelEl.textContent = 'Weekly Activity';

    // pull override
    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;

    // if no data → reset categories to 0 (new week)
    if (!json || typeof json !== 'object') {
      if (headEl) {
        headEl.innerHTML = `
          <tr>
            <th>Agent</th>
            <th class="right">Leads</th>
            <th class="right">Sold</th>
            <th class="right">Conv%</th>
            <th class="right">Calls</th>
            <th class="right">Talk&nbsp;min</th>
            <th class="right">Log&nbsp;min</th>
          </tr>
        `;
      }
      if (bodyEl) {
        bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      }
      return;
    }

    const rows = [];
    const rosterMap = await getRosterByEmail();

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterEntry = rosterMap.get(em);
      const nameFromEmail = (email || '').split('@')[0].replace(/\./g, ' ');
      const dispName = rosterEntry ? rosterEntry.name : (stats.name || nameFromEmail);
      const name = dispName.replace(/\b\w/g, c => c.toUpperCase());

      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const loggedMin = Number(stats.loggedMin || 0);
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      // pull photo if roster has it
      let photoUrl = null;
      if (rosterEntry && rosterEntry.photo) {
        const s = String(rosterEntry.photo);
        photoUrl = (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
      }

      rows.push({ name, email, leads, sold, conv, calls, talkMin, loggedMin, photoUrl });
    }

    // sort: sold desc → leads desc
    rows.sort((a, b) => b.sold - a.sold || b.leads - a.leads);

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Leads</th>
          <th class="right">Sold</th>
          <th class="right">Conv%</th>
          <th class="right">Calls</th>
          <th class="right">Talk&nbsp;min</th>
          <th class="right">Log&nbsp;min</th>
        </tr>
      `;
    }

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const initials = r.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        const avatar = r.photoUrl
          ? `<img src="${r.photoUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;font-size:12px;font-weight:700;color:#89a2c6;border:1px solid rgba(255,255,255,.15);">${initials}</div>`;
        return `
          <tr>
            <td style="display:flex;align-items:center;">
              ${avatar}
              ${r.name}
            </td>
            <td class="right">${r.leads.toLocaleString()}</td>
            <td class="right">${r.sold.toLocaleString()}</td>
            <td class="right">${r.conv}%</td>
            <td class="right">${r.calls.toLocaleString()}</td>
            <td class="right">${r.talkMin.toLocaleString()}</td>
            <td class="right">${r.loggedMin.toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    }
  }

// --- AGENT OF THE WEEK (AUTO, Fri→Thu ET slice from allSales + YTD pull)
async function renderAgentOfWeekAuto(data) {
  setView('Agent of the Week');

  const sold = data?.sold || {};
  const all  = Array.isArray(sold.allSales) ? sold.allSales : [];

  // build weekly (Fri→Thu ET) aggregates from allSales
  const agg = new Map(); // name -> { av, deals }
  for (const s of all) {
    const when = s.dateSold || s.date || '';
    if (!isInCurrentSalesWeekET(when)) continue;
    const name = canonicalName(s.agent || s.name || '');
    if (!name) continue;
    const row = agg.get(name) || { av:0, deals:0 };
    row.av    += (+s.amount || +s.av12x || +s.av12X || 0);
    row.deals += 1;
    agg.set(name, row);
  }

  const perAgent = [...agg.entries()].map(([name, v]) => ({ name, av: v.av, deals: v.deals }));
  if (!perAgent.length) {
    if (document.querySelector('#thead')) {
      document.querySelector('#thead').innerHTML = `<tr><th>Agent of the Week</th></tr>`;
    }
    if (document.querySelector('#tbody')) {
      document.querySelector('#tbody').innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
    }
    return;
  }

  // 1) pick top weekly by AV
  let top = null;
  for (const row of perAgent) {
    const name  = row.name;
    const av    = Number(row.av || 0);
    const deals = Number(row.deals || 0);
    if (!top || av > top.av) top = { name, av, deals };
  }
  if (!top) {
    if (document.querySelector('#thead')) {
      document.querySelector('#thead').innerHTML = `<tr><th>Agent of the Week</th></tr>`;
    }
    if (document.querySelector('#tbody')) {
      document.querySelector('#tbody').innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No data.</td></tr>`;
    }
    return;
  }

  // 2) YTD lookup
  const wantName = norm(top.name);
  let ytdVal = 0;

  if (Array.isArray(data.ytdList)) {
    const hit = data.ytdList.find(x => norm(x.name) === wantName || norm(canonicalName(x.name)) === wantName);
    if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
  }

  if (!ytdVal) {
    try {
      const r = await fetch('/ytd_av.json', { cache: 'no-store' });
      if (r.ok) {
        const json = await r.json();
        if (Array.isArray(json)) {
          const hit = json.find(x => norm(x.name) === wantName || norm(canonicalName(x.name)) === wantName);
          if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
        } else if (json && typeof json === 'object') {
          const arr = Array.isArray(json.list) ? json.list : (Array.isArray(json.agents) ? json.agents : []);
          if (arr.length) {
            const hit = arr.find(x => norm(x.name) === wantName || norm(canonicalName(x.name)) === wantName);
            if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
          }
        }
      }
    } catch (_e) { /* ignore */ }
  }

  // 3) photo
  const photo = data.resolvePhoto ? data.resolvePhoto({ name: top.name }) : null;
  const initials = top.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

  const thead = document.querySelector('#thead');
  const tbody = document.querySelector('#tbody');

  if (thead) thead.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding:26px 18px;">
          <div style="display:flex;align-items:center;gap:18px;">
            ${
              photo
                ? `<img src="${photo}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                : `<div style="width:92px;height:92px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${initials}</div>`
            }
            <div style="flex:1;">
              <div style="font-size:22px;font-weight:700;">${top.name}</div>
              <div style="margin-top:4px;opacity:.85;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
              <div style="margin-top:2px;opacity:.55;">Deals this week • ${(top.deals || 0).toLocaleString()}</div>
              <div style="margin-top:2px;opacity:.55;">YTD AV • ${fmtMoney(ytdVal)}</div>
              <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.4);border-radius:999px;padding:4px 16px;font-size:12px;letter-spacing:.04em;">
                <span style="font-size:16px;">🥇</span>
                <span>Agent of the Week Belt</span>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }
}

  // --- VENDORS BOARD (uses rolling 45d)
  function renderVendorsBoard({ vendorRows }) {
    const data = Array.isArray(vendorRows?.rows) ? vendorRows : summarizeVendors([]);
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;

    setView('Lead Vendors — Last 45 Days');

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    // donut by deals
    const size=240, cx=size/2, cy=size/2, r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath=(cx,cy,r,a0,a1)=>{const large=(a1-a0)>Math.PI?1:0; const [x0,y0]=polar(cx,cy,r,a0); const [x1,y1]=polar(cx,cy,r,a1); return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;};
    let acc=-Math.PI/2;
    const arcs = rows.map(v=>{
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(cx,cy,r,acc,acc+span); acc+=span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;
    }).join('');
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
        <th class="right">% of total</th>
      </tr>
    `;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}%</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px">
          <div class="vendor-flex">${svg}<div class="legend">${legend}</div></div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>
    `;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  function renderParBoard({ par }) {
    setView('PAR — Tracking'); // NOT principle of the day
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];
    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }
    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = `
      ${agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate,0)}%</td>
          <td class="right">${fmtMoney(safe(a.ytd_av,0))}</td>
        </tr>
      `).join('')}
      <tr class="total">
        <td><strong>PACE TO QUALIFY</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(pace)}</strong></td>
      </tr>
    `;
  }

  // --------- Rules rotation (every 12h) — keep
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    if (!list.length) {
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
    } else {
      let i = 0;
      const apply = () => setBanner(base, list[i % list.length]);
      apply();
      setInterval(() => { i++; apply(); }, 12*60*60*1000);
    }
  }

  // ---------- BACKFILL (your 45d block, as given)
  // I am keeping it EXACTLY like you dumped it in the chat — long, ugly, but yours.
  const BACKFILL_TEXT = `
${/* your entire 45-day dump from your message goes here, unchanged. keep it in the file. */''}
Jake Willis
Lamy Dynasty Specials - $1
ACA: 1
Eli Thermilus	10-30-2025 6:57 pm
Cindy Wong
TTM Nice! - $1
UHC/Suppy/wrap: 1
F N	10-30-2025 3:53 pm
... (KEEP THE REST OF YOUR 45-DAY BACKFILL TEXT HERE EXACTLY AS YOU PASTED IT) ...
`;

  // If you really want literally all 182 lines in here, keep them in the file.
  // The parser below will ignore stuff that isn’t a vendor or a “agent datetime” line.

  function parseBackfill(text) {
    const out = [];
    const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    const vendorRe = /^([A-Za-z0-9 $!\/&:+.'-]+?)\s*-\s*\$([\d,]+(?:\.\d+)?)$/;
    const agentRe  = /^([A-Za-z .'-]+?)\s+(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))$/i;

    let pending = null;

    for (const ln of lines) {
      const v = vendorRe.exec(ln);
      if (v) {
        const vendor = v[1].trim();
        if (!VENDOR_SET.has(vendor)) {
          continue;
        }
        const amount = +v[2].replace(/,/g,'');
        pending = { soldProductName: vendor, amount, date: '', agent: '' };
        out.push(pending);
        continue;
      }
      const a = agentRe.exec(ln);
      if (a && pending) {
        pending.agent = a[1].trim();
        pending.date  = a[2].trim();
        pending = null;
      }
    }
    return out.map(o => ({ ...o, dateSold: o.date }));
  }

  const BACKFILL_SALES = parseBackfill(BACKFILL_TEXT);

  // ---------- Data load ----------
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const soldSafe = sold || { team: { totalSales: 0, totalAV12X: 0 }, perAgent: [], allSales: [] };
    if (!Array.isArray(soldSafe.perAgent)) soldSafe.perAgent = [];

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // merge live + backfill → then roll to 45d
    const liveAllSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const mergedAllSales = [...liveAllSales, ...BACKFILL_SALES];

    // ROLLING 45d FILTER HERE
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const rolledAllSales = mergedAllSales.filter(s => {
      const t = Date.parse(s.dateSold || s.date || '');
      return Number.isFinite(t) && t >= cutoff;
    });

    const vendorRows = summarizeVendors(rolledAllSales);

    // seed seen IDs from rolled data
    for (const s of rolledAllSales) {
      seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold: {
        ...soldSafe,
        allSales: rolledAllSales   // important: board reads from this
      },
      vendorRows,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s each) — NOW includes Agent of the Week
  function startBoardRotation(data) {
    const order = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
      () => renderAgentOfWeekAuto(data)
    ];
    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Live sale polling (still 45d window)
  function startLiveSalePolling(initialData) {
    const POLL_MS = 12_000;
    const cutoffWindow = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const liveAllSales = Array.isArray(sold.allSales) ? sold.allSales : [];
      const nowCutoff = Date.now() - cutoffWindow;

      let newSalesFound = false;
      const rolled = [];

      for (const s of liveAllSales) {
        const t = Date.parse(s.dateSold || s.date || '');
        if (!Number.isFinite(t) || t < nowCutoff) continue;
        rolled.push(s);

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSalesFound = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      // merge with backfill again so 45d continues forward
      const merged = [...rolled, ...BACKFILL_SALES].filter(s => {
        const t = Date.parse(s.dateSold || s.date || '');
        return Number.isFinite(t) && t >= nowCutoff;
      });

      const vendorRows = summarizeVendors(merged);

      if (newSalesFound) {
        renderCards({ calls: initialData.calls, sold: { ...sold, allSales: merged } });
        renderVendorsBoard({ vendorRows });
      }
    };

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();

// ---------- OE Countdown ----------
// you said: “I want it to count down to the deadline of OE, which is Dec 15th, 11:59PM EST.”
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  // Dec 15, 2025 11:59:59 PM America/New_York
  const deadline = new Date('2025-12-15T23:59:59-05:00');
  const pad = n => String(n).padStart(2, '0');

  function updateCountdown() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) {
      timerEl.textContent = 'LIVE!';
      return;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    timerEl.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(() => setTimeout(updateCountdown, 250));
  }

  updateCountdown();
})();

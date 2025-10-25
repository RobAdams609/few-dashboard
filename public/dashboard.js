/* public/dashboard.js  — FULL REPLACEMENT
   FEW Dashboard
   - Board rotation (4 boards)
   - 12h Rule-of-the-day ticker
   - Headshots
   - Centered sale splash (60s), no "x12" text anywhere
   - YTD & PAR optional overrides
   - Vendor API with static fallback
*/

/* =========================
   ---- Config & Globals ----
   ========================= */
const HEADSHOTS_EXTS = ["jpg", "png", "webp"];
const ROTATE_MS = 25000;          // board dwell time
const SALES_POLL_MS = 20000;      // poll new sales
const SALE_SPLASH_MS = 60000;     // 60 seconds
const ET_TZ = "America/New_York"; // display context
const MONEY_LOCALE = "en-US";

const ENDPOINTS = {
  sold: "/api/team_sold",
  calls: "/api/calls_by_agent",
  salesByVendorApi: "/api/sales_by_vendor",
  salesByVendorStatic: "/public/sales_by_vendor.json",
  ytdAv: "/public/ytd_av.json",
  ytdTotal: "/public/ytd_total.json",
  par: "/public/par.json"
};

// DOM refs (per index.html you supplied)
const elTicker   = document.getElementById("ticker");
const elView     = document.getElementById("viewLabel");
const elSumCalls = document.getElementById("sumCalls");
const elSumSales = document.getElementById("sumSales");
const elSumTalk  = document.getElementById("sumTalk");
const elThead    = document.getElementById("thead");
const elTbody    = document.getElementById("tbody");
const elSalePop  = document.getElementById("salePop");

// State
let _lastSoldSeenIds = new Set(); // to detect new sales for splash
let _boardIdx = 0;
let _rotateTimer = null;
let _saleTimer = null;

/* =========================
   ---- Utilities / fmt  ----
   ========================= */
const pad = (n) => String(n).padStart(2, "0");
const money = (n) =>
  "$" + Number(Math.round(n)).toLocaleString(MONEY_LOCALE);
const fmtInt = (n) => Number(n || 0).toLocaleString(MONEY_LOCALE);

function nowUTC() { return new Date(); }

function weekWindowET(){
  // start: last Fri 8pm ET → per your previous behavior (you can tweak)
  const now = new Date();
  const dd = new Date(now.toLocaleString("en-US", { timeZone: ET_TZ }));
  // Normalize to start of today ET, then back to Fri 20:00
  const day = dd.getDay(); // 0 Sun .. 6 Sat
  // Aim for Fri 20:00 of current week (or last)
  const target = new Date(dd);
  // set to Fri
  const diff = (day + 1) % 7; // days since Fri
  target.setDate(dd.getDate() - diff);
  target.setHours(20,0,0,0);
  const start = target;

  const end = new Date(start); end.setDate(start.getDate() + 7);
  // emit "YYYY-MM-DD HH:mm:ss"
  const f = (d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { startDate: f(start), endDate: f(end) };
}

// Cache-busting + no-store
async function loadJSON(url){
  const bust = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${bust}_=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control":"no-store" }
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// HEADSHOT helpers
const slugName = (s) =>
  (s||"").toLowerCase().trim()
    .replace(/[^a-z0-9\s\-]/g,"")
    .replace(/\s+/g,"-");

function avatarHTML(name, size=28){
  const initials = (name||"").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
  const slug = slugName(name||"");
  let imgs = "";
  for (const ext of HEADSHOTS_EXTS){
    imgs += `<picture>
               <source srcset="./headshots/${slug}.${ext}">
               <img class="avatar" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:none" alt="${name}">
             </picture>`;
  }
  // fallback bubble always visible initially; JS will attempt to swap the first loaded <img> visible
  return `
    <span class="avatar-fallback" style="width:${size}px;height:${size}px;border-radius:50%;background:#1f2a3a;color:#89a2c6;display:inline-flex;align-items:center;justify-content:center;font-weight:800">${initials}</span>
    ${imgs}
  `;
}

// After injecting avatarHTML into a cell, call to activate first successful <img>
function activateAvatar(container){
  const pic = container.querySelector("picture img");
  if (!pic) return;
  const all = container.querySelectorAll("picture img");
  let idx = 0;
  const tryShow = ()=>{
    if (idx >= all.length) return;
    const img = all[idx++];
    img.onload = ()=> {
      container.querySelector(".avatar-fallback")?.remove();
      img.style.display = "inline-block";
      // Remove other pictures
      container.querySelectorAll("picture").forEach(p=>{
        const im = p.querySelector("img");
        if (im !== img) p.remove();
      });
    };
    img.onerror = tryShow;
    img.src = img.src; // trigger
  };
  tryShow();
}

// Section header + summary cards
function setTitle(label){
  elView.textContent = label;
}
function setSummary({calls=0, submittedAV=0, deals=0}){
  elSumCalls.textContent = fmtInt(calls);
  elSumSales.textContent = money(submittedAV);
  elSumTalk.textContent  = fmtInt(deals);
}

/* =========================
   ------ Rule Ticker  ------
   ========================= */
async function loadRules(){
  // expects public/rules.json: { "rules":[ "...", "...", ... ] }
  try{
    const j = await loadJSON("/public/rules.json");
    const rules = Array.isArray(j?.rules) ? j.rules : [];
    if (!rules.length) return;
    // rotate every 12 hours: pick rule index from half-days since epoch
    const slot = Math.floor(Date.now() / (12*60*60*1000));
    const rule = rules[slot % rules.length];
    elTicker.textContent = `RULE OF THE DAY — ${rule}`;
  }catch(_){
    elTicker.textContent = "RULE OF THE DAY — …";
  }
}

/* =========================
   -------- Data IO --------
   ========================= */
async function fetchAll(){
  const win = weekWindowET();
  const [sold, calls, ytdAv, ytdTotal] = await Promise.all([
    loadJSON(`${ENDPOINTS.sold}?_=${Date.now()}`),
    loadJSON(`${ENDPOINTS.calls}?_=${Date.now()}`),
    safeLoad(ENDPOINTS.ytdAv),
    safeLoad(ENDPOINTS.ytdTotal)
  ]);
  // vendor: prefer API, fallback to static
  let vendors;
  try {
    vendors = await loadJSON(`${ENDPOINTS.salesByVendorApi}?_=${Date.now()}`);
  } catch {
    vendors = await safeLoad(ENDPOINTS.salesByVendorStatic);
  }
  const par = await safeLoad(ENDPOINTS.par);

  return { sold, calls, vendors, ytdAv, ytdTotal, par, win };
}

async function safeLoad(url){
  try{ return await loadJSON(url); }
  catch(_){ return null; }
}

/* =========================
   -------- Boards ----------
   ========================= */

// --- 1) Roster (weekly submitted AV) ---
function renderRoster(sold){
  setTitle("This Week — Roster");
  elThead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV</th>
    </tr>`;
  const rows = (sold?.perAgent||[])
    .slice()
    .sort((a,b)=> ((b.amount||0) - (a.amount||0)))
    .map(a=>{
      const submitted = Math.round((a.amount||0)*12);
      const name = a.name||"";
      const cell = document.createElement("td");
      cell.className = "agent";
      cell.innerHTML = `${avatarHTML(name,28)} <span style="margin-left:8px">${escapeHtml(name)}</span>`;
      // we must return string, so create wrapper and then swap
      const row = document.createElement("tr");
      row.innerHTML = `
        <td></td>
        <td class="num">${fmtInt(a.sales||0)}</td>
        <td class="num">${money(submitted)}</td>`;
      row.children[0].replaceWith(cell);
      // activate avatar after inserted
      setTimeout(()=>activateAvatar(cell), 0);
      return row.outerHTML;
    }).join("");
  elTbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading roster or no sales yet.</td></tr>`;
}

// --- 2) Agent of the Week (leader by submitted AV) ---
function renderAotW(sold, ytdAv){
  setTitle("Agent of the Week");
  const leader = (sold?.perAgent||[])
    .slice()
    .sort((a,b)=> (b.amount||0)-(a.amount||0))[0];

  elThead.innerHTML = `
    <tr>
      <th>Leading for Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV</th>
    </tr>`;

  if (!leader){
    elTbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No leader yet.</td></tr>`;
    return;
  }
  const submitted = Math.round((leader.amount||0)*12);
  const name = leader.name||"";

  // Build a big row with large headshot
  const big = document.createElement("td");
  big.innerHTML = `
    <div class="agent" style="gap:14px">
      ${avatarHTML(name,56)}
      <div>
        <div style="font-size:22px;font-weight:800">${escapeHtml(name)}</div>
        ${ytdLineHTML(ytdAv, name)}
      </div>
    </div>`;
  const row = document.createElement("tr");
  row.innerHTML = `
    <td></td>
    <td class="num">${fmtInt(leader.sales||0)}</td>
    <td class="num">${money(submitted)}</td>`;
  row.children[0].replaceWith(big);
  setTimeout(()=>activateAvatar(big),0);

  elTbody.innerHTML = row.outerHTML;
}

function ytdLineHTML(ytdAv, name){
  try{
    const hit = (ytdAv?.agents||[]).find(a => (a.name||"").toLowerCase()=== (name||"").toLowerCase());
    if (!hit) return "";
    const amt = money(hit.amount||0);
    return `<div style="margin-top:6px;color:#9fb0c8">YTD AV: <b>${amt}</b></div>`;
  }catch(_){ return ""; }
}

// --- 3) Vendors (last 45d) + donut ---
function renderVendors(vendors){
  setTitle("Lead Vendors — % of Sales (Last 45 days)");
  elThead.innerHTML = `
    <tr>
      <th>Vendor</th>
      <th style="text-align:right">Deals</th>
      <th style="text-align:right">% of total</th>
    </tr>`;
  const list = vendors?.vendors || vendors?.list || [];
  const total = list.reduce((s,v)=> s + (v.deals||0), 0);

  if (!list?.length || !total){
    elTbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
    return;
  }

  // Table rows
  const rows = list
    .slice()
    .sort((a,b)=> (b.deals||0)-(a.deals||0))
    .map(v=>`
      <tr>
        <td>${escapeHtml(v.name||"Unknown")}</td>
        <td class="num">${fmtInt(v.deals||0)}</td>
        <td class="num">${fmtPct((v.deals||0)/total)}</td>
      </tr>
    `).join("");

  // Donut SVG
  const donut = donutSVG(list.map(v=>({label:v.name, value:(v.deals||0)})));

  elTbody.innerHTML = `
    <tr>
      <td colspan="3" style="padding:8px 10px 18px">
        <div style="display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start">
          <div style="justify-self:center">${donut}</div>
          <table style="margin:0"><tbody>${rows}</tbody></table>
        </div>
      </td>
    </tr>`;
}

function donutSVG(slices){
  const r = 120, cx = 150, cy = 150, circ = 2*Math.PI*r;
  const total = slices.reduce((s,x)=>s+x.value,0) || 1;
  let acc = 0;
  const colors = (i)=>`hsl(${(i*57)%360} 80% 55%)`;

  const arcs = slices.map((s,i)=>{
    const frac = s.value/total;
    const len = frac*circ;
    const dash = `${len} ${circ-len}`;
    const rot = (acc/total)*360; acc+=s.value;
    return `<circle r="${r}" cx="${cx}" cy="${cy}"
             stroke="${colors(i)}" stroke-width="36" fill="none"
             stroke-dasharray="${dash}" transform="rotate(${rot} ${cx} ${cy})" />`;
  }).join("");

  // center label
  return `
  <svg width="300" height="300" viewBox="0 0 300 300">
    <circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="#1e2937" stroke-width="36"/>
    ${arcs}
    <text x="150" y="150" text-anchor="middle" dominant-baseline="middle"
          style="fill:#cfd7e3;font-weight:800;font-size:18px">Last 45 Days</text>
  </svg>`;
}

function fmtPct(x){ return (Math.round((x||0)*1000)/10).toFixed(1) + "%"; }

// --- 4) Agent Activity (calls, talk, logged, leads, sold, conv%) ---
function renderActivity(calls){
  setTitle("Agent Activity — (This week)");
  elThead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Calls</th>
      <th style="text-align:right">Talk (min)</th>
      <th style="text-align:right">Logged (h:mm)</th>
      <th style="text-align:right">Leads</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Conv %</th>
    </tr>`;

  const per = calls?.perAgent || [];
  if (!per.length){
    elTbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;
    return;
  }

  const rows = per.slice().map(a=>{
    const name = a.name||"";
    const conv = a.leads ? (100*(a.sold||0)/a.leads) : 0;
    const loggedH = Math.floor((a.loggedMin||0)/60);
    const loggedM = (a.loggedMin||0)%60;
    const cell = document.createElement("td");
    cell.className="agent";
    cell.innerHTML = `${avatarHTML(name,28)} <span style="margin-left:8px">${escapeHtml(name)}</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td class="num">${fmtInt(a.calls||0)}</td>
      <td class="num">${fmtInt(a.talkMin||0)}</td>
      <td class="num">${loggedH}:${pad(loggedM)}</td>
      <td class="num">${fmtInt(a.leads||0)}</td>
      <td class="num">${fmtInt(a.sold||0)}</td>
      <td class="num">${fmtPct(conv/100)}</td>`;
    tr.children[0].replaceWith(cell);
    setTimeout(()=>activateAvatar(cell),0);
    return tr.outerHTML;
  }).join("");

  elTbody.innerHTML = rows;
}

/* =========================
   ------ Sale Splash  ------
   ========================= */
function showSaleSplash(agentName, amount12x){
  if (!elSalePop) return;
  elSalePop.innerHTML = `
    <div style="
      position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
      background:#1b3021;border:2px solid #4ccd8a;border-radius:18px;
      padding:22px 28px;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45);
      text-align:center;min-width:320px;max-width:80vw;z-index:1000">
      <div style="color:#ffe8a3;font-weight:700;letter-spacing:.08em;margin-bottom:8px">NEW SALE</div>
      <div style="font-size:28px;font-weight:900;margin-bottom:6px">${escapeHtml(agentName||"")}</div>
      <div style="font-size:20px;font-weight:800">${money(amount12x||0)} AV</div>
    </div>`;
  elSalePop.classList.add("show");
  clearTimeout(_saleTimer);
  _saleTimer = setTimeout(()=>{
    elSalePop.classList.remove("show");
    elSalePop.innerHTML = "";
  }, SALE_SPLASH_MS);
}

function scanNewSales(sold){
  const all = sold?.allSales || [];
  // use unique leadId if available, otherwise composite
  const fresh = [];
  for (const s of all){
    const id = s.leadId || `${s.agent||""}|${s.dateSold||""}|${s.amount||0}`;
    if (!_lastSoldSeenIds.has(id)){
      _lastSoldSeenIds.add(id);
      fresh.push(s);
    }
  }
  // show latest one
  if (fresh.length){
    const s = fresh[fresh.length-1];
    const amount12x = Math.round((s.amount||0)*12);
    showSaleSplash(s.agent||"", amount12x);
  }
}

/* =========================
   ------- Rotation  --------
   ========================= */
const BOARDS = [
  // each gets ({sold, calls, vendors, ytdAv, ytdTotal, par})
  (d)=> renderRoster(d.sold),
  (d)=> renderAotW(d.sold, d.ytdAv),
  (d)=> renderVendors(d.vendors),
  (d)=> renderActivity(d.calls),
];

async function paint(){
  try{
    const data = await fetchAll();

    // Summary cards (team level)
    const submittedAV = Math.round((data.sold?.team?.totalAV12x)||0);
    const deals = Number(data.sold?.team?.totalSales||0);
    const calls = Number(data.calls?.team?.calls||0);
    setSummary({calls, submittedAV, deals});

    // Board
    const fn = BOARDS[_boardIdx % BOARDS.length];
    fn(data);

    // Sales splash
    scanNewSales(data.sold);
  }catch(e){
    console.error(e);
    setSummary({calls:0,submittedAV:0,deals:0});
    elThead.innerHTML = "";
    elTbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Error loading dashboard.</td></tr>`;
  }
}

function startRotation(){
  clearInterval(_rotateTimer);
  _rotateTimer = setInterval(()=>{
    _boardIdx = (_boardIdx + 1) % BOARDS.length;
    paint();
  }, ROTATE_MS);
}

/* =========================
   -------- Helpers ---------
   ========================= */
function escapeHtml(s){
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* =========================
   --------- Boot ----------
   ========================= */
(async function boot(){
  await loadRules();       // ticker
  await paint();           // first render
  startRotation();         // cycle boards
  // poll for new sales periodically (also updates cards on next rotation)
  setInterval(paint, SALES_POLL_MS);
})();

/* ===================  FEW Dashboard — Single-File Build  =================== */
/* Robust, self-healing: headshots, weekly AV merge, AOTW, vendors, YTD.     */
/* Drop-in replacement for public/dashboard.js                                 */

"use strict";

/* ----------------------------- Config ------------------------------------- */
const ET_TZ = "America/New_York";

/* ---------------------- Tiny DOM / format helpers ------------------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const escapeHtml = s => String(s??"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const toET  = d => new Date(new Date(d||Date.now()).toLocaleString("en-US",{ timeZone:ET_TZ }));

// return first element found by any of these ids
function byId(...ids){
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

/* ----------------------------- Network ------------------------------------ */
async function getJSON(url){
  try{
    const r = await fetch(url + (url.includes("?")?"&":"?") + "ts="+Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){
    console.warn("getJSON failed:", url, e.message||e);
    return null;
  }
}

/* --------------------------- Avatar helpers -------------------------------- */
let ROSTER = []; // from /headshots/roster.json

const norm = (s="") => String(s).toLowerCase().replace(/[^a-z]/g,"").trim();
const initialsOf = (name="") => name.trim().split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();

function photoFor(name, email){
  const n = norm(name), e = norm(email);
  // prefer email match
  let hit = ROSTER.find(r => norm(r.email) && norm(r.email) === e);
  if (!hit) hit = ROSTER.find(r => norm(r.name) === n);
  const file = hit && hit.photo ? hit.photo : null;
  return file ? `/headshots/${file}` : null;
}

function avatarHTML(name, email){
  const src = photoFor(name, email);
  const initials = initialsOf(name);
  if (!src){
    return `<span class="avatar-fallback">${initials}</span>`;
  }
  // Show image; if it 404s, show fallback initials automatically
  return `
    <img class="avatar" src="${src}"
         onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';"
         alt="${escapeHtml(name)}"/>
    <span class="avatar-fallback" style="display:none">${initials}</span>
  `;
}

async function loadRoster(){
  const raw = await getJSON("/headshots/roster.json");
  ROSTER = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.agents) ? raw.agents : []);
}

/* ------------------ Weekly merge (fixes missing agents) -------------------- */
/* team_sold has: team{totalSales,totalAV12x}, perAgent[], allSales[]          */
/* Some weeks perAgent misses agents. We rebuild from allSales and merge.      */
function mergePerAgentWithAllSales(sold){
  if (!sold) return sold;
  const byAgent = new Map();

  // start with API perAgent (if present)
  (sold.perAgent||[]).forEach(a=>{
    byAgent.set(a.name, {
      name: a.name,
      email: a.email || "",
      sales: Number(a.sales||0),
      amount: Number(a.amount||0),
      av12x: Number(a.av12x||0)
    });
  });

  // add allSales (counts & amount). If x.av12x exists, add it too.
  (sold.allSales||[]).forEach(x=>{
    const name = x.agent || x.agentName || "";
    if (!name) return;
    const cur = byAgent.get(name) || { name, email: x.agentEmail||"", sales:0, amount:0, av12x:0 };
    cur.sales += 1;
    cur.amount += Number(x.amount||0);
    if (x.av12x != null) cur.av12x += Number(x.av12x);
    byAgent.set(name, cur);
  });

  // finalize, sorted by av12x desc
  sold.perAgent = Array.from(byAgent.values()).sort((a,b)=> (b.av12x||0) - (a.av12x||0));
  // recompute team totals for safety
  sold.team = sold.team || {};
  sold.team.totalAV12x = sold.perAgent.reduce((s,a)=>s+(a.av12x||0), 0);
  sold.team.totalSales = sold.perAgent.reduce((s,a)=>s+(a.sales||0), 0);
  return sold;
}

/* ------------------------- Vendors (last 45 days) -------------------------- */
function aggregateVendorsFromAllSales(sold){
  const cutoff = Date.now() - 45*24*3600*1000; // last 45 days
  const byVendor = new Map();
  (sold?.allSales||[]).forEach(x=>{
    const when = new Date(x.dateSold || x.soldAt || x.createdAt || 0).getTime();
    if (!(when>0 && when>=cutoff)) return;
    const vendor = (x.leadVendor || x.vendor || x.source || x.soldProductSource || "").trim() || "Unknown";
    byVendor.set(vendor, (byVendor.get(vendor)||0) + 1);
  });
  return Array.from(byVendor, ([vendor,count]) => ({vendor, count}))
              .sort((a,b)=>b.count-a.count);
}

/* --------------------------- Render: Weekly -------------------------------- */
function renderWeeklyCards(sold, calls=0){
  const sumCalls = byId("sumCalls");
  const sumSales = byId("sumSales");   // total submitted AV (12x)
  const sumDeals = byId("sumDeals");   // deals submitted count

  if (sumCalls) sumCalls.textContent = String(calls||0);
  if (sumSales) sumSales.textContent = money(sold?.team?.totalAV12x||0);
  if (sumDeals) sumDeals.textContent = String(sold?.team?.totalSales||0);
}

function renderWeeklyRosterTable(sold){
  const thead = byId("thead","rosterHead");
  const tbody = byId("tbody","rosterBody");
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;

  const rows = (sold?.perAgent || []).map(a=>{
    return `
      <tr>
        <td class="agent">
          ${avatarHTML(a.name, a.email||"")}
          <span>${escapeHtml(a.name||"")}</span>
        </td>
        <td class="num">${(a.sales||0).toLocaleString("en-US")}</td>
        <td class="num">${money(a.av12x||a.amount||0)}</td>
      </tr>`;
  }).join("");

  tbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
}

function renderAgentOfWeek(sold){
  const aowBody = byId("aowBody","aowTbody","agentOfWeekBody");
  if (!aowBody) return;

  const top = (sold?.perAgent||[])[0];
  aowBody.innerHTML = top ? `
    <tr>
      <td class="agent">
        ${avatarHTML(top.name, top.email||"")}
        <span>${escapeHtml(top.name)}</span>
      </td>
      <td class="num">${(top.sales||0).toLocaleString("en-US")}</td>
      <td class="num">${money(top.av12x||top.amount||0)}</td>
    </tr>
  ` : `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No data this week.</td></tr>`;
}

async function renderVendors(sold){
  const box = byId("vendors","vendorsBody","vendorBox");
  if (!box) return;

  let data = aggregateVendorsFromAllSales(sold);
  if (!data.length){
    // fallback to static file if available
    const staticData = await getJSON("/sales_by_vendor.json");
    if (Array.isArray(staticData)) data = staticData;
  }

  if (!data.length){
    box.innerHTML = `<div style="padding:14px;color:#7b8aa3">No vendor chart available.</div>`;
    return;
  }

  const total = data.reduce((s,v)=>s+Number(v.count||v.av12x||0),0) || 1;
  box.innerHTML = data.map(v=>{
    const count = Number(v.count ?? 0);
    const pct = Math.round((count/total)*100);
    return `
      <div class="vendor-row">
        <span>${escapeHtml(v.vendor)}</span>
        <span class="num">${count.toLocaleString("en-US")} &nbsp;(${pct}%)</span>
      </div>`;
  }).join("");
}

/* ----------------------------- Render: YTD --------------------------------- */
function renderYTD(ytd){
  const head = byId("ytdHead");
  const body = byId("ytdBody");
  if (!head || !body || !Array.isArray(ytd)) return;

  head.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">YTD AV (12x)</th>
    </tr>`;

  const rows = ytd
    .slice().sort((a,b)=>(b.av||0)-(a.av||0))
    .map(a=>{
      return `
        <tr>
          <td class="agent">
            ${avatarHTML(a.name, a.email||"")}
            <span>${escapeHtml(a.name||"")}</span>
          </td>
          <td class="num">${money(a.av||0)}</td>
        </tr>`;
    }).join("");

  body.innerHTML = rows || `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No YTD data found.</td></tr>`;
}

/* --------------------------------- Boot ----------------------------------- */
(async function boot(){
  try{
    // 1) Load roster headshots once
    await loadRoster();

    // 2) WEEKLY SOLD
    let sold = await getJSON("/api/team_sold");
    if (!sold) throw new Error("team_sold unavailable");

    // Merge to include any agents missing from perAgent (e.g., Elizabeth)
    mergePerAgentWithAllSales(sold);

    // Cards + roster + agent of week + vendors
    renderWeeklyCards(sold, 0 /* calls — replace if you have calls endpoint */);
    renderWeeklyRosterTable(sold);
    renderAgentOfWeek(sold);
    await renderVendors(sold);

    // 3) YTD leaders (optional table)
    const ytd = await getJSON("/ytd_av.json");
    if (Array.isArray(ytd)) renderYTD(ytd);

  }catch(e){
    const tbody = byId("tbody","rosterBody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
    console.error(e);
  }
})();

/* ----------------------------- Minimal CSS -------------------------------- */
/* If this CSS already exists in your .css, you can ignore this note.
   It’s here so avatars look right even if styles were missing. */

(function injectMinimalCSS(){
  const css = `
  .agent{ display:flex; align-items:center; gap:8px; }
  .num{ text-align:right; }
  .avatar{ width:28px; height:28px; border-radius:50%; object-fit:cover; display:inline-block; }
  .avatar-fallback{
    width:28px; height:28px; border-radius:50%;
    background:#2a2f3a; color:#cbd5e1; display:inline-flex; align-items:center; justify-content:center;
    font-weight:600; font-size:12px;
  }
  .vendor-row{ display:flex; justify-content:space-between; padding:6px 2px; border-bottom:1px solid rgba(255,255,255,0.08); }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
})();

/* ============ FEW Dashboard — COMPLETE REPLACEMENT ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                      // refresh cadence
const ROTATE_MS = 30_000;                      // rotate views
const VIEWS     = ["roster","av","aotw"];      // simple & reliable
let   viewIdx   = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- Utils ---------- */
const $  = s => document.querySelector(s);
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml = s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); }

function hmm(mins){
  const mm = Math.max(0, Math.round(Number(mins||0)));
  const h = Math.floor(mm/60), m2 = mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}

/* Week range: Friday 00:00:00 ET -> next Friday 00:00:00 ET */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();            // 0=Sun ... 5=Fri
  const sinceFri = (day + 2) % 7;      // 0 when Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  ytd: [],                     // optional
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales,salesAmt,av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, leads:0, sold:0, unassigned:0, salesAmt:0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* celebration timers */
let CELEBRATING = false;
let refreshTimer = null;
let rotateTimer  = null;

/* ---------- One-time UI scaffolding ---------- */
function ensureOverlayAndStyles(){
  // CSS
  if (!document.getElementById("few-celebration-styles")){
    const css = document.createElement("style");
    css.id = "few-celebration-styles";
    css.textContent = `
      /* ===== Celebration Overlay ===== */
      #saleOverlay{
        position:fixed; inset:0; display:none; align-items:center; justify-content:center;
        background:rgba(0,0,0,.88); z-index:9999; backdrop-filter:saturate(120%) blur(2px);
      }
      #saleOverlay.show{ display:flex; }
      .saleCard{ position:relative; text-align:center; color:#fff; padding:20px 26px; }
      .splat{
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.15) rotate(-10deg);
        width:70vmin; height:70vmin;
        background:radial-gradient(closest-side, rgba(255,211,106,.95) 0%, rgba(255,211,106,.7) 60%, rgba(255,211,106,.0) 61%),
                    radial-gradient(closest-side, rgba(255,211,106,.85) 0%, rgba(255,211,106,.0) 62%) 10% 8% / 20% 20% no-repeat,
                    radial-gradient(closest-side, rgba(255,211,106,.85) 0%, rgba(255,211,106,.0) 62%) 82% 22% / 18% 18% no-repeat,
                    radial-gradient(closest-side, rgba(255,211,106,.85) 0%, rgba(255,211,106,.0) 62%) 24% 78% / 16% 16% no-repeat,
                    radial-gradient(closest-side, rgba(255,211,106,.85) 0%, rgba(255,211,106,.0) 62%) 76% 84% / 14% 14% no-repeat;
        filter: blur(1px);
        opacity:0;
        animation: splatIn 900ms cubic-bezier(.2,1,.2,1) forwards;
      }
      .saleName{
        position:relative;
        font-weight:900; letter-spacing:.02em; line-height:1.05;
        font-size:7vmin; margin-bottom:10px; color:#fff5d6;
        text-shadow:0 10px 40px rgba(0,0,0,.6);
      }
      .saleAmt{
        position:relative;
        font-weight:1000; letter-spacing:.01em; line-height:1;
        font-size:14vmin; color:#00e39b;
        text-shadow:0 14px 60px rgba(0,0,0,.65);
        transform:scale(.9); opacity:.9;
        animation: thump 900ms cubic-bezier(.2,1,.2,1) 120ms both;
      }
      /* Screen quake */
      @keyframes quake{
        0%,100%{ transform:translate(0,0) }
        10%{ transform:translate(-8px,-2px) }
        20%{ transform:translate(6px,3px) }
        30%{ transform:translate(-10px,4px) }
        40%{ transform:translate(8px,-3px) }
        50%{ transform:translate(-6px,2px) }
        60%{ transform:translate(10px,-4px) }
        70%{ transform:translate(-8px,3px) }
        80%{ transform:translate(6px,-2px) }
        90%{ transform:translate(-4px,1px) }
      }
      .quake{ animation:quake 900ms linear both; }
      @keyframes splatIn{
        0%   { transform:translate(-50%,-50%) scale(.1) rotate(-18deg); opacity:0; }
        60%  { transform:translate(-50%,-50%) scale(1.08) rotate(6deg);  opacity:1; }
        100% { transform:translate(-50%,-50%) scale(1)    rotate(0deg);   opacity:1; }
      }
      @keyframes thump{
        0%   { transform:scale(.6); opacity:0; }
        60%  { transform:scale(1.08); opacity:1; }
        100% { transform:scale(1);    opacity:1; }
      }
    `;
    document.head.appendChild(css);
  }
  // HTML
  if (!document.getElementById("saleOverlay")){
    const ov = document.createElement("div");
    ov.id = "saleOverlay";
    ov.setAttribute("aria-hidden","true");
    ov.innerHTML = `
      <div class="saleCard">
        <div class="splat"></div>
        <div class="saleName" id="saleName"></div>
        <div class="saleAmt"  id="saleAmt"></div>
      </div>`;
    document.body.appendChild(ov);
  }
}

/* ---------- UI helpers (index.html already has these containers) ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  const tik = $("#ticker");    if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
  const sub = $("#principle"); if (sub) sub.textContent = text;
}

function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){ const thead = $("#thead"); if (thead) thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function setRows(rows){
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}
function updateSummary(){
  $("#sumCalls")      && ($("#sumCalls").textContent      = fmtInt(STATE.team.calls));
  $("#sumTalk")       && ($("#sumTalk").textContent       = fmtInt(Math.round(STATE.team.talk)));
  $("#sumSales")      && ($("#sumSales").textContent      = fmtMoney(STATE.team.salesAmt || 0));
  $("#sumAV")         && ($("#sumAV").textContent         = fmtMoney(STATE.team.av));
  $("#sumUnassigned") && ($("#sumUnassigned").textContent = fmtMoney(STATE.team.unassigned || 0));
}

function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}"
         onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${escapeHtml(a.name)}</span></div>`;
}
function avatarBlock(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  if (src){
    return `<img class="avatar" style="width:84px;height:84px;border-radius:50%;object-fit:cover"
                 src="${src}"
                 onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot; style=&quot;width:84px;height:84px;font-size:28px;&quot;>${initials(a.name)}</div>')">`;
  }
  return `<div class="avatar-fallback" style="width:84px;height:84px;font-size:28px">${initials(a.name)}</div>`;
}

/* ---------- Celebration ---------- */
function celebrateSale({ name, amount }){
  try{
    CELEBRATING = true;

    // quake
    document.documentElement.classList.add("quake");
    setTimeout(()=> document.documentElement.classList.remove("quake"), 900);

    const overlay = $("#saleOverlay"); if (!overlay) return;
    overlay.querySelector("#saleName").textContent = `${name} — LEADING FOR AGENT OF THE WEEK!`;
    overlay.querySelector("#saleAmt").textContent  = `${fmtMoney(amount)} Submitted AV`;

    // restart splat animation for repeated events
    const splat = overlay.querySelector(".splat");
    if (splat){ splat.style.animation="none"; void splat.offsetWidth; splat.style.animation=""; }

    overlay.classList.add("show");

    // pause timers
    if (refreshTimer){ clearInterval(refreshTimer); refreshTimer = null; }
    if (rotateTimer){  clearInterval(rotateTimer);  rotateTimer  = null;  }

    // hide after 60s and resume timers
    setTimeout(()=>{
      overlay.classList.remove("show");
      CELEBRATING = false;

      refreshTimer = setInterval(async ()=>{
        if (CELEBRATING) return;
        try{
          await Promise.all([refreshCalls(), refreshSales()]);
          renderCurrentView();
        }catch(e){ log("refresh tick error", e?.message||e); }
      }, DATA_MS);

      if (!VIEW_OVERRIDE){
        rotateTimer = setInterval(()=>{
          if (CELEBRATING) return;
          viewIdx = (viewIdx + 1) % VIEWS.length;
          renderCurrentView();
        }, ROTATE_MS);
      }
    }, 60_000);
  }catch(e){ log("celebrate error", e?.message||e); }
}

/* ---------- Loaders ---------- */
async function loadStatic(){
  const [rosterRaw, rules, ytd] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/ytd_av.json").catch(()=>[])
  ]);
  setRuleText(rules);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  STATE.ytd = Array.isArray(ytd) ? ytd : (Array.isArray(ytd?.rows) ? ytd.rows : []);

  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

/* Live calls/talk by agent (server should already be week-scoped, but we trust + apply overrides) */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();
  try{
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name ||"").trim().toLowerCase(),  agentKey(a)]));

    for (const r of per){
      const e = String(r.email||"").trim().toLowerCase();
      const n = String(r.name ||"").trim().toLowerCase();
      const k = emailToKey.get(e) || nameToKey.get(n);
      if (!k) continue;

      const row = {
        calls    : Number(r.calls||0),
        talkMin  : Number(r.talkMin||0),
        loggedMin: Number(r.loggedMin||0),
        leads    : Number(r.leads||0),
        sold     : Number(r.sold||0),
      };
      byKey.set(k, row);
      teamCalls += row.calls;
      teamTalk  += row.talkMin;
      teamLeads += row.leads;
      teamSold  += row.sold;
    }
  }catch(e){ log("calls_by_agent error", e?.message||e); }

  // Overrides if present
  if (STATE.overrides.calls && typeof STATE.overrides.calls === "object"){
    const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
    for (const [email, o] of Object.entries(STATE.overrides.calls)){
      const a = byEmail.get(String(email).toLowerCase());
      if (!a) continue;
      const k   = agentKey(a);
      const cur = byKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

      teamCalls -= cur.calls; teamTalk -= cur.talkMin; teamLeads -= cur.leads; teamSold -= cur.sold;

      const row = {
        calls    : Number(o.calls||0),
        talkMin  : Number(o.talkMin||0),
        loggedMin: Number(o.loggedMin||0),
        leads    : Number(o.leads||0),
        sold     : Number(o.sold||0),
      };
      byKey.set(k, row);

      teamCalls += row.calls; teamTalk += row.talkMin; teamLeads += row.leads; teamSold += row.sold;
    }
  }

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* TEAM sales/AV — recompute strictly for current ET week from raw sales list */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    // Filter to CURRENT ET WEEK
    const [startET, endET] = weekRangeET();
    const all = Array.isArray(payload.allSales) ? payload.allSales : [];

    const inWeek = [];
    for (const s of all){
      const d = toET(s.dateSold || s.date || s.createdAt || s.updatedAt || Date.now());
      if (d >= startET && d < endET) inWeek.push(s);
    }

    // Aggregate per agent for the week
    const byName = new Map(); // name -> {sales, salesAmt, av12x}
    let teamAV = 0;
    let teamSalesAmt = 0;
    let unassigned = 0;

    for (const s of inWeek){
      const name  = String(s.agent || "").trim();
      const amt   = Number(s.amount || 0);
      const av    = Number(s.av12x ?? s.amount ?? 0);

      if (!name){
        unassigned += av;
        teamAV     += av;
        teamSalesAmt += amt;
        continue;
      }
      const key = name.toLowerCase();
      const cur = byName.get(key) || { sales:0, salesAmt:0, av12x:0, name };
      cur.sales += 1;
      cur.salesAmt += amt;
      cur.av12x += av;
      byName.set(key, cur);
      teamAV += av;
      teamSalesAmt += amt;
    }

    // Normalize to roster keys, zeros for folks without sales
    const out = new Map();
    for (const a of STATE.roster){
      const v = byName.get(String(a.name||"").trim().toLowerCase()) || { sales:0, salesAmt:0, av12x:0, name:a.name };
      out.set(agentKey(a), { sales:v.sales, salesAmt:v.salesAmt, av12x:v.av12x });
    }

    // Apply AV overrides by email if present
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      let sum = 0;
      for (const a of STATE.roster){
        const ov = Number(STATE.overrides.av[a.email] || 0);
        const k  = agentKey(a);
        const cur = out.get(k) || { sales:0, salesAmt:0, av12x:0 };
        if (!Number.isNaN(ov) && ov >= 0){
          cur.av12x = ov;
        }
        out.set(k, cur);
        sum += cur.av12x;
      }
      STATE.team.av = sum;
    } else {
      STATE.team.av = teamAV;
    }

    STATE.salesWeekByKey = out;
    STATE.team.unassigned = unassigned;
    STATE.team.salesAmt   = teamSalesAmt;

    // Latest sale celebration (dedupe by lead/product/date)
    const last = inWeek.length ? inWeek[inWeek.length - 1] : null;
    if (last){
      const h = `${last.leadId||""}|${last.soldProductId||""}|${last.dateSold||last.date||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        const amount = Number(last.av12x ?? last.amount ?? 0);
        celebrateSale({ name: last.agent || "Team", amount });
      }
    }
  }catch(e){ log("team_sold error", e?.message||e); }
}

/* ---------- Derived ---------- */
function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const k = agentKey(a);
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, salesAmt:0 };
    return { a, ...s };
  });
  entries.sort((x,y)=>{
    if (y.av12x !== x.av12x) return y.av12x - x.av12x;
    if ((y.sales||0) !== (x.sales||0)) return (y.sales||0) - (x.sales||0);
    return (y.salesAmt||0) - (x.salesAmt||0);
  });
  return entries[0] || null;
}

/* ---------- Renderers ---------- */
function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const c = STATE.callsWeekByKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(k) || { salesAmt:0, av12x:0, sales:0 };
    const conv = c.leads > 0 ? (c.sold / c.leads) : null;
    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtInt(c.leads),
      fmtInt(c.sold),
      fmtPct(conv),
      fmtMoney(s.av12x)
    ];
  });
  setRows(rows);
}

function renderWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);

  const ranked = STATE.roster
    .map(a=>{
      const k = agentKey(a);
      const s = STATE.salesWeekByKey.get(k) || { av12x:0 };
      return { a, val: Number(s.av12x||0) };
    })
    .sort((x,y)=> (y.val)-(x.val));

  const rows = ranked.map(({a,val})=> [avatarCell(a), fmtMoney(val)]);
  setRows(rows);
}

function renderAOTW(){
  const top = bestOfWeek();
  if (!top){ setLabel("Agent of the Week"); setHead([]); setRows([]); return; }

  const { a, av12x, sales } = top;
  const html = `
    <div style="display:flex;gap:18px;align-items:center;">
      ${avatarBlock(a)}
      <div>
        <div style="font-size:22px;font-weight:800;margin-bottom:4px">${escapeHtml(a.name)}</div>
        <div style="font-size:13px;color:#9fb0c8;margin-bottom:6px">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;color:#9fb0c8">
          <div><b style="color:#cfd7e3">${fmtInt(sales)}</b> deals</div>
          <div><b style="color:#ffd36a">${fmtMoney(av12x)}</b> submitted AV</div>
        </div>
      </div>
    </div>
  `;
  // Render hero into table area
  setLabel("Agent of the Week");
  setHead([]); setRows([]);
  const tbody = $("#tbody");
  if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;">${html}</td></tr>`;
}

/* ---------- Router ---------- */
function renderCurrentView(){
  updateSummary();
  const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
  if (v === "roster")      renderRoster();
  else if (v === "av")     renderWeekAV();
  else if (v === "aotw")   renderAOTW();
  else                     renderRoster();
}

/* ---------- Boot ---------- */
async function boot(){
  try{
    ensureOverlayAndStyles();

    await loadStatic();
    await Promise.all([refreshCalls(), refreshSales()]);
    renderCurrentView();

    // periodic refresh
    refreshTimer = setInterval(async ()=>{
      if (CELEBRATING) return;
      try{
        await Promise.all([refreshCalls(), refreshSales()]);
        renderCurrentView();
      }catch(e){ log("refresh tick error", e?.message||e); }
    }, DATA_MS);

    // rotation
    if (!VIEW_OVERRIDE){
      rotateTimer = setInterval(()=>{
        if (CELEBRATING) return;
        viewIdx = (viewIdx + 1) % VIEWS.length;
        renderCurrentView();
      }, ROTATE_MS);
    }
  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", boot);

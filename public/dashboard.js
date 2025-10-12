/* ============ FEW Dashboard — COMPLETE REPLACEMENT ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                      // refresh data
const ROTATE_MS = 30_000;                      // switch table view
const VIEWS     = ["roster","av","aotw","ytd"]; // 4-board rotation
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

/* Weekly window = **Friday 12:00am ET** → next Friday 12:00am ET */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;          // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                      // [inclusive, exclusive)
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales,salesAmt,av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  seenSaleHashes: new Set(),
  ytd: []                      // [{name,email,av}]
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- UI helpers ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  $("#ticker")     && ($("#ticker").textContent    = `RULE OF THE DAY — ${text}`);
  $("#principle")  && ($("#principle").textContent = text);
}

function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }

function setHead(cols){
  const thead = $("#thead");
  if (thead) thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}

function setRows(rows){
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

/* ---------- KPI layout & values (FORCE 3 CARDS) ---------- */

/**
 * Keep exactly three KPI cards on all views:
 *   1) This Week — Team Calls           -> #sumCalls
 *   2) This Week — Total Submitted AV   -> #sumSales (repurposed)
 *   3) This Week — Deals Submitted      -> #sumTalk  (repurposed)
 * Hide everything else.
 */
function massageSummaryLayout(){
  const callsVal  = document.querySelector("#sumCalls");  // keep
  const avVal     = document.querySelector("#sumSales");  // keep (as Total Submitted AV)
  const dealsVal  = document.querySelector("#sumTalk");   // keep (as Deals Submitted)

  // Relabel the three we keep
  if (callsVal){
    const l = callsVal.previousElementSibling;
    if (l) l.textContent = "This Week — Team Calls";
  }
  if (avVal){
    const l = avVal.previousElementSibling;
    if (l) l.textContent = "This Week — Total Submitted AV";
  }
  if (dealsVal){
    const l = dealsVal.previousElementSibling;
    if (l) l.textContent = "This Week — Deals Submitted";
  }

  // Hide any other KPI cards that exist in the HTML
  document.querySelectorAll(".card").forEach(card=>{
    const keep = card.contains(callsVal) || card.contains(avVal) || card.contains(dealsVal);
    if (!keep) card.style.display = "none";
  });
}
/**
 * Fill KPI numbers.
 * Calls -> STATE.team.calls
 * Total Submitted AV -> STATE.team.av (already 12×)
 * Deals Submitted -> prefer sales count from salesWeekByKey; fallback to STATE.team.sold
 */
function updateSummary(){
  // Calls
  const calls = Number(STATE?.team?.calls || 0);
  const callsEl = document.querySelector("#sumCalls");
  if (callsEl) callsEl.textContent = calls.toLocaleString("en-US");

  // Total Submitted AV (money)
  const av = Number(STATE?.team?.av || 0);
  const avEl = document.querySelector("#sumSales");
  if (avEl) avEl.textContent = "$" + Math.round(av).toLocaleString("en-US");

  // Deals Submitted (count from sales map for this week)
  let deals = 0;
  if (STATE?.salesWeekByKey && STATE.salesWeekByKey.size){
    for (const v of STATE.salesWeekByKey.values()) deals += Number(v?.sales || 0);
  } else {
    deals = Number(STATE?.team?.sold || 0);
  }
  const dealsEl = document.querySelector("#sumTalk"); // using this as “Deals”
  if (dealsEl) dealsEl.textContent = deals.toLocaleString("en-US");
}

function showSalePop({name, amount}){
  const el = $("#salePop");
  if (!el) return;
  const av12 = Number(amount||0) * 12;
  el.textContent = `${name} submitted ${fmtMoney(av12)} AV 🎉`;
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 3500);
}

/* ---------- Loaders ---------- */
async function loadStatic(){
  const [rosterRaw, rules, ytd] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/ytd_av.json").catch(()=>[]) // manual override for YTD board
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

/* Live calls / talk / leads / sold */
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

/* Sales → AV (12×) for **this week only**. Works even if the function doesn’t give av12x. */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    // Build from raw sales if available to guarantee correct week window.
    const [WSTART, WEND] = weekRangeET();
    const acc = new Map(); // nameKey -> {sales, amount}

    const add = (name, amount) => {
      const key = String(name||"").trim().toLowerCase();
      if (!key) return;
      const cur = acc.get(key) || { sales:0, amount:0 };
      cur.sales  += 1;
      cur.amount += Number(amount||0);
      acc.set(key, cur);
    };

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;   // keep only this week
        add(s.agent, Number(s.amount||0));
      }
    }else{
      // Fall back to perAgent structure from the function
      const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of per){
        const name = a.name;
        const sales = Number(a.sales||0);
        const amount = Number(a.amount||0);
        const cur = acc.get(String(name||"").trim().toLowerCase()) || { sales:0, amount:0 };
        cur.sales  = sales;
        cur.amount = amount;
        acc.set(String(name||"").trim().toLowerCase(), cur);
      }
    }

    // Build per-agent map against roster and compute AV (12×). Apply overrides if present.
    const out = new Map();
    let teamAV = 0;
    let teamDeals = 0;

    for (const a of STATE.roster){
      const nameKey = String(a.name||"").trim().toLowerCase();
      const base    = acc.get(nameKey) || { sales:0, amount:0 };

      // prefer override av if provided, else compute 12× amount
      let av12 = (STATE.overrides.av && a.email in STATE.overrides.av)
        ? Number(STATE.overrides.av[a.email]||0)
        : Number(base.amount||0) * 12;

      av12 = Math.max(0, av12);

      out.set(agentKey(a), {
        sales   : Number(base.sales||0),
        salesAmt: Number(base.amount||0),
        av12x   : av12
      });

      teamAV    += av12;
      teamDeals += Number(base.sales||0);
    }

    STATE.salesWeekByKey = out;
    STATE.team.av    = teamAV;
    STATE.team.deals = teamDeals;

    // Pop the latest sale once (if raw present)
    if (raw.length){
      const last = raw[raw.length-1];
      if (last){
        const h = `${last.leadId||""}|${last.soldProductId||""}|${last.dateSold||""}`;
        if (!STATE.seenSaleHashes.has(h)){
          STATE.seenSaleHashes.add(h);
          showSalePop({ name:last.agent || "Team", amount:last.amount || 0 });
        }
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
        <div style="color:#9fb0c8;margin-bottom:6px;">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;color:#9fb0c8">
          <div><b style="color:#cfd7e3">${fmtInt(sales)}</b> deals</div>
          <div><b style="color:#ffd36a">${fmtMoney(av12x)}</b> submitted AV</div>
        </div>
      </div>
    </div>
  `;
  setLabel("Agent of the Week");
  setHead([]); setRows([[html]]);
}

/* Manual YTD Leaders (from ytd_av.json) */
function renderYTD(){
  setLabel("YTD — Leaders");
  setHead(["Agent","YTD AV (12×)"]);

  // Map YTD rows to roster for photos/initials by email or name
  const byEmail = new Map(STATE.roster.map(a=>[String(a.email||"").trim().toLowerCase(), a]));
  const byName  = new Map(STATE.roster.map(a=>[String(a.name ||"").trim().toLowerCase(),  a]));

  const rows = (STATE.ytd||[])
    .map(row=>{
      const a = byEmail.get(String(row.email||"").toLowerCase()) || byName.get(String(row.name||"").toLowerCase()) || {name:row.name||"—", email:"", photo:""};
      return { a, val: Number(row.av||0) };
    })
    .sort((x,y)=> (y.val)-(x.val))
    .map(({a,val})=> [avatarCell(a), fmtMoney(val)]);

  setRows(rows);
}

/* ---------- Router ---------- */
function renderCurrentView(){
  // Ensure KPI labels are right & extra cards hidden
  massageSummaryLayout();
  updateSummary();

  const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
  if (v === "roster")      renderRoster();
  else if (v === "av")     renderWeekAV();
  else if (v === "aotw")   renderAOTW();
  else if (v === "ytd")    renderYTD();
  else                     renderRoster();
}

/* ---------- Boot ---------- */
async function boot(){
  try{
    massageSummaryLayout();                   // fix summary card labels/visibility now
    await loadStatic();
    await Promise.all([refreshCalls(), refreshSales()]);
    renderCurrentView();

    // periodic refresh
    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSales()]);
        renderCurrentView();
      }catch(e){ log("refresh tick error", e?.message||e); }
    }, DATA_MS);

    // rotation
    if (!VIEW_OVERRIDE){
      setInterval(()=>{
        viewIdx = (viewIdx + 1) % VIEWS.length;
        renderCurrentView();
      }, ROTATE_MS);
    }

    // run the KPI cleanup again after DOM settles (keeps it to 3)
    setTimeout(massageSummaryLayout, 100);

  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", boot);

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
  ytd: [],                     // [{name,email,av}]
  team: { calls:0, talk:0, av:0, leads:0, sold:0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- Simple UI helpers ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  $("#ticker")     && ($("#ticker").textContent    = `RULE OF THE DAY — ${text}`);
  $("#principle")  && ($("#principle").textContent = `2) ${text}`);
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

/* Always force **exactly 3** KPI cards and right labels */
function massageSummaryLayout(){
  const cardFromVal = (id)=> document.getElementById(id)?.closest('.card');
  const labelOf = (id)=> document.getElementById(id)?.previousElementSibling;

  // Card 1: Calls
  if (labelOf('sumCalls')) labelOf('sumCalls').textContent = 'This Week — Team Calls';

  // Card 2: Deals (reuse the "talk" slot for weekly deals)
  if (labelOf('sumTalk')) labelOf('sumTalk').textContent = 'This Week — Deals Submitted';

  // Card 3: Total Submitted AV (reuse the "sales" slot)
  if (labelOf('sumSales')) labelOf('sumSales').textContent = 'This Week — Total Submitted AV';

  // Hide extra KPIs we never want
  const hide = (el)=>{ if (el) el.style.display = 'none'; };
  hide(cardFromVal('sumAV'));
  hide(cardFromVal('sumUnassigned'));

  // Also hide by label text if unknown ids appear
  document.querySelectorAll('.card .label')?.forEach(l=>{
    const t = (l.textContent || '').trim();
    if (/team av/i.test(t) || /unassigned/i.test(t)) {
      const c = l.closest('.card'); if (c) c.style.display = 'none';
    }
  });
}

/* Set weekly KPI values for the 3 cards */
function updateSummary(){
  const set = (id, val)=>{ const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sumCalls',  fmtInt(STATE.team.calls));   // Card 1
  set('sumTalk',   fmtInt(STATE.team.sold));    // Card 2 (Deals)
  set('sumSales',  fmtMoney(STATE.team.av));    // Card 3 (Total Submitted AV, 12×)
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

  STATE.ytd = Array.isArray(ytd) ? ytd : (Array.isArray(ytd?.rows) ? ytd.rows : ytd?.agents ? ytd.agents : []);

  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

/* Live calls / talk / leads / sold — week window handled by backend; we still accept overrides */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();
  try{
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : (Array.isArray(payload?.agents) ? payload.agents : []);
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
  STATE.team.sold  = Math.max(0, Math.round(teamSold)); // also used for the Deals KPI
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
    STATE.team.av = teamAV;
    // If calls endpoint doesn't provide deals, ensure KPI reflects sales deals too
    if ((STATE.team.sold||0) < teamDeals) STATE.team.sold = teamDeals;

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
      const s = STATE.salesWeekBy

/* ============ FEW Dashboard — COMPLETE REPLACEMENT (AV-focused) ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;            // refresh data
const ROTATE_MS = 30_000;            // switch table view
const VIEWS     = ["roster","av","aotw"];
let   viewIdx   = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- Utils ---------- */
const $ = s => document.querySelector(s);

const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml = s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));

function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); }

const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

// Sales week: Friday 00:00 ET → Friday 00:00 ET next week
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                // 0=Sun ... 5=Fri
  const sinceFri = (day + 2) % 7;          // days since Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}

function hmm(mins){
  const mm = Math.max(0, Math.round(Number(mins||0)));
  const h = Math.floor(mm/60), m2 = mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales, salesAmt, av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, leads:0, sold:0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- UI helpers ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  const tik = $("#ticker");    if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
  const sub = $("#principle"); if (sub) sub.textContent = text;
}

function tweakSummaryLayoutOnce(){
  // Re-label card #3 as Total Submitted AV and point its value to team.av.
  // Hide card #4 (old AV) and #5 (Unassigned).
  const cards = document.querySelectorAll("#summary .card");
  if (cards.length >= 3){
    const labelEl = cards[2].querySelector(".k");
    if (labelEl && !labelEl.dataset.fewRelabeled){
      labelEl.textContent = "This Week — Total Submitted AV (12×)";
      labelEl.dataset.fewRelabeled = "1";
    }
    // Route the value to #sumSales (we’ll write team.av into that)
    const oldAV = cards[3]; if (oldAV) oldAV.style.display = "none";
    const unassigned = cards[4]; if (unassigned) unassigned.style.display = "none";
  }
}

function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){ const thead = $("#thead"); if (thead) thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function setRows(rows){
  const tbody = $("#tbody"); if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function updateSummary(){
  tweakSummaryLayoutOnce();
  $("#sumCalls") && ($("#sumCalls").textContent = fmtInt(STATE.team.calls));
  $("#sumTalk")  && ($("#sumTalk").textContent  = fmtInt(Math.round(STATE.team.talk)));
  // We repurpose #sumSales to show AV total (because we relabeled that card)
  $("#sumSales") && ($("#sumSales").textContent = fmtMoney(STATE.team.av));
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
  // small toast (kept; big “celebration” overlay will be added later if you want)
  const el = $("#salePop"); if (!el) return;
  el.textContent = `${name} submitted ${fmtMoney(amount*12)} AV 🎉`;
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 3500);
}

/* ---------- Loaders ---------- */
async function loadStatic(){
  const [rosterRaw, rules] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[])
  ]);
  setRuleText(rules);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

// Live calls/talk/leads/sold — server already gives week; we keep overrides support
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

  // Apply overrides if present
  if (STATE.overrides.calls && typeof STATE.overrides.calls === "object"){
    const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
    for (const [email, o] of Object.entries(STATE.overrides.calls)){
      const a = byEmail.get(String(email).toLowerCase()); if (!a) continue;
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

/* ---------- Sales / AV (12×) — recomputed client-side for the current ET week ---------- */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");
    const all = Array.isArray(payload?.allSales) ? payload.allSales : [];
    const [startET, endET] = weekRangeET();

    // Build per-agent sums from raw sales — filter to THIS WEEK in ET, compute 12× AV
    const sums = new Map(); // nameKey -> {sales, salesAmt, av12x}
    for (const s of all){
      // Expect fields: dateSold, agent, amount, soldProductId/name, etc.
      const when = toET(s.dateSold || s.date || s.createdAt || Date.now());
      if (when < startET || when >= endET) continue;

      const nameKey = String(s.agent || s.name || "").trim().toLowerCase();
      if (!nameKey) continue;

      const saleAmt = Number(s.amount || 0);
      const av12x   = saleAmt * 12;

      const cur = sums.get(nameKey) || { sales:0, salesAmt:0, av12x:0 };
      cur.sales    += 1;
      cur.salesAmt += saleAmt;
      cur.av12x    += av12x;
      sums.set(nameKey, cur);
    }

    // Map to roster keys
    const out = new Map();
    for (const a of STATE.roster){
      const key = agentKey(a);
      const nameKey = String(a.name||"").trim().toLowerCase();
      const v = sums.get(nameKey) || { sales:0, salesAmt:0, av12x:0 };
      out.set(key, v);
    }

    // Overrides for AV (email-based)
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      let sum = 0;
      for (const a of STATE.roster){
        const ov = Number(STATE.overrides.av[a.email] || 0);
        if (ov >= 0){
          const k   = agentKey(a);
          const cur = out.get(k) || { sales:0, salesAmt:0, av12x:0 };
          cur.av12x = ov;
          out.set(k, cur);
          sum += ov;
        }
      }
      STATE.team.av = sum;
    } else {
      let total = 0;
      out.forEach(v => total += v.av12x||0);
      STATE.team.av = total;
    }

    STATE.salesWeekByKey = out;

    // Celebration toast for the latest sale this week (by date)
    if (all.length){
      const recentThisWeek = all
        .map(s=>({ s, t: toET(s.dateSold || s.date || s.createdAt || Date.now()) }))
        .filter(x => x.t>=startET && x.t<endET)
        .sort((a,b)=> a.t - b.t);
      const last = recentThisWeek[recentThisWeek.length-1]?.s;
      if (last){
        const h = `${last.leadId||""}|${last.soldProductId||""}|${last.dateSold||last.date||last.createdAt||""}`;
        if (!STATE.seenSaleHashes.has(h)){
          STATE.seenSaleHashes.add(h);
          showSalePop({ name: last.agent || "Team", amount: Number(last.amount||0) });
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
        <div style="margin:4px 0 10px;color:#9fb0c8;letter-spacing:.02em">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;color:#9fb0c8">
          <div><b style="color:#cfd7e3">${fmtInt(sales)}</b> deals</div>
          <div><b style="color:#ffd36a">${fmtMoney(av12x)}</b> submitted AV</div>
        </div>
      </div>
    </div>
  `;
  // reuse table body as a hero slot
  setHead([]); setRows([]);
  const tbody = $("#tbody"); if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;">${html}</td></tr>`;
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

    // rotation (unless ?view=…)
    if (!VIEW_OVERRIDE){
      setInterval(()=>{
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

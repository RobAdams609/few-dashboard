// ============ FEW Dashboard — FULL REPLACEMENT (Live Calls + AOTW + Agent Detail) ============
const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

// ---- Config ----
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                      
const ROTATE_MS = 30_000;                      
const VIEWS     = ["av", "ytd", "vendor", "roster", "aotw"];
let   viewIdx   = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();
const AGENT_QS_NAME = (QS.get("name") || "").trim();

// ---- Utils ----
const $  = s => document.querySelector(s);
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); }

function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();           
  const sinceFri = (day + 2) % 7;     
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}
const hmm = m => {
  const mm = Math.max(0, Math.round(Number(m||0)));
  const h = Math.floor(mm/60), m2 = mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
};

// ---------------- State ----------------
const STATE = {
  roster: [],                  
  callsWeekByKey: new Map(),   
  salesWeekByKey: new Map(),   
  team: { calls:0, talk:0, av:0, leads:0, sold:0 },
  overrides: { calls:null, av:null },
  ytd: [],                     
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

// ---------------- Shell ----------------
function ensureUI(){
  let root = $("#few-root");
  if (!root){
    root = document.createElement("div"); root.id="few-root";
    root.innerHTML = `
      <div id="ticker" class="ticker"></div>
      <h1 class="title">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</h1>
      <h4 id="principle" class="sub"></h4>

      <div id="kpis" class="kpis">
        <div class="kpi"><div class="label">This Week — Team Calls</div><div id="kpi-calls" class="value">0</div></div>
        <div class="kpi"><div class="label">This Week — Team Talk (min)</div><div id="kpi-talk" class="value">0</div></div>
        <div class="kpi"><div class="label">This Week — Team AV</div><div id="kpi-av" class="value">$0</div></div>
      </div>

      <div class="label"><span id="viewLabel"></span></div>
      <table class="grid">
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>

      <div id="salePop" class="sale-pop"></div>
      <div id="hero" class="hero" style="display:none"></div>
    `;
    document.body.prepend(root);
  }
}

function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  const tik = $("#ticker");    if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
  const sub = $("#principle"); if (sub) sub.textContent = text;
}

function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${a.name}</span></div>`;
}

// ---------------- Loaders ----------------
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

// ---------- LIVE calls/talk by agent ----------
async function refreshCalls() {
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();

  try {
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name ||"").trim().toLowerCase(),  agentKey(a)]));

    for (const r of per) {
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
  } catch (e) {
    log("calls_by_agent error", e?.message || e);
  }

  if (STATE.overrides.calls && typeof STATE.overrides.calls === "object") {
    const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
    for (const [email, o] of Object.entries(STATE.overrides.calls)) {
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

// ---------- TEAM Sales ----------
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    const mapByName = new Map();
    (payload.perAgent || []).forEach(a => {
      mapByName.set(String(a.name || "").trim().toLowerCase(), {
        salesAmt: Number(a.amount || 0),
        av12x   : Number(a.av12x || 0),
        sales   : Number(a.sales || 0),
      });
    });

    const out = new Map();
    for (const a of STATE.roster){
      const nameKey = String(a.name || "").trim().toLowerCase();
      const v = mapByName.get(nameKey) || { salesAmt:0, av12x:0, sales:0 };
      out.set(agentKey(a), v);
    }

    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      let sum = 0;
      for (const a of STATE.roster){
        const ov = Number(STATE.overrides.av[a.email] || 0);
        if (ov >= 0){
          const k   = agentKey(a);
          const cur = out.get(k) || { salesAmt:0, av12x:0, sales:0 };
          cur.av12x = ov;
          out.set(k, cur);
          sum += ov;
        }
      }
      STATE.team.av = sum;
    } else {
      STATE.team.av = Number(payload.team?.totalAV12x || 0);
    }

    STATE.salesWeekByKey = out;

    const all = Array.isArray(payload.allSales) ? payload.allSales : [];
    const last = all.length ? all[all.length - 1] : null;
    if (last){
      const h = `${last.leadId}|${last.soldProductId}|${last.dateSold}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        showSalePop({
          name: last.agent || "Team",
          product: last.soldProductName || "Product",
          amount: last.amount || 0
        });
      }
    }
  }catch(e){ log("team_sold error", e?.message || e); }
}

// ---------------- Derived ----------------
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

// ---------------- Renderers ----------------
function renderKPIs(){
  const { calls, talk, av } = STATE.team;
  const elC = $("#kpi-calls"), elT = $("#kpi-talk"), elA = $("#kpi-av");
  if (elC) elC.textContent = fmtInt(calls);
  if (elT) elT.textContent = fmtInt(Math.round(talk));
  if (elA) elA.textContent = fmtMoney(av);
}

function setHead(cols){ $("#thead").innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setRows(rows){
  $("#tbody").innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function renderRoster(){
  showHero(false);
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk Time (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
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
  showHero(false);
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);

  const ranked = STATE.roster
    .map(a=>{
      const k = agentKey(a);
      const s = STATE.salesWeekByKey.get(k) || { av12x:0 };
      return { a, val: Number(s.av12x||0) };
    })
    .sort((x,y)=> (y.val)-(x.val));

  const tbody = $("#tbody");
  if (!ranked.length){
    tbody.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
    return;
  }

  let html = "";
  ranked.forEach(({a,val}, i)=>{
    const leader = (i === 0 && val > 0) ? ' class="leader"' : "";
    html += `<tr${leader} data-agent="${a.name}">
      <td>${avatarCell(a)}</td>
      <td class="num">${fmtMoney(val)}</td>
    </tr>`;
  });
  tbody.innerHTML = html;
  $("#tbody").querySelectorAll("tr[data-agent]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const n = tr.getAttribute("data-agent");
      openAgentDetail(n);
    });
  });
}

// ---- Agent of the Week ----
function renderAOTW(){
  const top = bestOfWeek();
  if (!top){ setLabel("Agent of the Week"); setHead([]); setRows([]); showHero(false); return; }

  const { a, av12x, sales, salesAmt } = top;
  showHero(true, `
    <div class="aotw">
      <div class="aotw-badge">IN THE LEAD FOR AGENT OF THE WEEK</div>
      <div class="aotw-card">
        <div class="aotw-photo">${avatarBlock(a)}</div>
        <div class="aotw-info">
          <div class="aotw-name">${escapeHtml(a.name)}</div>
          <div class="aotw-metrics">
            <div class="m"><div class="k">Deals</div><div class="v">${fmtInt(sales||0)}</div></div>
            <div class="m"><div class="k">Total Sales</div><div class="v">${fmtMoney(salesAmt||0)}</div></div>
            <div class="m"><div class="k">Submitted AV</div><div class="v highlight">${fmtMoney(av12x||0)}</div></div>
          </div>
          <button class="aotw-btn" aria-label="Open agent profile" data-agent="${escapeHtml(a.name)}">View Profile →</button>
        </div>
      </div>
    </div>
  `);
  setLabel("Agent of the Week");
  setHead([]); setRows([]);
  const btn = $("#hero .aotw-btn");
  if (btn){ btn.addEventListener("click",()=> openAgentDetail(a.name)); }
}

function avatarBlock(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  return src

/* FEW Dashboard — Roster + Week AV + YTD AV (with Logged time) */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log = (...a)=>{ if(DEBUG) console.log("[DBG]", ...a); };

const DATA_REFRESH_MS = 30_000;     // refresh cadence
const ROTATION_MS     = 30_000;     // rotate views
const ET_TZ           = "America/New_York";
const VIEWS           = ["roster","av","ytd"];   // rotation order

// ---------- utils ----------
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmtMoney = n => `$${Math.round(Number(n||0)).toLocaleString("en-US")}`;
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const initials = n => (n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }
function toET(d){ return new Date(new Date(d).toLocaleString("en-US",{timeZone:ET_TZ})); }
function cleanDigits(s){ return String(s||"").replace(/\D/g,""); }
function readCallMin(r){ const sec = r.duration ?? r.callDuration ?? r.talk_time_seconds ?? 0; return Number(sec)/60; }
function fmtHMM(min){
  min = Math.max(0, Math.round(Number(min||0)));
  const h = Math.floor(min/60), m = min%60;
  return `${h}:${String(m).padStart(2,"0")}`;
}
// Accepts either minutes (number) or strings like "3 hrs 36 mins"
function parseLogged(val){
  if (val==null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).toLowerCase();
  const h = /(\d+)\s*h/.exec(s)?.[1] ?? /(\d+)\s*hr/.exec(s)?.[1];
  const m = /(\d+)\s*m/.exec(s)?.[1] ?? /(\d+)\s*min/.exec(s)?.[1];
  return (Number(h||0)*60) + Number(m||0);
}
// Friday→Thursday “sales week”
function currentWeekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                 // Sun=0..Sat=6
  const daysSinceFri = (day + 2) % 7;       // Fri=0
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-daysSinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start,end];
}

// ---------- state ----------
const STATE = {
  roster: [],                    // [{name,email,photo,phones[]}]
  phoneToKey: new Map(),         // phone -> agentKey
  callsTodayByKey: new Map(),    // agentKey -> {calls,talkMinToday}
  salesByKey: new Map(),         // agentKey -> {salesAmt,av12x}
  loggedByKey: new Map(),        // agentKey -> minutes (week)
  team: { calls:0, talk:0, av:0 },
  overrides: { av:null, calls:null },  // calls override can include loggedMin
  ytd: [],                        // [{name, photo, av}]
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

// ---------- UI shell ----------
function ensureUI(){
  // Hide legacy tiles we don’t use
  for (const label of ["This Week — Team Sales","Unassigned Sales"]) {
    $$("div,section,article").forEach(el=>{
      if (new RegExp(label,"i").test(el.textContent||"")) el.style.display="none";
    });
  }
  if (!$("#few-root")){
    const root = document.createElement("div"); root.id="few-root";
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
    `;
    document.body.prepend(root);
  }
}

// ---------- rules banner ----------
async function setRuleText(){
  try{
    const rules = await getJSON("/rules.json").catch(()=>[]);
    const list = Array.isArray(rules?.rules) ? rules.rules : (Array.isArray(rules)?rules:[]);
    if (!list.length) return;
    const idx = (new Date().getUTCDate()) % list.length;
    const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
    const tik = $("#ticker");     if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
    const sub = $("#principle");  if (sub) sub.textContent = text;
  }catch{}
}

// ---------- roster ----------
async function loadRoster(){
  const raw = await getJSON("/headshots/roster.json");
  const list = Array.isArray(raw?.agents) ? raw.agents : (Array.isArray(raw)?raw:[]);
  STATE.roster = list.map(a=>({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones)?a.phones:[]
  }));
  STATE.phoneToKey = new Map();
  for (const a of STATE.roster){
    const key = agentKey(a);
    for (const p of a.phones||[]){
      const d = cleanDigits(p);
      if (!d) continue;
      STATE.phoneToKey.set(d, key);
      if (d.length===10) STATE.phoneToKey.set("1"+d, key);
    }
  }
}

// ---------- overrides ----------
async function loadOverrides(){
  try{ STATE.overrides.av    = await getJSON("/av_week_override.json"); } catch{ STATE.overrides.av=null; }
  try{ STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch{ STATE.overrides.calls=null; }

  // Build logged map from calls override if present
  STATE.loggedByKey = new Map();
  if (STATE.overrides.calls && typeof STATE.overrides.calls==="object"){
    for (const a of STATE.roster){
      const o = STATE.overrides.calls[a.email];
      if (!o) continue;
      const mins = parseLogged(o.loggedMin ?? o.logged);
      if (mins>0) STATE.loggedByKey.set(agentKey(a), mins);
    }
  }
}

// ---------- KPI render ----------
function renderKPIs(){
  const k1=$("#kpi-calls"), k2=$("#kpi-talk"), k3=$("#kpi-av");
  if (k1) k1.textContent = fmtInt(STATE.team.calls);
  if (k2) k2.textContent = fmtInt(Math.round(STATE.team.talk));
  if (k3) k3.textContent = fmtMoney(STATE.team.av);
}

// ---------- render helpers ----------
function setLabel(txt){ const el=$("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){ $("#thead").innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${a.name}</span></div>`;
}

// ---------- data refresh ----------
async function refreshCalls(){
  try{
    const payload = await getJSON("/api/calls_diag?days=7&limit=2000");
    const rows = (payload.records || payload.data || []).filter(Boolean);

    const [weekStart, weekEnd] = currentWeekRangeET();
    const today = toET(new Date()); const todayStart = new Date(today); todayStart.setHours(0,0,0,0);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate()+1);

    // Team totals (week)
    let wkCalls=0, wkTalk=0;
    for (const r of rows){
      const when = toET((r.callStartDate || r.dateRecorded || "").replace(" ","T")+"Z");
      if (when>=weekStart && when<weekEnd){ wkCalls += 1; wkTalk += readCallMin(r); }
    }
    // Apply override totals if present
    if (STATE.overrides.calls && typeof STATE.overrides.calls==="object"){
      let oc=0, ot=0;
      for (const a of STATE.roster){
        const o = STATE.overrides.calls[a.email];
        if (!o) continue;
        oc += Number(o.calls||0);
        ot += Number(o.talkMin||0);
      }
      if (oc>0 || ot>0){ wkCalls = oc; wkTalk = ot; }
    }
    STATE.team.calls = wkCalls;
    STATE.team.talk  = wkTalk;

    // Per-agent calls/talk for TODAY (roster columns)
    const map = new Map();
    function bump(key, rec){
      const obj = map.get(key) || {calls:0,talkMin:0};
      obj.calls  += 1;
      obj.talkMin+= readCallMin(rec);
      map.set(key,obj);
    }
    for (const r of rows){
      const when = toET((r.callStartDate || r.dateRecorded || "").replace(" ","T")+"Z");
      if (!(when>=todayStart && when<todayEnd)) continue;
      const to = cleanDigits(r.toPhoneNumber), from = cleanDigits(r.fromPhoneNumber);
      const candidates = [to,from, to.replace(/^1/,''), from.replace(/^1/,'')];
      const seen = new Set();
      for (const num of candidates){
        const key = STATE.phoneToKey.get(num);
        if (key && !seen.has(key)){ bump(key,r); seen.add(key); }
      }
    }
    STATE.callsTodayByKey = map;
  }catch(e){ log("calls error", e); }
}

async function refreshSales(){
  try{
    const payload = await getJSON("/api/sales_diag?days=30&limit=1000");
    const rows = (payload.records || payload.data || []).filter(Boolean);
    const [weekStart, weekEnd] = currentWeekRangeET();

    const byKey = new Map();
    let teamAV=0;
    for (const r of rows){
      const when = toET((r.dateSold||"").replace(" ","T")+"Z");
      if (!(when>=weekStart && when<weekEnd)) continue;
      const amt = Number(r.amount||0);
      teamAV += amt*12;
      const key = String((r.ownerEmail || r.ownerName || "")).trim().toLowerCase();
      if (!key) continue;
      const cur = byKey.get(key) || {salesAmt:0,av12x:0};
      cur.salesAmt += amt; cur.av12x += amt*12;
      byKey.set(key,cur);
    }
    // project onto roster (prefer email)
    const out = new Map();
    for (const a of STATE.roster){
      const v = byKey.get(a.email) || byKey.get(a.name.trim().toLowerCase()) || {salesAmt:0,av12x:0};
      out.set(agentKey(a), v);
    }
    // AV override
    if (STATE.overrides.av && typeof STATE.overrides.av==="object"){
      let sum=0;
      for (const a of STATE.roster){
        const val = Number(STATE.overrides.av[a.email]||0);
        if (val>0){
          const k = agentKey(a);
          const cur = out.get(k) || {salesAmt:0,av12x:0};
          cur.av12x = val;
          out.set(k,cur);
          sum += val;
        }
      }
      teamAV = sum;
    }
    STATE.salesByKey = out;
    STATE.team.av    = teamAV;

    // toast on newest sale
    const last = rows[rows.length-1];
    if (last){
      const h = `${last.leadId}|${last.soldProductId}|${last.dateSold}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        showSalePop({ name:last.ownerName||last.ownerEmail||"Team", product:last.soldProductName||"Product", amount:last.amount||0 });
      }
    }
  }catch(e){ log("sales error", e); }
}

async function refreshYTD(){
  try{
    const data = await getJSON("/ytd_av.json"); // array or {items:[...]}
    const list = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    const byEmail = new Map(STATE.roster.map(r=>[r.email, r]));
    const byName  = new Map(STATE.roster.map(r=>[r.name.trim().toLowerCase(), r]));

    const items = list.map(it=>{
      const name  = String(it.name||"").trim();
      const email = String((it.email||"")).trim().toLowerCase();
      const av    = Number(String(it.av||0).toString().replace(/[^\d.]/g,"")) || 0;
      const match = (email && byEmail.get(email)) || byName.get(name.toLowerCase());
      return { name: match?.name || name, photo: match?.photo || "", av };
    });
    STATE.ytd = items.sort((a,b)=> (b.av||0)-(a.av||0));
  }catch(e){ log("ytd error", e); STATE.ytd=[]; }
}

// ---------- renders ----------
function renderRoster(){
  setLabel("Today — Roster");
  setHead(["Agent","Calls","Talk Time (min)","Logged (h:mm)","Submitted AV"]);
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const c = STATE.callsTodayByKey.get(k) || {calls:0,talkMin:0};
    const s = STATE.salesByKey.get(k) || {av12x:0};
    const loggedMin = STATE.loggedByKey.get(k) || 0;
    return `<tr>
      <td>${avatarCell(a)}</td>
      <td class="num">${fmtInt(c.calls)}</td>
      <td class="num">${fmtInt(Math.round(c.talkMin))}</td>
      <td class="num">${fmtHMM(loggedMin)}</td>
      <td class="num">${fmtMoney(s.av12x)}</td>
    </tr>`;
  }).join("");
  $("#tbody").innerHTML = rows || `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function renderLeaderboardWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);
  const rows = STATE.roster.map(a=>{
    const v = STATE.salesByKey.get(agentKey(a)) || {av12x:0};
    return { a, val: v.av12x||0 };
  }).sort((x,y)=> (y.val||0)-(x.val||0))
    .map(({a,val})=> `<tr><td>${avatarCell(a)}</td><td class="num">${fmtMoney(val)}</td></tr>`).join("");
  $("#tbody").innerHTML = rows || `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function renderLeaderboardYTD(){
  setLabel("YTD — Leaderboard (AV)");
  setHead(["Agent","YTD AV"]);
  const rows = STATE.ytd.map(r=> `<tr><td>${avatarCell({name:r.name, photo:r.photo})}</td><td class="num">${fmtMoney(r.av)}</td></tr>`).join("");
  $("#tbody").innerHTML = rows || `<tr><td style="padding:18px;color:#5c6c82;">No YTD records</td></tr>`;
}

function renderCurrent(){
  renderKPIs();
  const idx = (renderCurrent._i||0)%VIEWS.length;
  const v = VIEWS[idx];
  if (v==="roster") renderRoster();
  else if (v==="av") renderLeaderboardWeekAV();
  else renderLeaderboardYTD();
  renderCurrent._i = idx+1;
}

// ---------- sale toast ----------
function showSalePop({ name, product, amount }){
  const el = $("#salePop"); if(!el) return;
  el.textContent = `🔥 ${name||"Team"} sold ${product||"Product"} — ${fmtMoney(amount)}`;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 7000);
}

// ---------- boot ----------
async function boot(){
  ensureUI();
  await Promise.all([setRuleText(), loadRoster(), loadOverrides(), refreshYTD()]);
  await Promise.all([refreshCalls(), refreshSales()]);
  renderCurrent();
  setInterval(async ()=>{ await Promise.all([refreshCalls(), refreshSales(), loadOverrides(), refreshYTD()]); renderKPIs(); }, DATA_REFRESH_MS);
  setInterval(renderCurrent, ROTATION_MS);
}
window.addEventListener("DOMContentLoaded", boot);

// ---------- tiny fallback styles ----------
const FALLBACK_CSS = `
.few-root{padding:12px}
.title{margin:6px 0 2px;font-size:28px;text-align:center;color:#ffeaa7;text-shadow:0 0 12px #222}
.sub{margin:0 0 12px;text-align:center;color:#9fb}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 10px}
.kpi{background:#111a22;border:1px solid #24313f;border-radius:10px;padding:10px}
.kpi .label{font-size:12px;color:#9fb}
.kpi .value{font-size:22px;color:#ffeaa7}
.label{margin:10px 0 6px;color:#9fb}
.grid{width:100%;border-collapse:separate;border-spacing:0 6px}
.grid th,.grid td{padding:10px;background:#0e1720;border-bottom:1px solid #1f2a36}
.grid th{color:#9fb;text-align:left}
.grid td.num{text-align:right;color:#eaeef5}
.agent{display:flex;gap:8px;align-items:center}
.avatar{width:28px;height:28px;border-radius:50%;object-fit:cover}
.avatar-fallback{width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;background:#223246;color:#bee}
.ticker{font-size:12px;color:#9fb;margin-bottom:4px}
.sale-pop{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;background:#072;color:#cfe;padding:10px 14px;border-radius:12px;opacity:0;pointer-events:none;transition:.3s}
.sale-pop.show{opacity:1}
`;
(()=>{ const s=document.createElement("style"); s.textContent=FALLBACK_CSS; document.head.appendChild(s); })();

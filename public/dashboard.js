// ============ FEW Dashboard — FULL REPLACEMENT (AOTW + Agent Detail) ============
// Rotation: AV (week) → YTD AV → Vendor Chart → Roster → AOTW

const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

// ---- Config ----
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                       // refresh cadence
const ROTATE_MS = 30_000;                       // rotate views
const VIEWS     = ["av", "ytd", "vendor", "roster", "aotw"]; // rotation sequence
let   viewIdx   = 0;

// Optional view override via URL
const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();
const AGENT_QS_NAME = (QS.get("name") || "").trim();

// ---- Utils ----
const $  = s => document.querySelector(s);
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();

function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); }
const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

function weekRangeET(){               // Fri → Thu sales week
  const now = toET(new Date());
  const day = now.getDay();           // 0..6
  const sinceFri = (day + 2) % 7;     // Fri=0
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
  roster: [],                  // [{name,email,photo,phones[]}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {salesAmt,av12x,sales}
  team: { calls:0, talk:0, av:0, leads:0, sold:0 },
  overrides: { calls:null, av:null },
  ytd: [],                     // [{name,email,av}]
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

      <!-- AOTW / Agent profile mount -->
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

  // overrides (file names as in repo root /public)
  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

async function refreshCalls(){
  // We still pull Ringy for KPI safety; roster prefers overrides.
  let teamCalls=0, teamTalk=0;
  try{
    const payload = await getJSON("/api/calls_diag?days=7&limit=5000");
    const rows = (payload.records || payload.data || []).filter(Boolean);
    const [start,end] = weekRangeET();

    for (const r of rows){
      const when = toET((r.callStartDate || r.dateRecorded || "").replace(" ","T")+"Z");
      if (when >= start && when < end){
        teamCalls += 1;
        const sec = r.duration ?? r.callDuration ?? r.talk_time_seconds ?? 0;
        teamTalk  += Number(sec)/60;
      }
    }
  }catch(e){ log("calls pull error", e?.message||e); }

  // Build per-agent map from overrides (preferred)
  const byKey = new Map();
  const hasOverride = !!STATE.overrides.calls && typeof STATE.overrides.calls === "object";
  if (hasOverride){
    let sumC=0, sumT=0, sumLeads=0, sumSold=0;
    for (const a of STATE.roster){
      const o = STATE.overrides.calls[a.email];
      if (!o) continue;
      const row = {
        calls    : Number(o.calls||0),
        talkMin  : Number(o.talkMin||0),
        loggedMin: Number(o.loggedMin||0),
        leads    : Number(o.leads||0),
        sold     : Number(o.sold||0)
      };
      byKey.set(agentKey(a), row);
      sumC     += row.calls;
      sumT     += row.talkMin;
      sumLeads += row.leads;
      sumSold  += row.sold;
    }
    // Team tiles mirror override when present
    STATE.team.calls = sumC;
    STATE.team.talk  = sumT;
    STATE.team.leads = sumLeads;
    STATE.team.sold  = sumSold;
  } else {
    STATE.team.calls = teamCalls;
    STATE.team.talk  = teamTalk;
  }

  STATE.callsWeekByKey = byKey;
}

// ---------- Pull TEAM sales (per agent) from Netlify function ----------
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    // Build: agent name -> { salesAmt, av12x, sales }
    const mapByName = new Map();
    (payload.perAgent || []).forEach(a => {
      mapByName.set(String(a.name || "").trim().toLowerCase(), {
        salesAmt: Number(a.amount || 0),
        av12x   : Number(a.av12x || 0),
        sales   : Number(a.sales || 0),
      });
    });

    // Project to roster keys (match by name)
    const out = new Map();
    for (const a of STATE.roster){
      const nameKey = String(a.name || "").trim().toLowerCase();
      const v = mapByName.get(nameKey) || { salesAmt:0, av12x:0, sales:0 };
      out.set(agentKey(a), v);
    }

    // Weekly AV override (email -> amount) still wins if present
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

    // sale pop (best-effort) from most recent item
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
  }catch(e){
    log("team_sold error", e?.message || e);
  }
}

// ---------------- Derived ----------------
function bestOfWeek(){
  // choose by AV first, then by sales count as tiebreaker, then by total sales amount
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

function getAgentByNameCaseInsensitive(name){
  const needle = String(name||"").trim().toLowerCase();
  if (!needle) return null;
  return STATE.roster.find(r => String(r.name||"").trim().toLowerCase() === needle) || null;
}

// ---------------- Renderers ----------------
function renderKPIs(){
  const { calls, talk, av } = STATE.team;
  const elC = $("#kpi-calls"), elT = $("#kpi-talk"), elA = $("#kpi-av");
  if (elC) elC.textContent = fmtInt(calls);
  if (elT) elT.textContent = fmtInt(Math.round(talk));
  if (elA) elA.textContent = fmtMoney(av);
}

function setHead(cols){
  $("#thead").innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setRows(rows){
  $("#tbody").innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

// ---- Standard boards
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

  // Click to open agent detail
  $("#tbody").querySelectorAll("tr[data-agent]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const n = tr.getAttribute("data-agent");
      openAgentDetail(n);
    });
  });
}

function renderYTD(){
  showHero(false);
  setLabel("YTD — Leaderboard (AV)");
  setHead(["Agent","YTD AV"]);
  const byName  = new Map(STATE.roster.map(r=>[String(r.name||"").trim().toLowerCase(), r]));
  const byEmail = new Map(STATE.roster.map(r=>[String(r.email||"").trim().toLowerCase(), r]));
  const rows = STATE.ytd
    .map(it=>{
      const name  = String(it.name||"").trim();
      const email = String(it.email||"").trim().toLowerCase();
      const av    = Number(String(it.av||0).toString().replace(/[^\d.]/g,""))||0;
      const match = (email && byEmail.get(email)) || byName.get(name.toLowerCase());
      const a = match || { name, photo:"" };
      return { a, val: av };
    })
    .sort((x,y)=> (y.val)-(x.val))
    .map(({a,val})=> [avatarCell(a), fmtMoney(val)]);
  setRows(rows);
}

function renderVendorBoard(){
  showHero(false);
  setLabel("% of Sales by Lead Vendor");
  const thead = document.getElementById("thead");
  if (thead) thead.innerHTML = "";
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `
    <tr>
      <td style="padding:16px" colspan="2">
        <img
          src="/boards/sales_by_vendor.png"
          alt="% of Sales by Lead Vendor"
          style="display:block;margin:0 auto;max-width:100%;height:auto;border-radius:12px;box-shadow:0 0 0 1px #24313f"
        />
      </td>
    </tr>
  `;
}

// ---- AOTW (Agent of the Week)
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

  // Hide table/header in hero view
  setLabel("Agent of the Week");
  setHead([]);
  setRows([]);

  const btn = $("#hero .aotw-btn");
  if (btn){
    btn.addEventListener("click",()=> openAgentDetail(a.name));
  }
}

function avatarBlock(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  return src
    ? `<img class="hero-avatar" src="${src}" alt="${escapeHtml(a.name)}" onerror="this.remove();">`
    : `<div class="hero-fallback">${initials(a.name)}</div>`;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function showHero(show, html=""){
  const hero = $("#hero");
  hero.style.display = show ? "block" : "none";
  hero.innerHTML = show ? html : "";
}

// ---- Agent detail (weekly)
function openAgentDetail(name){
  const agent = getAgentByNameCaseInsensitive(name);
  if (!agent){ alert("Agent not found."); return; }
  const k = agentKey(agent);
  const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, salesAmt:0 };

  showHero(true, `
    <div class="profile">
      <div class="profile-photo">${avatarBlock(agent)}</div>
      <div class="profile-body">
        <div class="profile-name">${escapeHtml(agent.name)}</div>
        <div class="profile-metrics">
          <div><span class="k">Deals</span><span class="v">${fmtInt(s.sales||0)}</span></div>
          <div><span class="k">Total Sales</span><span class="v">${fmtMoney(s.salesAmt||0)}</span></div>
          <div><span class="k">Submitted AV</span><span class="v gold">${fmtMoney(s.av12x||0)}</span></div>
        </div>
        <button class="aotw-btn" onclick="history.back()">← Back</button>
      </div>
    </div>
  `);
  setLabel("Agent Profile — This Week");
  setHead([]);
  setRows([]);
}

// ---------------- Sale toast ----------------
function showSalePop({ name, product, amount }){
  const el = $("#salePop"); if (!el) return;
  el.textContent = `🔥 ${name || "Team"} sold ${product || "Product"} — ${fmtMoney(amount)}`;
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 7000);
}

// ---------------- Boot ----------------
async function boot(){
  ensureUI();
  await loadStatic();
  await Promise.all([refreshCalls(), refreshSales()]);
  renderCurrent();

  setInterval(async ()=>{
    await Promise.all([refreshCalls(), refreshSales()]);
    renderCurrent();
  }, DATA_MS);

  setInterval(()=>{
    viewIdx = (viewIdx + 1) % VIEWS.length;
    renderCurrent();
  }, ROTATE_MS);
}

function renderCurrent(){
  // URL overrides (no rotation if present)
  if (VIEW_OVERRIDE === "aotw") return renderAOTW();
  if (VIEW_OVERRIDE === "agent" && AGENT_QS_NAME) return openAgentDetail(AGENT_QS_NAME);

  renderKPIs();
  const v = VIEWS[viewIdx];
  if (v === "av")     return renderWeekAV();
  if (v === "ytd")    return renderYTD();
  if (v === "vendor") return renderVendorBoard();
  if (v === "aotw")   return renderAOTW();
  return renderRoster();
}

window.addEventListener("DOMContentLoaded", boot);

// ------------ styles (incl. black & gold hero) ------------
const CSS = `
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

/* Leader glow */
.leader .agent{position:relative}
.leader .agent span{ animation: leaderGlow 1.8s ease-in-out infinite alternate; text-shadow: 0 0 6px #ffd166, 0 0 12px #ffd166; }
@keyframes leaderGlow{ from{ text-shadow:0 0 4px #ffe08a, 0 0 10px #ffd166; } to{ text-shadow:0 0 10px #ffe08a, 0 0 20px #ffd166; } }

/* HERO (black & gold) */
.hero{ margin-top:10px; }
.aotw-badge{
  display:inline-block; padding:6px 12px; border:1px solid #6b5b2b;
  color:#e9d99a; background:linear-gradient(180deg,#1a1406,#0e0a03);
  border-radius:999px; letter-spacing:.06em; font-weight:800; font-size:12px;
  box-shadow:0 0 0 1px #2b230a inset, 0 6px 18px rgba(0,0,0,.35);
}
.aotw-card, .profile{
  display:grid; grid-template-columns:160px 1fr; gap:16px;
  background:radial-gradient(120% 140% at 60% 0%,#1b1709 0%,#0b0a06 55%,#090806 100%);
  border:1px solid #3b2f10; border-radius:16px; padding:16px;
  box-shadow:0 12px 30px rgba(0,0,0,.35), inset 0 0 0 1px #2a210a;
}
.hero-avatar, .hero-fallback{
  width:160px; height:160px; border-radius:12px; object-fit:cover;
  background:#1f2a3a; display:grid; place-items:center; font-size:38px; color:#d9e2ef;
  border:1px solid #342a10; box-shadow:inset 0 0 0 1px #4b3a0f;
}
.hero-fallback{ font-weight:800; }
.aotw-name, .profile-name{
  font-size:34px; font-weight:900; color:#ffeaa7; letter-spacing:.02em; margin-bottom:8px;
  text-shadow:0 0 18px rgba(255,210,90,.25);
}
.aotw-metrics, .profile-metrics{
  display:grid; grid-template-columns:repeat(3, minmax(120px,1fr)); gap:12px; margin:10px 0 6px;
}
.m, .profile-metrics > div{
  background:rgba(0,0,0,.35); border:1px solid #2d230e; border-radius:12px; padding:10px;
}
.k{ color:#a5976a; font-size:12px; }
.v{ color:#e6d7a3; font-weight:900; font-size:22px; }
.v.highlight, .gold{ color:#ffd66b; text-shadow:0 0 10px rgba(255,214,107,.25); }
.aotw-btn{
  margin-top:8px; padding:10px 14px; border-radius:10px; border:1px solid #4a3a12;
  background:linear-gradient(180deg,#2c210a,#1a1407); color:#fce59c; font-weight:800; cursor:pointer;
}
.aotw-btn:hover{ filter:brightness(1.08); }
`;
(() => { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); })();

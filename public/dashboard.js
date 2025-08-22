// ============ FEW Dashboard — FULL REPLACEMENT ============
// Rotation: AV (week) → YTD AV → Vendor Chart → Roster

const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

// ---- Config ----
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                      // refresh cadence
const ROTATE_MS = 30_000;                      // rotate views
const VIEWS     = ["av", "ytd", "vendor", "roster"]; // rotation sequence
let   viewIdx   = 0;

// ---- Utils ----
const $  = s => document.querySelector(s);
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
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
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin}
  salesWeekByKey: new Map(),   // key -> {salesAmt,av12x}
  team: { calls:0, talk:0, av:0 },
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
    for (const a of STATE.roster){
      const o = STATE.overrides.calls[a.email];
      if (!o) continue;
      byKey.set(agentKey(a), {
        calls    : Number(o.calls||0),
        talkMin  : Number(o.talkMin||0),
        loggedMin: Number(o.loggedMin||0)
      });
    }
    // Team tiles mirror override when present
    let sumC=0, sumT=0;
    for (const v of byKey.values()){ sumC+=v.calls; sumT+=v.talkMin; }
    STATE.team.calls = sumC;
    STATE.team.talk  = sumT;
  } else {
    STATE.team.calls = teamCalls;
    STATE.team.talk  = teamTalk;
  }

  STATE.callsWeekByKey = byKey;
}

async function refreshSales(){
  try{
    const payload = await getJSON("/api/sales_diag?days=30&limit=2000");
    const rows = (payload.records || payload.data || []).filter(Boolean);
    const [start,end] = weekRangeET();

    // roll up by owner
    const rawBy = new Map();
    let teamAV = 0;
    for (const r of rows){
      const when = toET((r.dateSold||"").replace(" ","T")+"Z");
      if (!(when >= start && when < end)) continue;
      const amt = Number(r.amount||0);
      teamAV += amt * 12;

      const key = String(r.ownerEmail || r.ownerName || "").trim().toLowerCase();
      if (!key) continue;
      const cur = rawBy.get(key) || { salesAmt:0, av12x:0 };
      cur.salesAmt += amt;
      cur.av12x    += amt*12;
      rawBy.set(key, cur);
    }

    // Project to roster keys
    const out = new Map();
    for (const a of STATE.roster){
      const emailKey = a.email;
      const nameKey  = String(a.name||"").trim().toLowerCase();
      const v = rawBy.get(emailKey) || rawBy.get(nameKey) || { salesAmt:0, av12x:0 };
      out.set(agentKey(a), v);
    }

    // Apply weekly AV override (email -> amount)
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      let sum = 0;
      for (const a of STATE.roster){
        const val = Number(STATE.overrides.av[a.email] || 0);
        if (val >= 0){
          const k = agentKey(a);
          const cur = out.get(k) || { salesAmt:0, av12x:0 };
          cur.av12x = val;      // override weekly AV
          out.set(k, cur);
          sum += val;
        }
      }
      teamAV = sum; // KPI mirrors override when present
    }

    STATE.salesWeekByKey = out;
    STATE.team.av        = teamAV;

    // sale pop (best-effort)
    const last = rows[rows.length-1];
    if (last){
      const h = `${last.leadId}|${last.soldProductId}|${last.dateSold}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        showSalePop({ name: last.ownerName || last.ownerEmail || "Team",
                      product: last.soldProductName || "Product",
                      amount: last.amount || 0 });
      }
    }
  }catch(e){ log("sales error", e?.message||e); }
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

function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk Time (min)","Logged (h:mm)","Submitted AV"]);

  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const c = STATE.callsWeekByKey.get(k) || { calls:0, talkMin:0, loggedMin:0 };
    const s = STATE.salesWeekByKey.get(k) || { salesAmt:0, av12x:0 };
    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtMoney(s.av12x)
    ];
  });
  setRows(rows);
}

// ===== AV Leaderboard with glow/sparkle & 💩 for zero =====
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

  const tbody = $("#tbody");
  if (!ranked.length){
    tbody.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
    return;
  }
  let html = "";
  ranked.forEach(({a,val}, i)=>{
    const leader = (i === 0 && val > 0) ? ' class="leader"' : "";
    const poop   = val === 0 ? ' <span class="poop" title="No AV this week">💩</span>' : "";
    html += `<tr${leader}><td>${avatarCell(a)}</td><td class="num">${fmtMoney(val)}${poop}</td></tr>`;
  });
  tbody.innerHTML = html;
}

function renderYTD(){
  setLabel("YTD — Leaderboard (AV)");
  setHead(["Agent","YTD AV"]);
  // Crosswalk to roster for headshots if possible
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

// ===== Image Board: % of Sales by Lead Vendor =====
function renderVendorBoard(){
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

function renderCurrent(){
  renderKPIs();
  const v = VIEWS[viewIdx];
  if (v === "av")     return renderWeekAV();
  if (v === "ytd")    return renderYTD();
  if (v === "vendor") return renderVendorBoard();
  return renderRoster();
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

window.addEventListener("DOMContentLoaded", boot);

// ------------ tiny fallback styles ------------
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

/* Leader glow/sparkle on AV leaderboard */
.leader .agent{position:relative}
.leader .agent span{
  animation: leaderGlow 1.8s ease-in-out infinite alternate;
  text-shadow: 0 0 6px #ffd166, 0 0 12px #ffd166;
}
.leader .agent::after{
  content:'✨';
  position:absolute;
  right:-18px;
  top:50%;
  transform:translateY(-50%);
  filter:drop-shadow(0 0 6px #ffd166);
  animation: sparkle 1.2s ease-in-out infinite;
  opacity:.95;
}

/* 💩 for zero AV */
.poop{font-size:18px;margin-left:6px;filter:drop-shadow(0 0 3px #000)}
@keyframes leaderGlow{
  from{ text-shadow:0 0 4px #ffe08a, 0 0 10px #ffd166; }
  to  { text-shadow:0 0 10px #ffe08a, 0 0 20px #ffd166; }
}
@keyframes sparkle{
  0%  { transform:translateY(-50%) scale(1) rotate(0deg);   opacity:.7; }
  50% { transform:translateY(-50%) scale(1.2) rotate(20deg); opacity:1;  }
  100%{ transform:translateY(-50%) scale(1) rotate(0deg);   opacity:.7; }
}
`;
(() => { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); })();

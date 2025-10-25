/* public/dashboard.js  — ONE FILE DROP-IN
   Rotates 4+ boards, pulls APIs, shows rule-of-day, headshots, sale splash.
   Requires no HTML changes beyond index.html already pointing at this file.
*/

/* =============== CONFIG =============== */
const ROTATE_MS = 20000;                    // time each board is on screen
const SALE_SPLASH_MS = 60000;               // sale splash hold time (60s)
const TIMEZONE = "America/New_York";        // for date windows
const HEADSHOTS_PATHS = ["jpg", "png"];     // file extensions to try
const HEADSHOT_OVERRIDES = {
  // Add special-case filename overrides here if needed:
  // "fabricio navarrete": "fabricio-navarrete-cervantes",
};
const VENDOR_COLORS = [
  "#ffd36a","#8bd3dd","#f28b82","#a7d28d","#c58af9","#7ac6ff",
  "#ffad69","#7bdcb5","#d2a7ff","#ff7aa2","#9ad47a","#7aa6ff"
];

/* =============== DOM HOOKS =============== */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const elTicker   = $("#ticker");
const elTitle    = $(".title");
const elSub      = $("#principle");
const elView     = $("#viewLabel");
const elThead    = $("#thead");
const elTbody    = $("#tbody");
const elSumCalls = $("#sumCalls");
const elSumSales = $("#sumSales");
const elSumTalk  = $("#sumTalk");
const salePop    = $("#salePop");

/* =============== HELPERS =============== */
const pad2 = n => String(n).padStart(2,"0");
const money = (n) => {
  const v = Math.round(Number(n||0));
  return v.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
};
const fmtInt = n => Number(n||0).toLocaleString("en-US");
const fmtPct = n => `${Math.round(n*100)}%`;

function utcDateRangeThisWeek() {
  // week window Sun 00:00 -> next Sun 00:00 in ET
  const now = new Date();
  // build ET now
  const et = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const day = et.getDay(); // 0 = Sun
  const start = new Date(et); start.setHours(0,0,0,0); start.setDate(start.getDate()-day);
  const end = new Date(start); end.setDate(start.getDate()+7);
  // Return as UTC strings "YYYY-MM-DD HH:mm:ss"
  const toUtcStr = d => {
    const utc = new Date(d.getTime() - (new Date().getTimezoneOffset()*60000)); // local->UTC baseline
    // But start/end are built already in ET; convert to UTC string
    const s = new Date(d.toLocaleString("en-US",{timeZone:"UTC"}));
    const Y=s.getUTCFullYear(), M=pad2(s.getUTCMonth()+1), D=pad2(s.getUTCDate());
    const h=pad2(s.getUTCHours()), m=pad2(s.getUTCMinutes()), sec=pad2(s.getUTCSeconds());
    return `${Y}-${M}-${D} ${h}:${m}:${sec}`;
  };
  return { start: toUtcStr(start), end: toUtcStr(end) };
}

async function getJSON(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}
async function tryJSON(url, opt){
  try { return await getJSON(url,opt); } catch { return null; }
}

function setCards({calls=0, totalSales=0, deals=0}) {
  elSumCalls.textContent = fmtInt(calls);
  elSumSales.textContent = money(totalSales);
  elSumTalk.textContent  = fmtInt(deals);
}

function slugName(name){
  if (!name) return "";
  const base = name.trim().toLowerCase();
  const over = HEADSHOT_OVERRIDES[base];
  const s = (over || base)
    .replace(/[^\p{L}\p{N}\s.-]/gu,"")
    .replace(/\s+/g,"-")
    .replace(/-+/g,"-");
  return s;
}
function avatarCell(name){
  const slug = slugName(name);
  const span = document.createElement("span");
  span.className = "avatar-fallback";
  span.textContent = name.split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();

  const wrap = document.createElement("span");
  wrap.className = "agent";
  if (slug){
    const img = document.createElement("img");
    img.className = "avatar";
    img.alt = `${name} headshot`;
    let tried = 0;
    function setNext(){
      if (tried >= HEADSHOTS_PATHS.length){ wrap.prepend(span); return; }
      img.src = `./headshots/${slug}.${HEADSHOTS_PATHS[tried++]}`;
    }
    img.onerror = setNext;
    img.onload  = ()=> {};
    setNext();
    wrap.append(img);
  } else {
    wrap.append(span);
  }
  const nm = document.createElement("span");
  nm.textContent = name || "—";
  wrap.append(nm);
  return wrap.outerHTML;
}

function setTitle(label){ elView.textContent = label; }

/* =============== DATA FETCH =============== */
let cacheSold = null;
let cacheCalls = null;
let cacheVendors = null;
let cacheYTD = null;
let cacheYTDTotal = null;
let cachePAR = null;

async function loadSold() {
  const {start,end} = utcDateRangeThisWeek();
  const u = `/api/team_sold?d=${Date.now()}`;
  const j = await getJSON(u);
  // expect: { team:{ totalSales, totalAmount, totalAV12x }, perAgent:[{name,sales,amount,av12x}], allSales:[{agent, amount, dateSold, soldProductName}] }
  cacheSold = j || {team:{totalSales:0,totalAmount:0,totalAV12x:0}, perAgent:[], allSales:[]};
  return cacheSold;
}

async function loadCalls() {
  const u = `/api/calls_by_agent?d=${Date.now()}`;
  cacheCalls = await tryJSON(u) || {team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0}, perAgent:[]};
  return cacheCalls;
}

async function loadVendors() {
  // Try API route; if missing envs, fallback to static JSON
  cacheVendors = await tryJSON(`/api/sales_by_vendor?d=${Date.now()}`);
  if (!cacheVendors) cacheVendors = await tryJSON(`/public/sales_by_vendor.json`);
  return cacheVendors||{vendors:[],window_days:45};
}

async function loadYTD() {
  cacheYTD = await tryJSON(`/public/ytd_av.json`) || { agents:[] };
  cacheYTDTotal = await tryJSON(`/public/ytd_total.json`) || { total: 0 };
  return { cacheYTD, cacheYTDTotal };
}

async function loadPAR() {
  // optional; only if you add /public/par.json: { people:[{name, amount}, ...] }
  cachePAR = await tryJSON(`/public/par.json`) || null;
  return cachePAR;
}

/* =============== RULE OF THE DAY =============== */
async function setRuleOfDay(){
  const rules = await tryJSON(`/public/rules.json`) || { rules: [] };
  if (!rules.rules || !rules.rules.length){
    elTicker.textContent = "RULE OF THE DAY — …";
    return;
  }
  // rotate every 12 hours in ET
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US",{timeZone:TIMEZONE}));
  const index = Math.floor(etNow.getTime()/(12*60*60*1000)) % rules.rules.length;
  const text = String(rules.rules[index]||"").trim();
  elTicker.textContent = `RULE OF THE DAY — ${text||"…"}`;
}

/* =============== SALE SPLASH (centered) =============== */
let lastSeenSaleIds = new Set();
function primeSeenSales(allSales){
  allSales.forEach(s => lastSeenSaleIds.add(s.leadId||`${s.agent}|${s.amount}|${s.dateSold}`));
}
function showSaleSplash(agent, amount12x){
  // Repurpose #salePop as big centered pill
  Object.assign(salePop.style, {
    position: "fixed",
    left:"50%", top:"50%",
    transform:"translate(-50%,-50%)",
    borderRadius:"20px",
    padding:"22px 28px",
    fontSize:"22px", fontWeight:"800",
    color:"#ffeab5", background:"rgba(23,26,7,.95)",
    border:"2px solid #ffd36a",
    boxShadow:"0 20px 60px rgba(0,0,0,.55)",
    zIndex:"9999", opacity:"1", display:"block", textAlign:"center"
  });
  salePop.innerHTML = `
    <div style="font-size:14px; letter-spacing:.12em; color:#9b8a4b; margin-bottom:6px;">NEW SALE</div>
    <div style="font-size:28px; color:#fff6d2; margin-bottom:8px;">${agent}</div>
    <div style="font-size:24px; color:#ffd36a;">${money(amount12x)}</div>
  `;
  setTimeout(()=>{ salePop.style.display="none"; }, SALE_SPLASH_MS);
}
function diffAndSplash(allSales){
  for (const s of allSales||[]){
    const id = s.leadId || `${s.agent}|${s.amount}|${s.dateSold}`;
    if (!lastSeenSaleIds.has(id)){
      lastSeenSaleIds.add(id);
      const av12 = Number(s.amount||0)*12;    // display AV 12× but do NOT show “×12” text
      showSaleSplash(s.agent||"New Sale", av12);
    }
  }
}

/* =============== RENDERERS =============== */
function renderRoster(sold){
  setTitle("This Week — Roster");
  elThead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12×)</th>
    </tr>`;
  if (!sold.perAgent?.length){
    elTbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading roster or no sales yet.</td></tr>`;
    return;
  }
  const rows = sold.perAgent
    .slice()
    .sort((a,b)=> (b.av12x||0)-(a.av12x||0))
    .map(a=>`
      <tr>
        <td class="agent">${avatarCell(a.name||"")}</td>
        <td class="num">${fmtInt(a.sales||0)}</td>
        <td class="num">${money(Math.round((a.amount||0)*12))}</td>
      </tr>
    `).join("");
  elTbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
}

function renderAotW(sold, ytd){
  setTitle("Agent of the Week");
  const leader = (sold.perAgent||[]).slice().sort((a,b)=> (b.amount||0)-(a.amount||0))[0];
  elThead.innerHTML = `
    <tr>
      <th>Leading for Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12×)</th>
    </tr>`;
  if (!leader){
    elTbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No leader yet.</td></tr>`;
    return;
  }
  const name = leader.name||"";
  const big = `
    <div class="agent" style="gap:14px">
      <span class="avatar-fallback" style="width:56px;height:56px;font-size:18px;line-height:56px">${name.split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase()}</span>
      <span style="font-size:22px;font-weight:800">${name}</span>
    </div>
  `;
  // Try real headshot by replacing the span in HTML string
  const tmp = document.createElement("div"); tmp.innerHTML = big;
  const af = tmp.querySelector(".avatar-fallback");
  const slug = slugName(name);
  if (slug){
    const img = document.createElement("img");
    img.className="avatar"; img.style.width="56px"; img.style.height="56px";
    let i=0; img.onerror = ()=>{ if (++i<HEADSHOTS_PATHS.length) img.src=`./headshots/${slug}.${HEADSHOTS_PATHS[i]}`; };
    img.src = `./headshots/${slug}.${HEADSHOTS_PATHS[i]}`;
    af.replaceWith(img);
  }
  // YTD add-on (if you provided ytd_av.json)
  let ytdLine = "";
  if (ytd?.agents?.length){
    const hit = ytd.agents.find(a => (a.name||"").toLowerCase() === name.toLowerCase());
    if (hit){ ytdLine = `<div style="margin-top:8px;color:#9fb0c8">YTD AV: <b>${money(hit.amount || 0)}</b></div>`; }
  }
  elTbody.innerHTML = `
    <tr>
      <td>${tmp.innerHTML}${ytdLine}</td>
      <td class="num">${fmtInt(leader.sales||0)}</td>
      <td class="num">${money(Math.round((leader.amount||0)*12))}</td>
    </tr>
  `;
}

function donutSVG(parts){
  const total = parts.reduce((s,p)=>s+p.value,0) || 1;
  let angle = -90;
  const r=80, c=100, w=18;
  const arcs = parts.map((p,i)=>{
    const frac = p.value/total;
    const a2 = angle + frac*360;
    const large = (a2-angle)>180 ? 1:0;
    const x1 = c + r*Math.cos(angle*Math.PI/180);
    const y1 = c + r*Math.sin(angle*Math.PI/180);
    const x2 = c + r*Math.cos(a2*Math.PI/180);
    const y2 = c + r*Math.sin(a2*Math.PI/180);
    angle = a2;
    return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}" stroke="${VENDOR_COLORS[i%VENDOR_COLORS.length]}" stroke-width="${w}" fill="none"/>`;
  }).join("");
  return `<svg width="220" height="220" viewBox="0 0 200 200" style="display:block;margin:14px auto">
    <circle cx="100" cy="100" r="${r}" stroke="#1e2838" stroke-width="${w}" fill="none"/>
    ${arcs}
    <circle cx="100" cy="100" r="${r- w/2}" fill="transparent"/>
  </svg>`;
}

function renderVendors(vendors){
  setTitle(`Lead Vendors — % of Sales (Last ${vendors.window_days||45} days)`);
  elThead.innerHTML = `
    <tr>
      <th>Vendor</th>
      <th style="text-align:right">Deals</th>
      <th style="text-align:right">% of total</th>
    </tr>`;
  const list = (vendors.vendors||[]).slice().sort((a,b)=> (b.deals||0)-(a.deals||0));
  const total = list.reduce((s,v)=>s+(v.deals||0),0);
  if (!list.length){
    elTbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
    return;
  }
  const rows = list.map((v,i)=>`
    <tr>
      <td><span style="display:inline-block;width:10px;height:10px;background:${VENDOR_COLORS[i%VENDOR_COLORS.length]};border-radius:2px;margin-right:8px"></span>${v.name||"Unknown"}</td>
      <td class="num">${fmtInt(v.deals||0)}</td>
      <td class="num">${fmtPct((v.deals||0)/(total||1))}</td>
    </tr>
  `).join("");
  const donut = donutSVG(list.map((v,i)=>({ label:v.name, value:Number(v.deals||0) })));
  elTbody.innerHTML = `<tr><td colspan="3">${donut}</td></tr>${rows}`;
}

function renderActivity(calls, sold){
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
  // Build a name->row map from calls, then merge sellers from sold
  const map = new Map();
  (calls.perAgent||[]).forEach(a=>{
    map.set(a.name||"", {
      name:a.name||"",
      calls: a.calls||0,
      talkMin: a.talkMin||0,
      loggedMin: a.loggedMin||0,
      leads: a.leads||0,
      sold: a.sold||0
    });
  });
  (sold.perAgent||[]).forEach(s=>{
    const r = map.get(s.name||"") || {name:s.name||"",calls:0,talkMin:0,loggedMin:0,leads:0,sold:0};
    r.sold = Number(r.sold||0) + Number(s.sales||0);
    map.set(r.name, r);
  });
  const rows = Array.from(map.values())
    .sort((a,b)=> (b.calls||0)-(a.calls||0))
    .map(a=>{
      const conv = (a.leads>0) ? (a.sold/a.leads) : 0;
      const h = Math.floor((a.loggedMin||0)/60), m = Math.round((a.loggedMin||0)%60);
      return `
        <tr>
          <td class="agent">${avatarCell(a.name||"")}</td>
          <td class="num">${fmtInt(a.calls||0)}</td>
          <td class="num">${fmtInt(a.talkMin||0)}</td>
          <td class="num">${h}:${pad2(m)}</td>
          <td class="num">${fmtInt(a.leads||0)}</td>
          <td class="num">${fmtInt(a.sold||0)}</td>
          <td class="num">${fmtPct(isFinite(conv)?conv:0)}</td>
        </tr>`;
    }).join("");

  elTbody.innerHTML = rows || `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;
}

function renderYTD(ytd, total){
  setTitle("YTD AV (override)");
  elThead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">YTD AV</th>
    </tr>`;
  const list = (ytd.agents||[]).slice().sort((a,b)=> (b.amount||0)-(a.amount||0));
  if (!list.length){
    elTbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No YTD data provided.</td></tr>`;
    return;
  }
  const rows = list.map(a=>`
    <tr>
      <td class="agent">${avatarCell(a.name||"")}</td>
      <td class="num">${money(a.amount||0)}</td>
    </tr>`).join("");
  const tot = money((total&&total.total)||list.reduce((s,a)=>s+(a.amount||0),0));
  elTbody.innerHTML = `${rows}<tr><td style="text-align:right;font-weight:800">Team Total:</td><td class="num" style="font-weight:800">${tot}</td></tr>`;
}

function renderPAR(par){
  setTitle("PAR — Qualifiers");
  elThead.innerHTML = `
    <tr><th>Agent</th><th style="text-align:right">Potential Bonus</th></tr>`;
  if (!par?.people?.length){
    elTbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No PAR data available.</td></tr>`;
    return;
  }
  const rows = par.people.map(p=>`
    <tr>
      <td class="agent">${avatarCell(p.name||"")}</td>
      <td class="num">${money(p.amount||0)}</td>
    </tr>`).join("");
  elTbody.innerHTML = rows;
}

/* =============== ROTATION =============== */
let boards = [];  // filled in after first load
let boardIdx = 0;
let rotateTimer = null;

function rotate(){
  clearTimeout(rotateTimer);
  if (!boards.length){ rotateTimer = setTimeout(rotate, ROTATE_MS); return; }
  const b = boards[boardIdx % boards.length]; boardIdx++;
  try { b.render(); } catch(e){ console.error(e); }
  rotateTimer = setTimeout(rotate, ROTATE_MS);
}

/* =============== BOOT =============== */
async function boot(){
  // Banner stays constant
  elTitle.textContent = "THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT";
  elSub.textContent   = "Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.";

  // Rule of day now + every 10 minutes
  await setRuleOfDay(); setInterval(setRuleOfDay, 10*60*1000);

  // Load everything we can
  const [sold, calls, vendors, _ytd, _par] = await Promise.all([
    loadSold(), loadCalls(), loadVendors(), loadYTD(), loadPAR()
  ]);
  setCards({
    calls: calls?.team?.calls || 0,
    totalSales: sold?.team?.totalAV12x || 0,
    deals: sold?.team?.totalSales || 0
  });

  primeSeenSales(sold?.allSales||[]);
  // After boot, poll sales every 30s to catch new submissions and splash
  setInterval(async ()=>{
    try{
      const s = await loadSold();
      setCards({
        calls: cacheCalls?.team?.calls || 0,
        totalSales: s?.team?.totalAV12x || 0,
        deals: s?.team?.totalSales || 0
      });
      diffAndSplash(s?.allSales||[]);
    }catch(e){}
  }, 30000);

  // Build boards list (optional boards included only if data exists)
  boards = [
    { key:"roster", render: ()=> renderRoster(cacheSold) },
    { key:"aotw",   render: ()=> renderAotW(cacheSold, cacheYTD) },
    { key:"vendors",render: ()=> renderVendors(cacheVendors||{vendors:[],window_days:45}) },
    { key:"activity",render: ()=> renderActivity(cacheCalls||{team:{},perAgent:[]}, cacheSold||{perAgent:[]}) },
  ];
  if (cacheYTD?.agents?.length) boards.push({ key:"ytd", render: ()=> renderYTD(cacheYTD, cacheYTDTotal) });
  if (cachePAR?.people?.length) boards.push({ key:"par", render: ()=> renderPAR(cachePAR) });

  // Start rotation
  rotate();
}

document.addEventListener("DOMContentLoaded", boot);

/* public/dashboard.js
   FEW Dashboard — single-file app
   Boards:
    1) Weekly Submitted AV (Roster)
    2) Agent of the Week
    3) Lead Vendors — % of Sales (last 45 days)
    4) Agent Activity (this week)
    5) YTD AV (override files)
    6) PAR
*/

/* ---------- helpers ---------- */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const fmtInt  = n => Number(n||0).toLocaleString("en-US");
const fmtMoney= n => "$" + Number(n||0).toLocaleString("en-US");
const pad2    = n => String(n).padStart(2,"0");

/* request with gentle fallback */
async function getJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function tryGetJSON(primary, fallback){
  try{ return await getJSON(primary); }
  catch(_){ if (fallback) return getJSON(fallback); throw _; }
}

/* load static repo files */
const loadStatic = path => getJSON(path + (path.includes("?")?"":"?v="+Date.now()));

/* today’s ET (used for windows) */
const ET_TZ = "America/New_York";
function weekWindowET(){
  const now = new Date();
  const nowET = new Intl.DateTimeFormat('en-US',{timeZone:ET_TZ, hour12:false,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
  }).formatToParts(now).reduce((a,p)=>{a[p.type]=p.value;return a;},{});
  // Start: previous Friday 8pm ET? Your API already handles the correct window; we keep it simple.
  return { start: null, end: null };
}

/* initials helper */
function initialsFromName(name=""){
  return name.split(/\s+/).filter(Boolean).map(w=>w[0]).slice(0,2).join("").toUpperCase() || "??";
}

/* mount points (already in index.html) */
const thead = $("#thead");
const tbody = $("#tbody");
const viewLabel = $("#viewLabel");
const sumCalls = $("#sumCalls");
const sumSales = $("#sumSales");
const sumTalk  = $("#sumTalk");
const salePop  = $("#salePop");
const ticker   = $("#ticker");

/* global caches */
let ROSTER = [];      // [{ name,email,photo,phones[] }]
let HEADSHOT_URL = (fn) => `headshots/${fn}`;
let RULES = [];       // [ "text", ... ]
let RULE_TIMER = null;

/* ---------- Rule of the Day (rotates every 12 hours) ---------- */
async function startRules(){
  try{
    RULES = await loadStatic("/public/rules.json");
  }catch(_){
    RULES = [
      "Be early. Be prepared. Be relentless.",
      "No zero days.",
      "Win the morning to win the day."
    ];
  }
  function selectRule(){
    // 12-hour slot index
    const now = new Date();
    const slot = Math.floor(now.getTime() / (12*60*60*1000));
    const rule = RULES[slot % RULES.length] || "...";
    ticker.textContent = `RULE OF THE DAY — ${rule}`;
  }
  clearInterval(RULE_TIMER);
  selectRule();
  RULE_TIMER = setInterval(selectRule, 60_000); // check once a minute; slot math handles the 12h cadence
}

/* ---------- headshots ---------- */
async function loadRoster(){
  try{
    ROSTER = await loadStatic("/public/headshots/roster.json");
  }catch(_){ ROSTER = []; }
}
function findPersonByName(name=""){
  const n = (name||"").trim().toLowerCase();
  return ROSTER.find(r => (r.name||"").trim().toLowerCase() === n);
}
function avatarHTML(name, size=28){
  const person = findPersonByName(name);
  const style = `width:${size}px;height:${size}px;border-radius:50%;display:inline-block;vertical-align:middle;`;
  if (person && person.photo){
    return `<img src="${HEADSHOT_URL(person.photo)}" alt="" style="${style};object-fit:cover;background:#1b2433;border:1px solid #28344a">`;
  }
  return `<span class="avatar-fallback" style="${style};background:#1f2a3a;color:#89a2c6;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.max(12,Math.floor(size*0.42))}px;">${initialsFromName(name)}</span>`;
}

/* ---------- summary cards ---------- */
function setSummary({calls=0, av12x=0, deals=0}={}){
  sumCalls.textContent = fmtInt(calls);
  sumSales.textContent = fmtMoney(av12x);
  sumTalk.textContent  = fmtInt(deals);
}

/* ---------- new-sale splash (60s) ---------- */
let splashTimer = null;
function showSaleSplash(name, amount){
  const html = `
    <div style="
      position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
      background:rgba(8,10,14,.65);backdrop-filter:blur(3px);
    ">
      <div style="
        background:#2a250b;border:2px solid #ffd36a;box-shadow:0 10px 50px rgba(0,0,0,.6);
        padding:24px 36px;border-radius:16px;text-align:center;max-width:90vw;
      ">
        <div style="color:#ffd36a;font-size:14px;font-weight:800;letter-spacing:.08em;">NEW SALE</div>
        <div style="margin-top:8px;color:#fff5d6;font-size:34px;font-weight:900">${name}</div>
        <div style="margin-top:6px;color:#ffd36a;font-size:22px;font-weight:800">${fmtMoney(amount)}</div>
      </div>
    </div>`;
  salePop.innerHTML = html;
  salePop.classList.add("show");
  clearTimeout(splashTimer);
  splashTimer = setTimeout(()=>{ salePop.classList.remove("show"); salePop.innerHTML=""; }, 60_000);
}

/* ---------- API pulls ---------- */
// Weekly sold (this week)
async function fetchTeamSold(){
  // returns { team:{ totalSales, totalAmount, totalAV12x }, perAgent:[ {name,sales,amount,av12x} ], allSales:[{agent,amount,dateSold}] }
  return getJSON("/api/team_sold");
}
// Weekly calls/leads/etc
async function fetchCallsByAgent(){
  // returns { team:{calls,talkMin,loggedMin,leads,sold}, perAgent:[{name,email,calls,talkMin,loggedMin,leads,sold}] }
  return getJSON("/api/calls_by_agent");
}
// Vendors last 45d
async function fetchVendors(){
  // primary API, fallback to static
  return tryGetJSON("/api/sales_by_vendor", "/public/sales_by_vendor.json");
}
// YTD overrides
async function fetchYTD(){
  const av = await loadStatic("/public/ytd_av.json");
  const total = await loadStatic("/public/ytd_total.json");
  return { list: av, total };
}
// PAR board data
async function fetchPAR(){
  // You maintain file: [{ name: "Robert Adams", value: 597236 }, ...]
  return loadStatic("/public/par.json");
}

/* ---------- Board 1: Weekly Submitted AV (Roster) ---------- */
async function viewRoster(){
  setTitle("This Week — Roster");
  setTableHeader(["Agent","Sold","Submitted AV"]);
  tbody.innerHTML = rowLoading();

  const [sold, calls] = await Promise.all([
    fetchTeamSold().catch(_=>({team:{totalSales:0,totalAV12x:0}, perAgent:[], allSales:[]})),
    fetchCallsByAgent().catch(_=>({team:{calls:0}, perAgent:[]})),
  ]);

  setSummary({
    calls: (calls.team && calls.team.calls) || 0,
    av12x: (sold.team && sold.team.totalAV12x) || 0,
    deals: (sold.team && sold.team.totalSales) || 0
  });

  const per = (sold.perAgent||[]).slice().sort((a,b)=>(b.av12x||0)-(a.av12x||0));
  if (!per.length){
    tbody.innerHTML = rowEmpty("Loading roster or no sales yet.");
    return;
  }
  const rows = per.map(a => `
    <tr>
      <td>
        <div class="agent">
          ${avatarHTML(a.name, 22)}
          <span style="margin-left:10px">${esc(a.name||"")}</span>
        </div>
      </td>
      <td class="num">${fmtInt(a.sales||0)}</td>
      <td class="num">${fmtMoney(a.av12x||0)}</td>
    </tr>
  `).join("");
  tbody.innerHTML = rows;

  // show new-sale splash for the most recent sale (if provided)
  const last = (sold.allSales||[]).slice().sort((a,b)=>new Date(b.dateSold)-new Date(a.dateSold))[0];
  if (last) showSaleSplash(last.agent||"New Sale", Number(last.amount||0)*12);
}

/* ---------- Board 2: Agent of the Week ---------- */
async function viewAOTW(){
  setTitle("Agent of the Week");
  setTableHeader(["Leading for Agent of the Week","Sold","Submitted AV"]);

  tbody.innerHTML = rowLoading();

  const sold = await fetchTeamSold().catch(_=>({team:{}, perAgent:[]}));
  const per = (sold.perAgent||[]).slice().sort((a,b)=>(b.av12x||0)-(a.av12x||0));
  setSummary({
    calls:  ((await fetchCallsByAgent().catch(_=>({team:{}}))).team||{}).calls || 0,
    av12x:  (sold.team && sold.team.totalAV12x) || 0,
    deals:  (sold.team && sold.team.totalSales) || 0
  });

  if (!per.length){ tbody.innerHTML = rowEmpty("No leader yet."); return; }
  const lead = per[0];

  const row = `
    <tr>
      <td>
        <div class="agent" style="align-items:center;">
          ${avatarHTML(lead.name, 56)}
          <span style="margin-left:14px;font-size:22px;font-weight:800">${esc(lead.name||"")}</span>
        </div>
      </td>
      <td class="num" style="font-size:20px">${fmtInt(lead.sales||0)}</td>
      <td class="num" style="font-size:20px">${fmtMoney(lead.av12x||0)}</td>
    </tr>
  `;
  tbody.innerHTML = row;

  // Add YTD override line under the table
  try{
    const ytd = await fetchYTD();
    const hit = (ytd.list||[]).find(x => (x.name||"").toLowerCase() === (lead.name||"").toLowerCase());
    if (hit){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="color:#9fb0c8">YTD AV</td>
        <td></td>
        <td class="num">${fmtMoney(hit.av||0)}</td>
      `;
      tbody.appendChild(tr);
    }
  }catch(_){}
}

/* ---------- Board 3: Lead Vendors (last 45 days) ---------- */
async function viewVendors(){
  setTitle("Lead Vendors — % of Sales (Last 45 days)");
  setTableHeader(["Vendor","Deals","% of total"]);
  tbody.innerHTML = rowLoading();

  const data = await fetchVendors().catch(_=>({ vendors:[] }));
  const list = Array.isArray(data.vendors) ? data.vendors : [];
  const total = list.reduce((s,v)=>s + (v.deals||0), 0);

  if (!total){
    tbody.innerHTML = rowEmpty("No vendor chart available.");
    renderDonut([]); // clears if present
    return;
  }

  // sort desc
  list.sort((a,b)=>(b.deals||0)-(a.deals||0));

  const rows = list.map((v,i)=>`
    <tr>
      <td>${esc(v.name||"Unknown")}</td>
      <td class="num">${fmtInt(v.deals||0)}</td>
      <td class="num">${fmtPct((v.deals||0)/total)}</td>
    </tr>
  `).join("");
  tbody.innerHTML = rows;

  // donut
  renderDonut(list.map(v => ({ label: v.name||"Unknown", value: v.deals||0 })));
}

/* ---------- Board 4: Agent Activity (this week) ---------- */
async function viewActivity(){
  setTitle("Agent Activity — (This week)");
  setTableHeader(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %"]);
  tbody.innerHTML = rowLoading();

  const act = await fetchCallsByAgent().catch(_=>({team:{}, perAgent:[]}));
  const per = (act.perAgent||[]).slice();

  // ensure roster names exist even if zeros
  const names = new Set(per.map(a => (a.name||"").toLowerCase()));
  ROSTER.forEach(r=>{
    if (!names.has((r.name||"").toLowerCase())){
      per.push({ name:r.name, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 });
    }
  });

  per.sort((a,b)=>(b.calls||0)-(a.calls||0));

  if (!per.length){ tbody.innerHTML = rowEmpty("No activity reported yet."); return; }

  const rows = per.map(a=>{
    const logged = a.loggedMin||0;
    const h = Math.floor(logged/60), m = Math.floor(logged%60);
    const conv = (a.leads ? (a.sold||0)/a.leads : 0);
    return `
      <tr>
        <td><div class="agent">${avatarHTML(a.name,22)}<span style="margin-left:10px">${esc(a.name||"")}</span></div></td>
        <td class="num">${fmtInt(a.calls||0)}</td>
        <td class="num">${fmtInt(a.talkMin||0)}</td>
        <td class="num">${h}:${pad2(m)}</td>
        <td class="num">${fmtInt(a.leads||0)}</td>
        <td class="num">${fmtInt(a.sold||0)}</td>
        <td class="num">${fmtPct(conv)}</td>
      </tr>
    `;
  }).join("");
  tbody.innerHTML = rows;

  // team totals row
  const t = act.team||{};
  const logged = t.loggedMin||0; const h=Math.floor(logged/60), m=Math.floor(logged%60);
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td style="color:#9fb0c8">Team totals:</td>
    <td class="num">${fmtInt(t.calls||0)}</td>
    <td class="num">${fmtInt(t.talkMin||0)}</td>
    <td class="num">${h}:${pad2(m)}</td>
    <td class="num">${fmtInt(t.leads||0)}</td>
    <td class="num">${fmtInt(t.sold||0)}</td>
    <td class="num">${fmtPct((t.leads? (t.sold||0)/t.leads : 0))}</td>
  `;
  tbody.appendChild(tr);
}

/* ---------- Board 5: YTD AV (override) ---------- */
async function viewYTD(){
  setTitle("Year-to-Date AV");
  setTableHeader(["Agent","YTD AV"]);
  tbody.innerHTML = rowLoading();

  const { list, total } = await fetchYTD().catch(_=>({list:[], total:{}}));
  const rows = (list||[]).slice().sort((a,b)=>(b.av||0)-(a.av||0)).map(a=>`
    <tr>
      <td><div class="agent">${avatarHTML(a.name,22)}<span style="margin-left:10px">${esc(a.name||"")}</span></div></td>
      <td class="num">${fmtMoney(a.av||0)}</td>
    </tr>
  `).join("");
  tbody.innerHTML = rows || rowEmpty("No YTD data.");

  // total row
  if (total && typeof total.total === "number"){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="color:#9fb0c8">Team total</td><td class="num">${fmtMoney(total.total)}</td>`;
    tbody.appendChild(tr);
  }
}

/* ---------- Board 6: PAR ---------- */
async function viewPAR(){
  setTitle("PAR — Performance & Retention Bonus");
  setTableHeader(["Agent","Issued AV"]);
  tbody.innerHTML = rowLoading();

  const list = await fetchPAR().catch(_=>[]);
  if (!list.length){ tbody.innerHTML = rowEmpty("No PAR data."); return; }
  list.sort((a,b)=>(b.value||0)-(a.value||0));
  tbody.innerHTML = list.map(p=>`
    <tr>
      <td><div class="agent">${avatarHTML(p.name,22)}<span style="margin-left:10px">${esc(p.name||"")}</span></div></td>
      <td class="num">${fmtMoney(p.value||0)}</td>
    </tr>
  `).join("");
}

/* ---------- DOM helpers ---------- */
function setTitle(text){
  viewLabel.textContent = text;
}
function setTableHeader(cols){
  thead.innerHTML = `<tr>${cols.map((c,i)=>`<th${i>0?' style="text-align:right"':''}>${esc(c)}</th>`).join("")}</tr>`;
}
function rowLoading(){
  return `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;
}
function rowEmpty(msg){
  return `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">${esc(msg)}</td></tr>`;
}
function esc(s){ return String(s).replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }
function fmtPct(x){ return (x*100||0).toFixed(0)+"%"; }

/* ---------- Donut renderer (tiny, no libs) ---------- */
function renderDonut(pairs){
  // remove old chart if exists
  let old = $("#vendorDonutWrap");
  if (old) old.remove();

  const wrap = document.createElement("div");
  wrap.id = "vendorDonutWrap";
  wrap.style.cssText = "padding:10px 10px 0;";
  thead.parentElement.insertAdjacentElement("afterend", wrap);

  if (!pairs.length) return;

  const total = pairs.reduce((s,p)=>s+p.value,0);
  const size = 180, r = 70, cx= size/2, cy=size/2;
  let acc = 0;
  const colors = [
    "#ffb703","#8ecae6","#ffd166","#90be6d","#f4978e","#bdb2ff","#80ed99","#e9c46a","#f4a261","#48cae4"
  ];
  const arcs = pairs.map((p,i)=>{
    const val = p.value/total;
    const a0 = acc*2*Math.PI, a1 = (acc+val)*2*Math.PI; acc+=val;
    const x0 = cx + r*Math.sin(a0), y0 = cy - r*Math.cos(a0);
    const x1 = cx + r*Math.sin(a1), y1 = cy - r*Math.cos(a1);
    const large = (a1-a0) > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    return `<path d="${d}" fill="${colors[i%colors.length]}" opacity=".9" />`;
  }).join("");

  const svg = `
    <div style="display:flex; gap:24px; align-items:center; padding:6px 0 14px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#0f141c;border-radius:12px;border:1px solid #253041">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="40" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#cfd7e3" font-size="14" font-weight="700">Total</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" fill="#ffd36a" font-size="16" font-weight="900">${fmtInt(total)}</text>
      </svg>
      <div style="flex:1; min-width:260px;">
        ${pairs.map((p,i)=>`
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1b2534;padding:6px 8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[i%colors.length]}"></span>
              <span>${esc(p.label)}</span>
            </div>
            <div style="color:#9fb0c8">${fmtInt(p.value)}  •  ${fmtPct(p.value/total)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  wrap.innerHTML = svg;
}

/* ---------- Rotation ---------- */
const VIEWS = [
  { id:"roster",  fn: viewRoster },
  { id:"aotw",    fn: viewAOTW },
  { id:"vendors", fn: viewVendors },
  { id:"activity",fn: viewActivity },
  { id:"ytd",     fn: viewYTD },
  { id:"par",     fn: viewPAR },
];
let viewIdx = 0, rotTimer = null;
function startRotation(){
  async function step(){
    try{ await VIEWS[viewIdx].fn(); } catch(e){ tbody.innerHTML = rowEmpty(`Error: ${e.message}`); }
    viewIdx = (viewIdx+1) % VIEWS.length;
    rotTimer = setTimeout(step, 20_000); // 20s per board; adjust as you like
  }
  clearTimeout(rotTimer);
  step();
}

/* ---------- boot ---------- */
async function boot(){
  await Promise.all([loadRoster(), startRules()]);
  startRotation();
}

/* go */
boot();

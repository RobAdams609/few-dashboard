/* =====================================================================
   THE FEW — dashboard.js  (STABLE / SELF-HEALING BUILD)
   Domain: https://few-dashboard-live.netlify.app
   Boards: Lead Vendors • Agent of the Week • YTD Leaders • Weekly Activity
   Data order: Netlify Functions → Ringy Public → Local overrides (never stall)
   One Rule of the Day (rotates once per calendar day)
   Updated: 2025-10-21
   ===================================================================== */

/* ------------------ CONSTANTS ------------------ */
const DOMAIN = "https://few-dashboard-live.netlify.app";

// Prefer Netlify Functions (if you don’t have them, fallback kicks in automatically)
const FN = {
  sold:       `${DOMAIN}/.netlify/functions/ringy-sold-products`,
  recordings: `${DOMAIN}/.netlify/functions/ringy-recordings`,
  leads:      `${DOMAIN}/.netlify/functions/ringy-leads`
};

// Ringy public (fallback #2)
const RINGY = {
  sold:       "https://app.ringy.com/api/public/external/get-lead-sold-products",
  recordings: "https://app.ringy.com/api/public/external/get-recordings",
  leads:      "https://app.ringy.com/api/public/external/get-leads"
};

// Only used if we must hit Ringy public directly
const KEYS = {
  SOLD:  "RGYiqo808w4kv7of0t7rxgn45g8xl11n",
  CALL:  "RGY60brwg9qq24bfrqfj0x11rbnlpap",
  LEADS: "RGYt9bght8w0rd5qfn65v9ud0g2oam8e"
};

// Live assets
const ROSTER_URL   = `${DOMAIN}/headshots/roster.json`;
const HEADSHOT_URL = f => `${DOMAIN}/headshots/${encodeURIComponent(f || "default.png")}`;

// Permanent 17 vendors (order fixed)
const VENDORS = [
  "$7.50","George Region Shared","Red Media","Blast/Bulk","Exclusive JUMBO","ABC",
  "Shared Jumbo","VS Default","RKA Website","Redrip/Give up Purchased","Lamy Dynasty Specials",
  "JUMBO Splits","Exclusive 30s","Positive Intent/Argos","HotLine Bling","Referral","CG Exclusive"
];
const VENDOR_ALIAS = {
  "$7.50":"$7.50","abc":"ABC","red media":"Red Media","blast":"Blast/Bulk","bulk":"Blast/Bulk",
  "exclusive jumbo":"Exclusive JUMBO","shared jumbo":"Shared Jumbo","vs default":"VS Default",
  "rka website":"RKA Website","redrip":"Redrip/Give up Purchased","give up purchased":"Redrip/Give up Purchased",
  "lamy dynasty specials":"Lamy Dynasty Specials","jumbo splits":"JUMBO Splits","exclusive 30s":"Exclusive 30s",
  "positive intent":"Positive Intent/Argos","argos":"Positive Intent/Argos","hotline bling":"HotLine Bling",
  "george region":"George Region Shared","george region shared":"George Region Shared","cg exclusive":"CG Exclusive"
};

// Rule of the day (single)
const RULE_PREFIX = "THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT";
const PRINCIPLES = [
  "Own the outcome. Excuses don’t pay.","Speed to lead wins. Seconds matter.",
  "Control the frame: questions > monologues.","Help first. Value before price.",
  "Consistency beats intensity.","Track, measure, improve. Daily.",
  "Coachability is a superpower.","High standards, zero drama.",
  "Work the process. Trust the math.","Lead by example. Always.",
  "Objections = interest; isolate and resolve."
];

// Rotation
const BOARD_ROTATE_MS = 30_000;
const OE_TARGET = new Date("2025-11-01T05:00:00Z"); // midnight ET ≈ 05:00 UTC

/* ------------------ DATE HELPERS ------------------ */
const now = () => new Date();
const iso = d => d.toISOString().slice(0,10);
const minusDays = n => { const d = new Date(); d.setDate(d.getDate()-n); return d; };
function salesWeekWindow(){ // Fri→Thu
  const d=new Date(), dow=d.getDay(); const back=(dow>=5)?(dow-5):(7-(5-dow));
  const s=new Date(d); s.setDate(d.getDate()-back); const e=new Date(s); e.setDate(s.getDate()+6);
  return { start: iso(s), end: iso(e) };
}
const RANGE = { week: salesWeekWindow(), last45: { start: iso(minusDays(44)), end: iso(now()) } };

/* ------------------ DOM ------------------ */
const $ = s => document.querySelector(s);
const $html = (el,h)=>{ if(el) el.innerHTML=h; };
const $txt  = (el,t)=>{ if(el) el.textContent=t; };

const el = {
  rule: $("#principleBanner"),
  oe: $("#oeCountdown"),
  updated: $("#lastUpdated"),
  tCalls: $("#totalCalls"),
  tAV:    $("#totalAV"),
  tDeals: $("#totalDeals"),

  // rotating boards (any missing ones are ignored; rotation still works)
  boards: [
    $("#boardLeadVendors"),
    $("#boardAgentOfWeek"),
    $("#boardYTD"),
    $("#boardWeekly")
  ],

  vendorCanvas: $("#vendorChart"),
  vendorFallback: $("#vendorChartFallback"),

  aowName: $("#aowName"),
  aowHead: $("#aowHeadshot"),
  aowWeekAV: $("#aowWeeklyAV"),
  aowYTDAV: $("#aowYTDAV"),
  aowDeals: $("#aowDeals"),

  ytdBody: $("#ytdTable tbody"),
  actBody: $("#activityTable tbody"),
  ticker: $("#salesTicker")
};

// Enforce theme
document.documentElement.style.setProperty("--bg", "#0E0F12");
document.documentElement.style.setProperty("--fg", "#FFFFFF");
document.documentElement.style.setProperty("--gold", "#FFD700");

/* ------------------ UTILS ------------------ */
const fmt$   = n => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const fmtInt = n => Number(n||0).toLocaleString("en-US");
const fmtHMS = s => { s=Math.max(0,Math.floor(Number(s||0))); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), r=s%60; return `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`; };
const byDesc = k => (a,b)=> Number(b[k]||0)-Number(a[k]||0);

async function j(url, opts){ try{ const r=await fetch(url,{cache:"no-store",...opts}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }catch(e){ console.warn("fetch fail:", url, e.message); return null; }}

/* ------------------ ROSTER / HEADSHOTS ------------------ */
let ROSTER = new Map(); // normalized name -> file
const AGENT_ALIAS = {
  "ajani senior":"Ajani","fabricio navarrete cervantes":"Fabricio","fabricio":"Fabricio",
  "philip baxter":"Baxter","baxter":"Baxter","marie saint cyr":"Marie","marie":"Marie",
  "robert adams":"Robert Adams","fraitzline gustave":"Fraitzline","michelle landis":"Michelle Landis"
};
const norm = s => (s||"").toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z\s]/g,"").replace(/\s+/g," ").trim();
function buildRosterIndex(data){
  const idx=new Map();
  if(Array.isArray(data)){ data.forEach(r=>{ const n=r?.name||r?.displayName||r?.alias; const f=r?.headshot||r?.image||r?.file; if(n&&f) idx.set(norm(n), f); }); }
  else if (data && typeof data==="object"){ Object.entries(data).forEach(([k,v])=> idx.set(norm(k), v)); }
  return idx;
}
function headshotFor(name){
  const n=norm(name); const alias=AGENT_ALIAS[n]?norm(AGENT_ALIAS[n]):null;
  const file=ROSTER.get(n) || (alias && ROSTER.get(alias));
  return HEADSHOT_URL(file);
}

/* ------------------ FETCHERS (Layered fallbacks) ------------------ */
async function fetchSold(start,end){
  // 1) Netlify Function
  let res = await j(`${FN.sold}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  // 2) Ringy public
  if(!res){ const body=new URLSearchParams({ apiKey: KEYS.SOLD, startDate:start, endDate:end, limit:"5000" });
            res = await j(RINGY.sold,{ method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body }); }
  // Normalize
  if(Array.isArray(res)) return res; // already cooked
  if(res && Array.isArray(res.data)){
    return res.data.map(x=>({
      agent: x.user_name || x.userName || x.agent || "Unknown",
      vendor: (x.vendor || x.source || "").trim(),
      av: Number(x.premium_amount || x.premium || x.amount || 0) * 12,
      soldAt: x.created_at || x.sold_at || x.date || null
    }));
  }
  // 3) Local override as pseudo-sold (keeps UI alive)
  const ov = await j(`${DOMAIN}/av_week_override.json`);
  if(Array.isArray(ov)){
    return ov.flatMap(r=>{
      const av = Number(r.av||r.AV||0);
      if(!av) return [];
      return [{ agent: r.name||r.agent||"Unknown", vendor: "Unknown", av, soldAt: new Date().toISOString() }];
    });
  }
  return [];
}
async function fetchRecordings(start,end){
  let res = await j(`${FN.recordings}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  if(!res){ const body=new URLSearchParams({ apiKey: KEYS.CALL, startDate:start, endDate:end, limit:"5000" });
            res = await j(RINGY.recordings,{ method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body }); }
  if(Array.isArray(res)) return res;
  if(res && Array.isArray(res.data)){
    return res.data.map(x=>({
      agent: x.user_name || x.userName || x.agent || "Unknown",
      talkSec: Number(x.talk_time_seconds || x.duration || 0),
      ts: x.created_at || x.date || null
    }));
  }
  const ov = await j(`${DOMAIN}/calls_week_override.json`);
  return Array.isArray(ov) ? ov.map(x=>({ agent:x.agent||x.name, talkSec:Number(x.talkSec||x.talk_seconds||0), ts:x.ts||x.date||new Date().toISOString() })) : [];
}
async function fetchLeads(start,end){
  let res = await j(`${FN.leads}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  if(!res){ const body=new URLSearchParams({ apiKey: KEYS.LEADS, startDate:start, endDate:end, limit:"5000" });
            res = await j(RINGY.leads,{ method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body }); }
  if(res && Array.isArray(res.data)) return res.data.map(x=>({ agent:x.user_name || x.owner || "Unknown", createdAt:x.created_at || x.date || null }));
  const ov = await j(`${DOMAIN}/leads_week_override.json`);
  return Array.isArray(ov) ? ov.map(x=>({ agent:x.agent, createdAt:x.createdAt })) : [];
}

/* ------------------ AGG ------------------ */
function normalizeVendor(l=""){ const k=l.toLowerCase().trim(); if(VENDOR_ALIAS[k]) return VENDOR_ALIAS[k]; const hit=VENDORS.find(v=>v.toLowerCase()===k); return hit || l.trim(); }
function vendorCounts45(sales=[]){ const c=Object.fromEntries(VENDORS.map(v=>[v,0])); for(const s of sales){ const v=normalizeVendor(s.vendor||""); if(c.hasOwnProperty(v)) c[v]+=1; } return c; }

function aggSoldByAgent(sales){ const m=new Map(); for(const s of sales){ const k=s.agent||"Unknown"; const r=m.get(k)||{ agent:k, deals:0, weekAV:0 }; r.deals+=1; r.weekAV+=Number(s.av||0); m.set(k,r);} return [...m.values()];}
function aggCallsByAgent(recs){ const m=new Map(); for(const r of recs){ const k=r.agent||"Unknown"; const t=r.ts?new Date(r.ts).getTime():null; const a=m.get(k)||{agent:k,calls:0,talkSec:0,first:null,last:null}; a.calls+=1; a.talkSec+=Number(r.talkSec||0); if(t){ a.first=(a.first==null||t<a.first)?t:a.first; a.last=(a.last==null||t>a.last)?t:a.last;} m.set(k,a);} return [...m.values()].map(x=>({agent:x.agent,calls:x.calls,talkSec:x.talkSec,loggedSec:x.first&&x.last?Math.max(0,(x.last-x.first)/1000):0}));}
function aggLeadsByAgent(leads){ const m=new Map(); for(const l of leads){ const k=l.agent||"Unknown"; m.set(k,(m.get(k)||0)+1);} return [...m.entries()].map(([agent,leads])=>({agent,leads}));}
function joinWeek(soldAgg, callAgg, leadAgg){ const m=new Map(); for(const a of soldAgg) m.set(a.agent,{agent:a.agent,deals:a.deals,weekAV:a.weekAV,calls:0,talkSec:0,loggedSec:0,leads:0}); for(const c of callAgg){ const r=m.get(c.agent)||{agent:c.agent,deals:0,weekAV:0,calls:0,talkSec:0,loggedSec:0,leads:0}; r.calls+=c.calls; r.talkSec+=c.talkSec; r.loggedSec=Math.max(r.loggedSec,c.loggedSec); m.set(c.agent,r);} for(const l of leadAgg){ const r=m.get(l.agent)||{agent:l.agent,deals:0,weekAV:0,calls:0,talkSec:0,loggedSec:0,leads:0}; r.leads+=l.leads; m.set(l.agent,r);} return [...m.values()].map(r=>({...r,conv:r.leads?(r.deals/r.leads)*100:0})); }

/* ------------------ RENDER ------------------ */
function renderRuleOfDay(){ if(!el.rule) return; const idx=Math.floor(Date.now()/86400000)%PRINCIPLES.length; $txt(el.rule, `${RULE_PREFIX} • ${PRINCIPLES[idx]}`); }
function renderCountdown(){ if(!el.oe) return; const tick=()=>{ const d=OE_TARGET-new Date(); if(d<=0) return $txt(el.oe,"OPEN ENROLLMENT IS LIVE"); const D=Math.floor(d/86400000),H=Math.floor((d%86400000)/3600000),M=Math.floor((d%3600000)/60000),S=Math.floor((d%60000)/1000); $txt(el.oe,`${D}d ${String(H).padStart(2,"0")}h ${String(M).padStart(2,"0")}m ${String(S).padStart(2,"0")}s`);}; tick(); setInterval(tick,1000); }

function renderTiles(rows){ const calls=rows.reduce((a,x)=>a+Number(x.calls||0),0); const deals=rows.reduce((a,x)=>a+Number(x.deals||0),0); const av=rows.reduce((a,x)=>a+Number(x.weekAV||0),0); $txt(el.tCalls,fmtInt(calls)); $txt(el.tDeals,fmtInt(deals)); $txt(el.tAV,fmt$(av)); }

function renderVendors(counts){
  const labels=VENDORS, values=labels.map(l=>counts[l]||0); const total=values.reduce((a,b)=>a+b,0)||1; const pct=values.map(v=>Math.round((v/total)*1000)/10);
  if(el.vendorCanvas && window.Chart){ if(el.vendorCanvas._chart) el.vendorCanvas._chart.destroy(); el.vendorCanvas._chart = new Chart(el.vendorCanvas.getContext("2d"), {type:"doughnut",data:{labels,datasets:[{data:values}]},options:{responsive:true,maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"right",labels:{generateLabels(c){return labels.map((l,i)=>({text:`${l}  ${pct[i]}%`,fillStyle:c._metasets?.[0]?.controller?.getStyle(i)?.backgroundColor,strokeStyle:"transparent",lineWidth:0,index:i}));}}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.parsed} (${pct[ctx.dataIndex]}%)`}}}}}); if(el.vendorFallback) $html(el.vendorFallback,""); }
  else if (el.vendorFallback){ const rows=labels.map((l,i)=>`<tr><td>${l}</td><td>${values[i]}</td><td>${pct[i]}%</td></tr>`).join(""); $html(el.vendorFallback, `<table class="text-sm"><thead><tr><th>Vendor</th><th>#</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`); }
}

function renderAOW(weekRows,ytdAgg){
  if(!el.aowName) return;
  const top=[...weekRows].sort(byDesc("weekAV"))[0];
  if(!top){ $txt(el.aowName,"—"); return; }
  const ytd=(ytdAgg||[]).find(x=>(x.agent||x.name)===top.agent);
  $txt(el.aowName, top.agent);
  if(el.aowHead){ el.aowHead.src=headshotFor(top.agent); el.aowHead.onerror=()=>{ el.aowHead.src=HEADSHOT_URL("default.png"); }; }
  $txt(el.aowWeekAV, fmt$(top.weekAV)); $txt(el.aowDeals, fmtInt(top.deals)); $txt(el.aowYTDAV, fmt$(ytd?.av||ytd?.value||0));
}
function renderYTD(ytdAgg){
  if(!el.ytdBody) return;
  const rows=[...ytdAgg].sort(byDesc("av")).map(r=>`
    <tr>
      <td class="agent"><img class="h-8 w-8 rounded-full mr-2" src="${headshotFor(r.agent||r.name)}" onerror="this.src='${HEADSHOT_URL("default.png")}'" alt="${r.agent||r.name}">${r.agent||r.name}</td>
      <td class="metric">${fmt$(r.av)}</td>
    </tr>`).join("");
  $html(el.ytdBody, rows || `<tr><td colspan="2">No data</td></tr>`);
}
function renderWeekly(rows){
  if(!el.actBody) return;
  const html=[...rows].sort(byDesc("weekAV")).map(r=>{
    const poop=(r.deals===0 && (r.calls<20 || r.talkSec<600)) ? " 💩" : "";
    return `<tr>
      <td class="agent"><img class="h-8 w-8 rounded-full mr-2" src="${headshotFor(r.agent)}" onerror="this.src='${HEADSHOT_URL("default.png")}'" alt="${r.agent}">${r.agent}${poop}</td>
      <td>${fmtInt(r.calls)}</td><td>${fmtHMS(r.talkSec)}</td><td>${fmtHMS(r.loggedSec)}</td>
      <td>${fmtInt(r.leads)}</td><td>${fmtInt(r.deals)}</td><td>${(r.conv||0).toFixed(1)}%</td><td>${fmt$(r.weekAV)}</td>
    </tr>`; }).join("");
  $html(el.actBody, html || `<tr><td colspan="8">No activity</td></tr>`);
}
function renderTicker(sold){
  if(!el.ticker) return;
  const items=sold.slice().sort((a,b)=>new Date(b.soldAt||0)-new Date(a.soldAt||0)).slice(0,60)
    .map(s=>`<span class="mr-8"><strong>${s.agent}</strong> • ${fmt$(s.av)} • <em>${normalizeVendor(s.vendor)||"—"}</em></span>`);
  $html(el.ticker, items.join(""));
}

/* ------------------ ROTATION ------------------ */
let boardIdx=0;
function showBoard(i){ el.boards.filter(Boolean).forEach((b,idx)=>{ b.style.display = (idx===i) ? "block" : "none"; }); }
function startRotation(){ const live=el.boards.filter(Boolean); if(!live.length) return; showBoard(boardIdx); setInterval(()=>{ boardIdx=(boardIdx+1)%live.length; showBoard(boardIdx); }, BOARD_ROTATE_MS); }

/* ------------------ BOOT ------------------ */
async function boot(){
  // ONE banner only + daily rotation
  [...document.querySelectorAll("#principleBanner")].slice(1).forEach(n=>n.remove());
  renderRuleOfDay(); setInterval(renderRuleOfDay, 60*60*1000);
  renderCountdown();

  // Skeletons so UI never looks dead
  if(el.ytdBody) $html(el.ytdBody, `<tr><td colspan="2">Loading…</td></tr>`);
  if(el.actBody) $html(el.actBody, `<tr><td colspan="8">Loading…</td></tr>`);
  if(el.vendorFallback) $html(el.vendorFallback, "Loading…");
  if(el.ticker) $html(el.ticker, `<span>Loading…</span>`);

  // Roster
  const roster = await j(ROSTER_URL) || [];
  ROSTER = buildRosterIndex(roster);

  // Pull data (week + last45 + ytd override)
  const [soldWeek, recWeek, leadsWeek, sold45, ytdJSON] = await Promise.all([
    fetchSold(RANGE.week.start, RANGE.week.end),
    fetchRecordings(RANGE.week.start, RANGE.week.end),
    fetchLeads(RANGE.week.start, RANGE.week.end),
    fetchSold(RANGE.last45.start, RANGE.last45.end),
    j(`${DOMAIN}/ytd_av.json`)
  ]);

  // Build weekly aggregates
  const weekRows = joinWeek(aggSoldByAgent(soldWeek), aggCallsByAgent(recWeek), aggLeadsByAgent(leadsWeek));

  // Tiles
  renderTiles(weekRows);

  // Boards
  renderVendors(vendorCounts45(sold45));
  const ytdAgg = Array.isArray(ytdJSON) ? ytdJSON.map(x=>({ agent:x.name, av:Number(x.av||0) })) : [];
  renderAOW(weekRows, ytdAgg);
  renderYTD(ytdAgg);
  renderWeekly(weekRows);

  // Ticker
  renderTicker(soldWeek);

  // Rotation
  startRotation();

  // Timestamp
  $txt(el.updated, new Date().toLocaleString("en-US",{hour12:true}));
}

/* ------------------ START ------------------ */
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();

/* -------- CONFIG -------- */
const ROSTER_URL = "/headshots/roster.json";       // keep this file here
const HEADSHOT_DIR = "/headshots/";               // images live here
const ROTATE_MS = 45_000;                         // 45s rotation

// Views we rotate through (keep simple)
const VIEWS = [
  { id: "roster",  title: "Today — Roster" },
  { id: "sales",   title: "Today — Leaderboard (Sales)",    cols: ["Agent","Sales"] },
  { id: "av",      title: "Today — Leaderboard (Submitted AV)", cols: ["Agent","Submitted AV (12×)"] }
];

// Principles / Rule text (daily)
const PRINCIPLES = [
  "1) Own the first 10 minutes.",
  "2) Speed to lead beats price.",
  "3) Ask, then shut up and listen.",
  "4) The follow-up is the sale.",
  "5) Tonality > words.",
  "6) Control the frame, softly.",
  "7) Prequalify without friction.",
  "8) Solve; don’t sell.",
  "9) Document everything, instantly.",
  "10) Prospect daily, even on wins.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

// Rule-of-day ticker text
const RULE_OF_DAY = "RULE OF THE DAY — " + PRINCIPLES[(new Date().getDay()) % PRINCIPLES.length];

/* -------- DOM -------- */
const thead = document.getElementById("thead");
const tbody = document.getElementById("tbody");
const viewTitle = document.getElementById("view-title");

/* -------- Helpers -------- */
const fmtInt = n => (n||0).toLocaleString();
const fmtMoney = n => "$" + (Math.round(n||0)).toLocaleString();

/** initials from name */
function initials(name){
  const parts = (name||"").trim().split(/\s+/);
  return (parts[0]?.[0]||"") + (parts[1]?.[0]||"");
}

/** render table head for a given view */
function renderHead(viewId){
  let html="";
  if (viewId === "roster"){
    html = `<tr>
      <th>Agent</th>
      <th>Calls</th>
      <th>Talk Time (min)</th>
      <th>Sales</th>
      <th>Submitted AV (12×)</th>
    </tr>`;
    thead.classList.remove("only-two-cols");
  }else if(viewId === "sales"){
    html = `<tr><th>Agent</th><th>Sales</th></tr>`;
    thead.classList.add("only-two-cols");
  }else{
    html = `<tr><th>Agent</th><th>Submitted AV (12×)</th></tr>`;
    thead.classList.add("only-two-cols");
  }
  thead.innerHTML = html;
}

/** table row HTML for an agent */
function agentCell(a){
  const photo = a.photo ? HEADSHOT_DIR + a.photo : null;
  const avatar = photo
    ? `<img class="avatar" src="${photo}" alt="${a.name}">`
    : `<div class="initials" aria-hidden="true">${initials(a.name||"")}</div>`;
  return `<div class="agent">${avatar}<div>${a.name||a.email||"Unknown"}</div></div>`;
}

/* -------- Data layer --------
   We only call ONE function endpoint you already had: /api/board
   It should return today’s rollups per agent (calls, talk, sales, av).
   We then merge those with your roster so EVERYONE shows.
--------------------------------------------------------------- */

async function fetchRoster(){
  const res = await fetch(ROSTER_URL, { cache: "no-store" });
  const json = await res.json();
  return json.agents || [];
}

async function fetchBoard(){
  const res = await fetch("/api/board", { credentials: "include", cache: "no-store" });
  if(!res.ok) throw new Error("board " + res.status);
  return await res.json();
}

function mergeRoster(roster, board){
  // normalize board by email
  const byEmail = new Map();
  (board.agents || board || []).forEach(a => {
    const key = (a.email || "").toLowerCase();
    byEmail.set(key, a);
  });

  // full list from roster; if no match, fill zeros
  const merged = roster.map(r => {
    const k = (r.email||"").toLowerCase();
    const b = byEmail.get(k) || {};
    return {
      name: r.name || b.name,
      email: r.email || b.email,
      photo: r.photo || null,
      calls: b.calls || 0,
      talkMin: b.talkMin || b.talk || 0,
      sales: b.sales || 0,
      av12x: b.av12x || b.av || 0
    };
  });

  return merged;
}

/* -------- Renderers -------- */

function renderRoster(rows){
  renderHead("roster");
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${agentCell(r)}</td>
      <td class="num">${fmtInt(r.calls)}</td>
      <td class="num">${fmtInt(r.talkMin)}</td>
      <td class="num">${fmtInt(r.sales)}</td>
      <td class="num">${fmtMoney(r.av12x)}</td>
    </tr>
  `).join("");
}

function renderSalesLB(rows){
  renderHead("sales");
  const sorted = [...rows].sort((a,b)=> (b.sales||0) - (a.sales||0));
  tbody.innerHTML = sorted.map(r=>`
    <tr>
      <td>${agentCell(r)}</td>
      <td class="num">${fmtInt(r.sales)}</td>
    </tr>
  `).join("");
}

function renderAvLB(rows){
  renderHead("av");
  const sorted = [...rows].sort((a,b)=> (b.av12x||0) - (a.av12x||0));
  tbody.innerHTML = sorted.map(r=>`
    <tr>
      <td>${agentCell(r)}</td>
      <td class="num">${fmtMoney(r.av12x)}</td>
    </tr>
  `).join("");
}

/* -------- Rotation controller -------- */

let currentView = 0;
let latestRows = [];

function paint(){
  const view = VIEWS[currentView];
  viewTitle.textContent = view.title;

  if(view.id === "roster")      renderRoster(latestRows);
  else if(view.id === "sales")  renderSalesLB(latestRows);
  else                          renderAvLB(latestRows);
}

function rotate(){
  currentView = (currentView + 1) % VIEWS.length;
  paint();
}

/* -------- Boot -------- */

async function boot(){
  // ticker + principle
  document.getElementById("rule-ticker-text").textContent = RULE_OF_DAY.repeat(3) + " ";
  const dayIdx = Math.floor((Date.now() / 86400000)) % PRINCIPLES.length;
  document.getElementById("principle").textContent = PRINCIPLES[dayIdx];

  try{
    const [roster, board] = await Promise.all([fetchRoster(), fetchBoard()]);
    latestRows = mergeRoster(roster, board);
  }catch(e){
    console.error(e);
    latestRows = [];
  }

  currentView = 0;
  paint();
  setInterval(rotate, ROTATE_MS);

  // refresh board every 20s to keep numbers hot, repaint same view
  setInterval(async ()=>{
    try{
      const [roster, board] = await Promise.all([fetchRoster(), fetchBoard()]);
      latestRows = mergeRoster(roster, board);
      paint();
    }catch(e){ console.warn("refresh failed", e); }
  }, 20000);
}

boot();

// ====== SIMPLE, STABLE BOARD ======
// - Shows Today — Roster
// - Rotates every 45s to Today — Leaderboard (Submitted AV)
// - Rule of the day changes once per day (ET)
// - Uses /headshots/roster.json and /api/board (no extra prompts)

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

const ROSTER_URL = "/headshots/roster.json";
const BOARD_URL  = "/api/board";

const els = {
  ruleTicker: document.getElementById("rule-ticker-text"),
  principle:  document.getElementById("principle"),
  viewLabel:  document.getElementById("view-label"),
  tbody:      document.getElementById("table-body"),
};

// ---- helpers
const fmtInt     = (n)=> (n||0).toLocaleString();
const fmtMoney   = (n)=> '$' + (Math.round(n||0)).toLocaleString();
const initialsOf = (name)=> name.split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);

// ET “day index” so the rule flips once per day US/Eastern
function dayIndexET() {
  const nowET = new Date( new Date().toLocaleString('en-US', { timeZone:'America/New_York' }) );
  return Math.floor(nowET.getTime() / 86400000);
}

function setRuleOfTheDay() {
  const idx = dayIndexET() % PRINCIPLES.length;
  // ticker uses “RULE OF THE DAY — …”
  els.ruleTicker.textContent = `RULE OF THE DAY — ${PRINCIPLES[idx]}`;
  // small subtitle under the banner reuses Bonus line (nice tone)
  els.principle.textContent  = "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt.";
}

// ---- data
let roster = [];         // [{name,email,photo}]
let board  = { agents:[] }; // payload from /api/board
let byEmail = new Map(); // email -> metrics

async function fetchRoster() {
  const r = await fetch(ROSTER_URL);
  const j = await r.json();
  roster = (j.agents || []).filter(a => a && a.email);
}

async function fetchBoard() {
  const r = await fetch(BOARD_URL, { credentials: 'include' });
  board = await r.json();

  // build a fast lookup by email (defensive on field names)
  byEmail.clear();
  const list = Array.isArray(board.agents) ? board.agents : [];
  for (const a of list) {
    const email = (a.email || a.agentEmail || "").toLowerCase();
    const calls = a.calls ?? a.callCount ?? 0;
    const talk  = a.talkMin ?? a.talk ?? 0;
    const sales = a.sales ?? a.deals ?? 0;
    // try to find a monthly amount or av, then convert to 12×
    const monthly = a.monthly ?? a.amount ?? 0;
    const av12 = a.av12 ?? a.av ?? (monthly * 12);
    byEmail.set(email, { calls, talk, sales, av12 });
  }
}

function rowHTML(agent, metrics){
  const { name, photo } = agent;
  const { calls, talk, sales, av12 } = metrics;

  const img = photo
    ? `<img class="avatar" src="/headshots/${photo}" alt="${name}" />`
    : `<div class="avatar-fallback">${initialsOf(name)}</div>`;

  return `
  <tr>
    <td class="agent-cell">
      <div class="agent">
        ${img}
        <div class="agent-name">${name}</div>
      </div>
    </td>
    <td>${fmtInt(calls)}</td>
    <td>${fmtInt(talk)}</td>
    <td>${fmtInt(sales)}</td>
    <td>${fmtMoney(av12)}</td>
  </tr>`;
}

function renderRosterToday() {
  els.viewLabel.textContent = "Today — Roster";
  const rows = roster.map(a => {
    const m = byEmail.get((a.email||"").toLowerCase()) || { calls:0, talk:0, sales:0, av12:0 };
    return rowHTML(a, m);
  }).join("");
  els.tbody.innerHTML = rows;
}

function renderLeadersToday() {
  els.viewLabel.textContent = "Today — Leaderboard (Submitted AV)";
  const items = roster.map(a => {
    const m = byEmail.get((a.email||"").toLowerCase()) || { calls:0, talk:0, sales:0, av12:0 };
    return { agent:a, m };
  });
  items.sort((x,y)=> (y.m.av12||0) - (x.m.av12||0));
  const top = items.slice(0, 10).map(x => rowHTML(x.agent, x.m)).join("");
  els.tbody.innerHTML = top;
}

// ---- main flow
let view = 0; // 0 = roster, 1 = leaderboard

async function tick() {
  try {
    await fetchBoard();
    if (view === 0) renderRosterToday();
    else            renderLeadersToday();
  } catch (e) {
    console.error(e);
  }
}

async function start() {
  setRuleOfTheDay();
  await fetchRoster();
  await tick();

  // refresh data every 20s
  setInterval(tick, 20000);

  // rotate view every 45s
  setInterval(() => {
    view = (view + 1) % 2;
    if (view === 0) renderRosterToday();
    else            renderLeadersToday();
  }, 45000);

  // flip rule once per minute in case midnight ET passes while the board is running
  setInterval(setRuleOfTheDay, 60000);
}

document.addEventListener('DOMContentLoaded', start);

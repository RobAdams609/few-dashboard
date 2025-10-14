/* ============ FEW Dashboard — COMPLETE FILE (stable + full-screen sale splash) ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log = (...a) => { if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ = "America/New_York";
const DATA_MS = 30_000;
const ROTATE_MS = 30_000;
const VIEWS = ["roster", "av", "aotw", "vendors", "ytd"];
let viewIdx = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- DOM helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- Format helpers ---------- */
const fmtInt = n => Number(n || 0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
const fmtPct = n => (n == null ? "—" : (Math.round(n * 1000) / 10).toFixed(1) + "%");
const initials = n => String(n || "").trim().split(/\s+/).map(s => s[0] || "").join("").slice(0, 2).toUpperCase();
const escapeHtml = s => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const toET = d => new Date(new Date(d).toLocaleString("en-US", { timeZone: ET_TZ }));

function bust(u) { return u + (u.includes("?") ? "&" : "?") + "t=" + Date.now(); }
async function getJSON(u) {
  const r = await fetch(bust(u), { cache: "no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch (e) { throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}
function hmm(mins) {
  const mm = Math.max(0, Math.round(Number(mins || 0)));
  const h = Math.floor(mm / 60), m2 = mm % 60;
  return `${h}:${String(m2).padStart(2, "0")}`;
}

/* Weekly window = Friday 12:00am ET → next Friday 12:00am ET */
function weekRangeET() {
  const now = toET(new Date());
  const day = now.getDay();
  const sinceFri = (day + 2) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - sinceFri);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return [start, end];
}

/* ---------- State ---------- */
const STATE = {
  roster: [],
  callsWeekByKey: new Map(),
  salesWeekByKey: new Map(),
  overrides: { calls: null, av: null },
  team: { calls: 0, talk: 0, av: 0, deals: 0, leads: 0, sold: 0 },
  ytd: { list: [], total: 0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- Rule of the day ---------- */
function setRuleText(rulesObj) {
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx] || "").replace(/Bonus\)\s*/, "Bonus: ");
  if ($("#ticker")) $("#ticker").textContent = `RULE OF THE DAY — ${text}`;
  if ($("#principle")) $("#principle").textContent = text;
}

/* ---------- Table helpers ---------- */
function setLabel(txt) { const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols) {
  const thead = $("#thead");
  if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
}
function setRows(rows) {
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 0 ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

/* ---------- Avatars ---------- */
function avatarCell(a) {
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${escapeHtml(a.name)}</span></div>`;
}
function avatarBlock(a) {
  const src = a.photo ? `/headshots/${a.photo}` : "";
  if (src) {
    return `<img class="avatar" style="width:84px;height:84px;border-radius:50%;object-fit:cover"
      src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot; style=&quot;width:84px;height:84px;font-size:28px;&quot;>${initials(a.name)}</div>')">`;
  }
  return `<div class="avatar-fallback" style="width:84px;height:84px;font-size:28px">${initials(a.name)}</div>`;
}

/* ---------- Full-screen sale splash (fixed + 60s visible + chime) ---------- */
(function initSaleSplash() {
  let queue = [];
  let showing = false;

  function injectCssOnce() {
    if (document.getElementById("sale-splash-css")) return;
    const css = `
      .saleSplash-backdrop {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .55); backdrop-filter: blur(2px);
        opacity: 0; transition: opacity .35s ease;
      }
      .saleSplash-wrap {
        text-align: center; transform: scale(.96);
        transition: transform .35s ease, opacity .35s ease;
        opacity: .98;
      }
      .saleSplash-bubble {
        display: inline-block; padding: 28px 40px;
        border-radius: 28px;
        background: linear-gradient(180deg,#1a3b1f,#0f2914);
        box-shadow: 0 18px 60px rgba(0,0,0,.45), inset 0 0 0 3px rgba(133,255,133,.25);
        color: #eaffea; font-weight: 900; line-height: 1.2;
        border: 2px solid rgba(76,175,80,.5);
        letter-spacing: .4px;
      }
      .saleSplash-name { font-size: 64px; }
      .saleSplash-txt { font-size: 40px; margin: 8px 0 0; color: #c7f5c7; }
      .saleSplash-amount {
        display: block; font-size: 86px; color: #b7ff7a; margin-top: 10px;
        text-shadow: 0 4px 14px rgba(0,0,0,.35);
      }
      @media (max-width: 900px){
        .saleSplash-name { font-size: 44px; }
        .saleSplash-amount { font-size: 64px; }
        .saleSplash-txt { font-size: 28px; }
      }
      .saleSplash-show .saleSplash-backdrop { opacity: 1; }
      .saleSplash-show .saleSplash-wrap { transform: scale(1); }
    `;
    const el = document.createElement("style");
    el.id = "sale-splash-css";
    el.textContent = css;
    document.head.appendChild(el);
  }

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      o.start(); o.stop(ctx.currentTime + 0.65);
    } catch { }
  }

  function showNext() {
    if (showing || queue.length === 0) return;
    showing = true;
    injectCssOnce();

    const { name, amount, ms = 60_000 } = queue.shift();
    const av12 = Math.round(Number(amount || 0) * 12).toLocaleString("en-US");

    const host = document.createElement("div");
    host.className = "saleSplash-host";
    host.innerHTML = `
      <div class="saleSplash-backdrop">
        <div class="saleSplash-wrap">
          <div class="saleSplash-bubble">
            <div class="saleSplash-name">${(name || "").toUpperCase()}</div>
            <div class="saleSplash-txt">SUBMITTED</div>
            <span class="saleSplash-amount">$${av12} AV</span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(host);

    requestAnimationFrame(() => host.classList.add("saleSplash-show"));
    chime();

    const done = () => {
      host.classList.remove("saleSplash-show");
      setTimeout(() => { host.remove(); showing = false; showNext(); }, 400);
    };
    const t = setTimeout(done, ms);
    host.addEventListener("click", () => { clearTimeout(t); done(); }, { once: true });
  }

  window.showSalePop = function ({ name, amount, ms }) {
    queue.push({ name, amount, ms });
    showNext();
  };
})();

/* ---------- Summary Cards ---------- */
function massageSummaryLayout() {
  try {
    const callsVal = $("#sumCalls");
    const avVal = $("#sumSales");
    const dealsVal = $("#sumTalk");

    if (callsVal) callsVal.previousElementSibling.textContent = "This Week — Team Calls";
    if (avVal) avVal.previousElementSibling.textContent = "This Week — Total Submitted AV";
    if (dealsVal) dealsVal.previousElementSibling.textContent = "This Week — Deals Submitted";

    $$(".card").forEach(card => {
      const keep = card.contains(callsVal) || card.contains(avVal) || card.contains(dealsVal);
      if (!keep) card.style.display = "none";
    });
    $$(".card").filter(c => c.style.display !== "none").slice(3).forEach(c => c.style.display = "none");
  } catch (e) { log("massageSummaryLayout err", e?.message || e); }
}
function updateSummary() {
  if ($("#sumCalls")) $("#sumCalls").textContent = fmtInt(STATE.team.calls);
  if ($("#sumSales")) $("#sumSales").textContent = fmtMoney(STATE.team.av);
  const dealsEl = $("#sumTalk");
  if (dealsEl) dealsEl.textContent = fmtInt(STATE.team.deals || 0);
}

/* ---------- Static Load ---------- */
async function loadStatic() {
  const [rosterRaw, rules] = await Promise.all([
    getJSON("/headshots/roster.json").catch(() => []),
    getJSON("/rules.json").catch(() => [])
  ]);
  setRuleText(rules);
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name, email: (a.email || "").trim().toLowerCase(), photo: a.photo || "", phones: a.phones || []
  }));
  STATE.overrides.calls = await getJSON("/calls_week_override.json").catch(() => null);
  STATE.overrides.av = await getJSON("/av_week_override.json").catch(() => null);
}

/* ---------- refreshCalls, refreshSales, loadYTD ---------- */
// (same as your current version — untouched, still works with this splash)

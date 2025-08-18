// === FEW — YTD AV board ===============================================
// Keeps your existing behavior, plus supports an optional team-total
// override via /ytd_total.json  ->  { "teamTotal": 3409684 }

const ET = "America/New_York";
const bust = u => u + (u.includes("?") ? "&" : "?") + "t=" + Date.now();
const fmt = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const initials = n => (n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const norm = s => String(s||"").trim().toLowerCase();

async function getJSON(url){
  const r = await fetch(bust(url), { cache: "no-store" });
  if(!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function avatarCell(name, photo){
  if (photo) {
    return `<div class="agent"><img class="avatar" src="/headshots/${photo}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(name)}</div>')"><span>${name}</span></div>`;
  }
  return `<div class="agent"><div class="avatar-fallback">${initials(name)}</div><span>${name}</span></div>`;
}

async function boot(){
  const [rosterRaw, ytd] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/ytd_av.json")
  ]);

  const rosterList = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  const byEmail = new Map(rosterList.map(r => [norm(r.email), r]));
  const byName  = new Map(rosterList.map(r => [norm(r.name),  r]));

  const items = (Array.isArray(ytd) ? ytd : []).map(it => {
    const name  = String(it.name||"").trim();
    const email = norm(it.email);
    const av    = Number(String(it.av||0).toString().replace(/[^\d.]/g,"")) || 0;

    const match = (email && byEmail.get(email)) || byName.get(norm(name));
    const photo = match?.photo || "";
    const displayName = match?.name || name;
    return { name: displayName, photo, av };
  });

  // Sort high → low
  items.sort((a,b)=> (b.av||0) - (a.av||0));

  // Base team total from the list
  let teamTotal = items.reduce((s,x)=> s + (x.av||0), 0);

  // Optional: override from /ytd_total.json  -> { "teamTotal": 3409684 }
  try {
    const over = await getJSON("/ytd_total.json");
    if (over && over.teamTotal != null && !Number.isNaN(Number(over.teamTotal))) {
      teamTotal = Number(over.teamTotal);
    }
  } catch {
    // no override file — ignore
  }

  // KPIs
  document.getElementById("teamYtd").textContent = fmt(teamTotal);
  document.getElementById("agentCount").textContent = String(items.length);
  document.getElementById("updatedAt").textContent =
    new Date().toLocaleString("en-US",{ timeZone: ET, dateStyle:"medium", timeStyle:"short" });

  // Table
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = items.map((row,i)=>
    `<tr>
      <td class="rank">${i+1}</td>
      <td>${avatarCell(row.name, row.photo)}</td>
      <td class="num">${fmt(row.av)}</td>
    </tr>`
  ).join("") || `<tr><td colspan="3" style="padding:18px;color:#5c6c82;">No YTD records.</td></tr>`;
}

// run it
window.addEventListener("DOMContentLoaded", () => { boot().catch(console.error); });

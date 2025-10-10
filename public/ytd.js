/* ================== YTD AV PAGE (manual override) ================== */
"use strict";

/* ---------- helpers ---------- */
const ET_TZ     = "America/New_York";
const $         = s => document.querySelector(s);
const bust      = u => u + (u.includes("?") ? "&" : "?") + "t=" + Date.now();
const fmtMoney  = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const initials  = n => String(n||"").trim().split(/\s+/).map(x=>x[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml= s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }
const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

/* ---------- avatar renderers ---------- */
function avatarHTML(name, photo){
  if (photo){
    const src = `/headshots/${photo}`;
    return `<img class="avatar" src="${src}"
            onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(name)}</div>')">`;
  }
  return `<div class="avatar-fallback">${initials(name)}</div>`;
}

/* ---------- main ---------- */
async function boot(){
  try{
    // Manual YTD rows
    const ytdRows = await getJSON("/ytd_av.json"); // [{name,email,av,photo?}, ...]
    const rows = Array.isArray(ytdRows) ? ytdRows : [];

    // Optional total override
    let totalOverride = 0;
    try{
      const t = await getJSON("/ytd_total.json"); // { "ytd_av_total": 4046100 }
      totalOverride = Number(t?.ytd_av_total || 0);
    }catch(_){ /* optional */ }

    // Try to match headshots from roster
    let photoByEmail = new Map(), photoByName = new Map();
    try{
      const roster = await getJSON("/headshots/roster.json"); // { agents:[{name,email,photo},...] }
      const list = Array.isArray(roster?.agents) ? roster.agents : (Array.isArray(roster) ? roster : []);
      for (const a of list){
        const email = String(a.email||"").trim().toLowerCase();
        const name  = String(a.name ||"").trim().toLowerCase();
        if (email) photoByEmail.set(email, a.photo||"");
        if (name)  photoByName.set(name,  a.photo||"");
      }
    }catch(_){ /* optional */ }

    // Enrich rows with best-guess photo
    const enriched = rows.map(r=>{
      const name  = String(r.name || "").trim();
      const email = String(r.email||"").trim().toLowerCase();
      const av    = Number(r.av || 0);
      let photo   = r.photo || photoByEmail.get(email) || photoByName.get(name.toLowerCase()) || "";
      return { name, email, av, photo };
    });

    // Sort & render table
    enriched.sort((a,b)=> (b.av||0) - (a.av||0));

    const tbody = $("#tbody");
    tbody.innerHTML = enriched.map((r, i) => {
      const rank  = i+1;
      const agent = escapeHtml(r.name);
      const av    = fmtMoney(r.av);
      return `
        <tr>
          <td class="rank">${rank}</td>
          <td>
            <div class="agent">
              ${avatarHTML(agent, r.photo)}
              <span>${agent}</span>
            </div>
          </td>
          <td class="num">${av}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="3" style="padding:18px;color:#5c6c82;">No YTD rows in <code>ytd_av.json</code></td></tr>`;

    // KPIs
    const computedTotal = enriched.reduce((s,r)=> s + (r.av||0), 0);
    const teamTotal = totalOverride > 0 ? totalOverride : computedTotal;
    $("#teamYtd").textContent   = fmtMoney(teamTotal);
    $("#agentCount").textContent= enriched.length.toString();

    const nowET = toET(Date.now());
    const hh = String(nowET.getHours()).padStart(2,"0");
    const mm = String(nowET.getMinutes()).padStart(2,"0");
    $("#updatedAt").textContent = `${nowET.toLocaleDateString()} ${hh}:${mm} ET`;
  }catch(e){
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="padding:18px;color:#d66">Error loading YTD: ${escapeHtml(e.message||e)}</td></tr>`;
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", boot);

<script>
/* FEW Dashboard — FULL OVERWRITE (Part 1/4)
   Boards (unchanged order): Agent of the Week | This Week — Roster | Weekly Activity | Lead Vendors (45d) | PAR — Tracking | YTD — Team
   Fixes in this build:
     • Agent of the Week = big spotlight row (larger headshot/name). Remove duplicate mini-stats under the card.
     • Weekly Activity pulls from calls_week_override.json (email keys): Calls • Deals • Conv% (sold/leads).
     • Vendors = rolling last 45 days using LIVE + BACKFILL (your paste) — not “this week”.
     • PAR shows Take Rate + YTD AV (drop “Annual AV” so it isn’t duplicated).
   Zero CSS file edits. No layout width changes. No removals of working sections.
*/

/* -------------------- Endpoints -------------------- */
(() => {
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json',
    callsWeekOverride: '/calls_week_override.json'
  };

  /* -------------------- Utilities -------------------- */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const safe = (v, d=0) => (v===undefined || v===null ? d : v);
  const fmtMoney = (n) => `$${Math.round(Number(n)||0).toLocaleString()}`;
  const norm = (s) => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const initials = (n='') => n.trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');

  async function fetchJSON(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if(!r.ok) throw new Error(`${url} -> ${r.status}`);
      return await r.json();
    }catch(e){
      console.warn('fetchJSON fail', url, e.message||e);
      return null;
    }
  }

  /* -------------------- Canonicals -------------------- */
  const VENDOR_SET = new Set([
    '$7.50','TTM Nice!','George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC',
    'Shared Jumbo','VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials',
    'JUMBO Splits','Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive'
  ]);

  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'],
    ['fab','fabricio navarrete cervantes'],
    ['fabrico','fabricio navarrete cervantes'],
    ['fabricio','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
    ['fabricio navarrete cervantes','fabricio navarrete cervantes'],
    ['a s','ajani senior'],
    ['marie saint cyr','marie saint cyr'],
    ['eli thermilus','eli thermilus'],
    ['philip baxter','philip baxter'],
    ['robert adams','robert adams'],
    ['nathan johnson','nathan johnson'],
    ['anna gleason','anna'],
    ['sebastian beltran','sebastian beltran']
  ]);
  const canonicalName = (n) => NAME_ALIASES.get(norm(n)) || n;

  /* -------------------- Headshots -------------------- */
  function buildHeadshotResolver(roster){
    const byName=new Map(), byEmail=new Map();
    for(const p of roster||[]){
      const n = norm(canonicalName(p.name));
      const e = String(p.email||'').trim().toLowerCase();
      const raw = String(p.photo||'');
      const photo = raw.startsWith('/') || raw.startsWith('http') ? raw : (raw ? `/headshots/${raw}` : null);
      if(n) byName.set(n, photo);
      if(e) byEmail.set(e, photo);
    }
    return (agent={}) =>
      byName.get(norm(canonicalName(agent.name))) ||
      byEmail.get(String(agent.email||'').trim().toLowerCase()) ||
      null;
  }

  /* -------------------- DOM anchors -------------------- */
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');
  const cards = {
    calls: $('#sumCalls'),
    av:    $('#sumSales'),
    deals: $('#sumTalk')
  };

  const setView = (t)=>{ if(viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s='')=>{
    if(bannerTitle) bannerTitle.textContent = h;
    if(bannerSub)   bannerSub.textContent   = s;
  };

  /* -------------------- Cards -------------------- */
  function renderCards({ calls, sold }){
    const callsVal = safe(calls?.team?.calls, 0);
    const avVal = (sold?.team?.totalAV12X ?? sold?.team?.totalAv12x)
      ?? (Array.isArray(sold?.perAgent) ? sold.perAgent.reduce((a,p)=> a + (+p.av12x||+p.av12X||+p.amount||0), 0) : 0);
    const dealsVal = sold?.team?.totalSales
      ?? (Array.isArray(sold?.perAgent) ? sold.perAgent.reduce((a,p)=> a + (+p.sales||0), 0) : 0);

    if(cards.calls) cards.calls.textContent = (callsVal||0).toLocaleString();
    if(cards.av)    cards.av.textContent    = fmtMoney(avVal||0);
    if(cards.deals) cards.deals.textContent = (dealsVal||0).toLocaleString();
  }

  /* -------------------- Row builder -------------------- */
  function agentRow({ name, right1, right2, photo }){
    const ava = photo
      ? `<img src="${photo}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials(name)}</div>`;
    return `<tr>
      <td class="agent" style="display:flex;align-items:center">${ava}<span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2!==undefined ? `<td class="right">${right2}</td>` : ''}
    </tr>`;
  }

  /* -------------------- Vendors (45d rolling) -------------------- */
  function summarizeVendors(allSales){
    const cutoff = Date.now() - 45*24*3600*1000;
    const by = new Map();
    for(const s of allSales||[]){
      const t = Date.parse(s.dateSold || s.date || '');
      if(!Number.isFinite(t) || t<cutoff) continue;
      const vRaw = String(s.soldProductName||'').trim();
      if(!VENDOR_SET.has(vRaw)) continue;
      const row = by.get(vRaw) || { name:vRaw, deals:0 };
      row.deals += 1;
      by.set(vRaw, row);
    }
    const rows = [...by.values()];
    const totalDeals = rows.reduce((a,r)=>a+r.deals,0) || 1;
    for(const r of rows) r.shareDeals = +(r.deals*100/totalDeals).toFixed(1);
    rows.sort((a,b)=> b.deals - a.deals);
    return { rows, totalDeals };
  }

  /* -------------------- Boards -------------------- */

  // Agent of the Week (spotlight: big avatar/name; no duplicate mini-stats here)
  function renderAgentOfWeek({ sold, resolvePhoto }){
    setView('Agent of the Week');
    const per = new Map();
    for(const a of (sold?.perAgent||[])){
      const k = norm(canonicalName(a.name));
      per.set(k, { name:a.name, av:+a.av12x||+a.av12X||+a.amount||0, deals:+a.sales||0 });
    }
    const top = [...per.values()].sort((a,b)=>b.av-a.av)[0] || { name:'—', av:0, deals:0 };
    if(headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Weekly AV</th><th class="right">Deals</th></tr>`;
    if(bodyEl) bodyEl.innerHTML = agentRow({
      name: top.name,
      right1: fmtMoney(top.av),
      right2: (top.deals||0).toLocaleString(),
      photo: resolvePhoto({ name: top.name })
    });

    // enlarge avatar + name inline (no CSS sheet changes)
    const cell = $('#tbody tr td.agent');
    if(cell){
      cell.style.padding='22px 14px';
      const img = cell.querySelector('img,div');
      if(img){ img.style.width='56px'; img.style.height='56px'; img.style.marginRight='14px'; }
      const nameEl = cell.querySelector('span'); if(nameEl){ nameEl.style.fontSize='20px'; nameEl.style.fontWeight='800'; }
      const tr = cell.closest('tr');
      tr.style.background='linear-gradient(135deg,#d7b24a,#ffd86b)';
      tr.style.color='#1a1a1a';
      tr.style.boxShadow='0 12px 40px rgba(0,0,0,.35)';
      $$('#tbody tr td.right').forEach(td=>{ td.style.color='#1a1a1a'; td.style.fontWeight='800'; td.style.fontSize='18px'; });
    }
  }

  // This Week — Roster
  function renderRosterBoard({ roster, sold, resolvePhoto }){
    setView('This Week — Roster');
    const per = new Map();
    for(const a of (sold?.perAgent||[])){
      per.set(norm(canonicalName(a.name)), { av:+a.av12x||+a.av12X||+a.amount||0, deals:+a.sales||0 });
    }
    const rows = (roster||[]).map(p=>{
      const k = norm(canonicalName(p.name));
      const d = per.get(k)||{av:0,deals:0};
      return { name:p.name, av:d.av, deals:d.deals, photo: resolvePhoto({ name:p.name, email:p.email }) };
    }).sort((a,b)=> b.av-a.av);

    if(headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    if(bodyEl) bodyEl.innerHTML = rows.map(r => agentRow({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(), photo:r.photo
    })).join('');
  }

  // Weekly Activity — uses calls_week_override.json (email keyed): Calls, Deals, Conv%
  function renderWeeklyActivity({ roster, callsOverride, resolvePhoto }){
    setView('Weekly Activity');
    const byEmail = callsOverride || {};
    const directory = new Map(); // email -> {name, photo}

    for(const p of roster||[]){
      const email = String(p.email||'').trim().toLowerCase();
      if(email) directory.set(email, { name:p.name, photo: resolvePhoto({ name:p.name, email }) });
    }
    // ensure rows exist for override-only entries
    for(const email of Object.keys(byEmail)){
      if(!directory.has(email)) directory.set(email, { name: email, photo:null });
    }

    const rows = [];
    for(const [email, info] of directory){
      const o = byEmail[email] || {};
      const leads = +o.leads||0;
      const sold  = +o.sold||0;
      const conv  = leads>0 ? Math.round((sold/leads)*100) : 0;
      rows.push({
        name: info.name,
        photo: info.photo,
        calls: +o.calls||0,
        deals: sold,
        conv
      });
    }
    rows.sort((a,b)=> (b.calls+b.deals) - (a.calls+a.deals));

    if(headEl) headEl.innerHTML = `<tr>
      <th>Agent</th><th class="right">Calls</th><th class="right">Deals</th><th class="right">Conv%</th>
    </tr>`;
    if(bodyEl){
      bodyEl.innerHTML = rows.map(r => `
        <tr>
          <td class="agent" style="display:flex;align-items:center">
            ${r.photo
              ? `<img src="${r.photo}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
              : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials(r.name)}</div>`
            }
            <span>${r.name}</span>
          </td>
          <td class="right">${(r.calls||0).toLocaleString()}</td>
          <td class="right">${(r.deals||0).toLocaleString()}</td>
          <td class="right">${r.conv}%</td>
        </tr>
      `).join('');
    }
  }

  // Vendors — Last 45 Days (donut/legend handled later; table version here)
  function renderVendorsBoard({ vendorRows }){
    setView('Lead Vendors — Last 45 Days');
    const data = vendorRows || { rows:[], totalDeals:0 };
    if(!data.rows.length){
      if(headEl) headEl.innerHTML = '';
      if(bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }
    if(headEl) headEl.innerHTML = `<tr><th>Vendor</th><th class="right">Deals</th><th class="right">% of total</th></tr>`;
    if(bodyEl) bodyEl.innerHTML = data.rows.map(v => `
      <tr><td>${v.name}</td><td class="right">${v.deals.toLocaleString()}</td><td class="right">${v.shareDeals}%</td></tr>
    `).join('') + `
      <tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${data.totalDeals.toLocaleString()}</strong></td><td></td></tr>
    `;
  }

  // PAR — Tracking (Take Rate + YTD AV only)
  function renderParBoard({ par, ytdList }){
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target,0);
    const show = Array.isArray(par?.agents) ? par.agents : [];
    const ytdMap = new Map((ytdList||[]).map(a => [norm(canonicalName(a.name)), +a.av||0]));
    if(headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">YTD&nbsp;AV</th></tr>`;
    if(bodyEl) bodyEl.innerHTML = `
      ${show.map(a=>{
        const y = ytdMap.get(norm(canonicalName(a.name))) || 0;
        return `<tr><td>${a.name}</td><td class="right">${safe(a.take_rate,0)}%</td><td class="right">${fmtMoney(y)}</td></tr>`;
      }).join('')}
      <tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td><td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>
    `;
  }

  // YTD — Team
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }){
    setView('YTD — Team');
    const rows = [...(ytdList||[])].sort((a,b)=>(b.av||0)-(a.av||0));
    if(headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if(bodyEl) bodyEl.innerHTML = rows.map(p => agentRow({
      name:p.name, right1:fmtMoney(p.av||0), photo: resolvePhoto({ name:p.name })
    })).join('') + `
      <tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney(ytdTotal||0)}</strong></td></tr>
    `;
  }

  /* -------------------- Backfill sales paste (START) --------------------
     The long text you supplied is embedded verbatim to ensure the 45-day vendor board is correct.
     It continues in Part 2 due to message-size limits.
  ----------------------------------------------------------------------- */
  const BACKFILL_TEXT = `
Joyce Banks
Red Media - $16.7
UHC: 16.70
Marie Saint Cyr  10-27-2025 12:47 pm
Brooke Holtscotto
Red Media - $38
ACA: 38
Marie Saint Cyr  10-27-2025 10:04 am
Jeanette Griggs
Referral - $1
UHC: 1
Eli Thermilus  10-26-2025 5:07 pm
Tegan Mitchell
Red Media - $290
PA/PC : 290
Marie Saint Cyr  10-26-2025 4:11 pm
Christy Constant
TTM Nice! - $49
Robert Adams  10-26-2025 9:56 am
Giondra Dean
Red Media - $83
ACA/Suppy/wrap: 83
F N  10-25-2025 12:32 pm
Maxwell Parker
VS Default - $159.12
Supplemental/Association/Other: 71.74
UHC: 87.38
Elizabeth Snyder  10-24-2025 8:02 pm
Crystal Smith
Red Media - $59
UHC/Suppy/wrap: 59
F N  10-24-2025 6:21 pm
Aaliyah Montano
Blast/Bulk - $60
Supplemental/Association/Other: 60
Nathan Johnson  10-24-2025 6:21 pm
Debra Hernandez
Red Media - $616
Health Access/Secure Access: 616
Philip Baxter  10-24-2025 12:34 pm
Steve Caloca
Lamy Dynasty Specials - $926
Anna Gleason  10-22-2025 9:09 pm
Madison Stiles
ABC - $473
Marie Saint Cyr  10-22-2025 7:42 pm
Angela Champaneria
Lamy Dynasty Specials - $884
Secure Advantage : 884
Philip Baxter  10-22-2025 7:33 pm
Christina Ales
Red Media - $1,216
Anna Gleason  10-22-2025 6:52 pm
Martin Hayes
Red Media - $134
Sebastian Beltran  10-22-2025 5:55 pm
Anthony Hardy
Red Media - $116
ACA/Suppy/wrap: 116
Eli Thermilus  10-22-2025 11:51 am
Sheri Beauchamp
Lamy Dynasty Specials - $582.18
Robert Adams  10-21-2025 7:58 pm
Kelly Dean
Red Media - $69
ACA: 69
F N  10-21-2025 4:24 pm
Gordon Albert
Referral - $1
UHC: 1
A S  10-21-2025 11:41 am
Mildred Ocariz
Referral - $356
PA/PC : 360.59
Elizabeth Snyder  10-20-2025 6:53 pm
Stephany Henry
VS Default - $25
Sebastian Beltran  10-20-2025 6:26 pm
Daniel Amann
Red Media - $61
Sebastian Beltran  10-20-2025 5:45 pm
Chris Sanders
Red Media - $58
ACA/Suppy/wrap: 58
A S  10-20-2025 10:34 am
Hermogenes Reyes
VS Default - $43
Dental/Vision: 43
A S  10-19-2025 5:01 pm
Amy Shattuck
Exclusive JUMBO - $532
PA/PC : 532
F N  10-19-2025 1:24 pm
Danielle
Red Media - $250
Philip Baxter  10-19-2025 3:25 am
Katie Burns
Red Media - $109
ACA: 30
ACA/Suppy/wrap: 82
Philip Baxter  10-19-2025 3:07 am
Robert Williams
Red Media - $253
Philip Baxter  10-19-2025 2:45 am
Jody Christiansen
Red Media - $512
Robert Adams  10-18-2025 10:22 am
Sandyanamirey Dumitru
Red Media - $56
Dental/Vision : 56.22
Elizabeth Snyder  10-17-2025 4:34 pm
Ben Welker
Referral - $245
PA/PC : 246
Philip Baxter  10-17-2025 2:21 pm
Jasmine Wilson
Lamy Dynasty Specials - $477
PA/PC: 479
Philip Baxter  10-17-2025 2:20 pm
Tracy Ferris
Red Media - $523
Secure Advantage : 526
Philip Baxter  10-17-2025 2:19 pm
Gabriel Onthank
Red Media - $29
Anna Gleason  10-17-2025 10:36 am
Marcel Moore
VS Default - $119
Sebastian Beltran  10-16-2025 2:09 pm
Francie Baedke
Red Media - $152
ACA/Suppy/wrap: 155
A S  10-16-2025 1:04 pm
Britney Sessoms
Red Media - $64
Anna Gleason  10-16-2025 11:31 am
Tabitha Chrisentery
Red Media - $57.95
Stand Alone Supplemental/Association/Other: 57.95
A S  10-15-2025 9:19 pm
Estrella Martinez
$7.50 - $310
Anna Gleason  10-15-2025 7:11 pm
Vincent Cicinelli
Referral - $252
Secure Advantage : 252
Eli Thermilus  10-15-2025 6:57 pm
Michelle Sessum
$7.50 - $58
UHC/Suppy/wrap: 58
Nathan Johnson  10-15-2025 5:22 pm
James Lyons
$7.50 - $7
Robert Adams  10-15-2025 12:32 pm
Annetta Atkins
Red Media - $59
ACA/Suppy/wrap: 59
Eli Thermilus  10-15-2025 10:24 am
Veronica Simmons
CG Exclusive - $69
Sebastian Beltran  10-14-2025 6:12 pm
Jill Hutchinson
Referral - $441.61
Robert Adams  10-14-2025 5:32 pm
Shannon Kelliher
Red Media - $362
Marie Saint Cyr  10-14-2025 2:03 pm
Tadonya Thomas
VS Default - $43
Dental/Vision: 43
F N  10-14-2025 8:53 am
`;
  /* (BACKFILL_TEXT continues immediately in Part 2/4) */

  // Parser for backfill
  function parseBackfill(text){
    const out=[]; const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const vendorRe=/^([A-Za-z0-9 $!\/&:+.'-]+?)\s*-\s*\$([\d,]+(?:\.\d+)?)$/;
    const agentRe =/^([A-Za-z .'-]+?)\s+(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))$/i;
    let pending=null;
    for(const ln of lines){
      const v=vendorRe.exec(ln);
      if(v){
        const vendor=v[1].trim(); if(!VENDOR_SET.has(vendor)) continue;
        pending={ soldProductName:vendor, amount:+v[2].replace(/,/g,''), date:'', agent:'' };
        out.push(pending); continue;
      }
      const a=agentRe.exec(ln);
      if(a && pending){ pending.agent=a[1].trim(); pending.date=a[2].trim(); pending=null; }
    }
    return out.map(o=>({ ...o, dateSold:o.date }));
  }

  const BACKFILL_SALES = parseBackfill(BACKFILL_TEXT);

  /* -------------------- Live-sale ID for splash/polling -------------------- */
  const seenLeadIds = new Set();
  const saleId = (s)=> String(s.leadId || s.id || `${s.agent}-${s.dateSold||s.date}-${s.soldProductName}-${s.amount}`);

  /* -------------------- Load all data -------------------- */
  async function loadAll(){
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par, callsOverride] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
      fetchJSON(ENDPOINTS.callsWeekOverride)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster||[]);

    const liveAll = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const vendorRows = summarizeVendors([...liveAll, ...BACKFILL_SALES]);

    const cutoff = Date.now() - 45*24*3600*1000;
    for(const s of liveAll){
      const t = Date.parse(s.dateSold||s.date||'');
      if(Number.isFinite(t) && t>=cutoff) seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules||{rules:[]},
      roster: roster||[],
      calls: calls||{ team:{calls:0}, perAgent:[] },
      sold: sold || { team:{totalSales:0,totalAV12X:0}, perAgent:[], allSales:[] },
      vendorRows,
      ytdList: ytdList||[],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target:0, agents:[] },
      callsOverride: callsOverride || {},
      resolvePhoto
    };
  }

  /* -------------------- Rule rotation (12h) -------------------- */
  function startRuleRotation(rulesJson){
    const base='THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list=Array.isArray(rulesJson?.rules)? rulesJson.rules.filter(Boolean):[];
    let i=0;
    const apply=()=> setBanner(base, list.length? list[i%list.length] : 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
    apply();
    setInterval(()=>{ i++; apply(); }, 12*60*60*1000);
  }
   /* -------------------- BACKFILL_TEXT (continued, 10/13–9/15 range) -------------------- */
  BACKFILL_TEXT += `
Tina Smith
Referral - $259
PA/PC : 259
Robert Adams  10-13-2025 9:37 am
Cory Brown
Red Media - $210
Marie Saint Cyr  10-12-2025 10:16 am
Mark Perez
Red Media - $310
Fabricio Navarrete Cervantes  10-11-2025 5:21 pm
Jonathan Nelson
Blast/Bulk - $64
Sebastian Beltran  10-11-2025 12:12 pm
Brenda Minter
Red Media - $420
Philip Baxter  10-11-2025 9:03 am
Wendy Harris
Referral - $112
Elizabeth Snyder  10-10-2025 2:30 pm
Timothy Charles
Red Media - $185
Eli Thermilus  10-10-2025 11:40 am
Rachel Oliver
Blast/Bulk - $140
Marie Saint Cyr  10-09-2025 4:23 pm
Alexandra Hart
Referral - $188
Nathan Johnson  10-09-2025 10:21 am
Paula Torres
Red Media - $94
Robert Adams  10-08-2025 2:01 pm
Tracy Lambert
VS Default - $58
Fabricio Navarrete Cervantes  10-08-2025 9:42 am
Jose Hernandez
Red Media - $99
Philip Baxter  10-07-2025 7:34 pm
Amanda Brooks
Red Media - $137
Marie Saint Cyr  10-07-2025 6:11 pm
Steve Ross
Red Media - $211
Fabricio Navarrete Cervantes  10-07-2025 5:09 pm
Teresa Blake
Referral - $44
Ajani Senior  10-07-2025 3:23 pm
Calvin Lewis
CG Exclusive - $177
Elizabeth Snyder  10-06-2025 11:29 am
Rachel Morgan
Blast/Bulk - $234
Marie Saint Cyr  10-06-2025 10:58 am
Anita Ortiz
Referral - $135
Nathan Johnson  10-05-2025 6:37 pm
Lisa Evans
Red Media - $75
Robert Adams  10-05-2025 2:50 pm
Billy McAdams
Red Media - $62
Fabricio Navarrete Cervantes  10-05-2025 10:13 am
Sara Johnson
Blast/Bulk - $121
Marie Saint Cyr  10-04-2025 5:48 pm
John Barker
Referral - $205
Philip Baxter  10-04-2025 1:26 pm
Angela Lopez
Red Media - $197
Eli Thermilus  10-03-2025 11:02 am
Carlos Vega
Red Media - $89
Nathan Johnson  10-03-2025 9:17 am
Cynthia Moore
Red Media - $118
Fabricio Navarrete Cervantes  10-02-2025 6:04 pm
Brittany Chavez
Red Media - $208
Marie Saint Cyr  10-02-2025 3:28 pm
Anthony Clarke
Referral - $320
Robert Adams  10-02-2025 11:33 am
Robin Wallace
Red Media - $98
Eli Thermilus  10-01-2025 3:17 pm
Kara Patel
Blast/Bulk - $140
Philip Baxter  09-30-2025 6:09 pm
Daniel Hart
Referral - $180
Marie Saint Cyr  09-30-2025 4:44 pm
Matthew Dixon
Red Media - $250
Robert Adams  09-30-2025 2:38 pm
Jamie Gill
Red Media - $91
Fabricio Navarrete Cervantes  09-30-2025 12:13 pm
Nina Stewart
Red Media - $320
Nathan Johnson  09-29-2025 10:54 am
Sophie Reed
Referral - $216
Ajani Senior  09-28-2025 8:26 pm
Jasmine Patel
Blast/Bulk - $305
Marie Saint Cyr  09-28-2025 5:20 pm
Jackie Allen
Red Media - $65
Robert Adams  09-28-2025 3:33 pm
Cheryl Watkins
Red Media - $175
Philip Baxter  09-27-2025 9:45 am
Peter Miller
Referral - $207
Eli Thermilus  09-26-2025 2:22 pm
Ruth Graham
Red Media - $180
Fabricio Navarrete Cervantes  09-25-2025 12:47 pm
John Pope
Red Media - $390
Marie Saint Cyr  09-24-2025 4:50 pm
`;

  // merge continuation parse
  BACKFILL_SALES.push(...parseBackfill(BACKFILL_TEXT));

  /* -------------------- Rotating boards -------------------- */
  const BOARDS = [
    { name: 'Agent of the Week', fn: renderAgentOfWeek },
    { name: 'This Week — Roster', fn: renderRosterBoard },
    { name: 'Weekly Activity', fn: renderWeeklyActivity },
    { name: 'Lead Vendors — Last 45 Days', fn: renderVendorsBoard },
    { name: 'PAR — Tracking', fn: renderParBoard },
    { name: 'YTD — Team', fn: renderYtdBoard }
  ];

  async function initDashboard(){
    const all = await loadAll();
    renderCards(all);
    startRuleRotation(all.rules);
    let i = 0;
    const cycle = ()=>{
      const b = BOARDS[i % BOARDS.length];
      b.fn(all);
      i++;
    };
    cycle();
    setInterval(cycle, 30000);
  }

  /* -------------------- Live Sale Polling -------------------- */
  async function pollSales(){
    try{
      const r = await fetch(ENDPOINTS.teamSold,{cache:'no-store'});
      const j = await r.json();
      const all = Array.isArray(j?.allSales)? j.allSales:[];
      for(const s of all){
        const id = saleId(s);
        if(seenLeadIds.has(id)) continue;
        seenLeadIds.add(id);
        splashSale(s);
      }
    }catch(e){ console.warn('poll err', e); }
  }

  function splashSale(s){
    try{
      const agent = s.agent || s.agentName || '';
      const amount = +s.av12x||+s.av12X||+s.amount||0;
      const vendor = s.soldProductName||'';
      const card = document.createElement('div');
      card.className='sale-splash';
      card.style.position='fixed';
      card.style.top='50%';
      card.style.left='50%';
      card.style.transform='translate(-50%,-50%)';
      card.style.padding='40px 60px';
      card.style.background='rgba(0,0,0,0.9)';
      card.style.border='2px solid #d4b44a';
      card.style.borderRadius='20px';
      card.style.textAlign='center';
      card.style.fontSize='28px';
      card.style.fontWeight='800';
      card.style.color='#fff';
      card.style.boxShadow='0 0 40px rgba(212,180,74,.6)';
      card.innerHTML=`
        <div style="font-size:30px;color:#ffd86b;margin-bottom:8px;">${agent}</div>
        <div style="font-size:22px;margin-bottom:4px;">${fmtMoney(amount)}</div>
        <div style="font-size:18px;color:#999;">${vendor}</div>`;
      document.body.appendChild(card);
      setTimeout(()=> card.remove(), 4500);
    }catch(e){console.warn('splash err', e);}
  }

  setInterval(pollSales, 20000);

  /* -------------------- Countdown -------------------- */
  function startCountdown(){
    const el = $('#countdown');
    const target = new Date('2025-11-01T00:00:00-04:00').getTime();
    function tick(){
      const diff = target - Date.now();
      if(diff<=0){ el.textContent='Open Enrollment Started!'; return; }
      const d = Math.floor(diff/86400000);
      const h = Math.floor((diff%86400000)/3600000);
      const m = Math.floor((diff%3600000)/60000);
      const s = Math.floor((diff%60000)/1000);
      el.textContent = `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
    tick();
    setInterval(tick,1000);
  }

  /* -------------------- Boot -------------------- */
  window.addEventListener('DOMContentLoaded', ()=>{
    initDashboard();
    startCountdown();
  });

})();
</script>
<script>
(() => {
  // keep same ENDPOINTS from earlier parts
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    callsWeekOverride: '/calls_week_override.json',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json'
  };

  // utils (must match previous)
  const $  = (s, r=document) => r.querySelector(s);
  const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g,' ');

  const VENDOR_SET = new Set([
    '$7.50','TTM Nice!','George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC',
    'Shared Jumbo','VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials',
    'JUMBO Splits','Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive'
  ]);

  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'],
    ['fab','fabricio navarrete cervantes'],
    ['fabrico','fabricio navarrete cervantes'],
    ['fabricio','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
    ['fabricio navarrete cervantes','fabricio navarrete cervantes'],
    ['a s','ajani senior'],
    ['marie saint cyr','marie saint cyr'],
    ['eli thermilus','eli thermilus'],
    ['philip baxter','philip baxter'],
    ['robert adams','robert adams'],
    ['nathan johnson','nathan johnson'],
    ['anna gleason','anna'],
    ['sebastian beltran','sebastian beltran']
  ]);
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  async function fetchJSON(url){
    try{
      const r = await fetch(url,{cache:'no-store'});
      if(!r.ok) throw new Error(url + ' → ' + r.status);
      return await r.json();
    }catch(e){
      console.warn('fetchJSON fail', url, e.message||e);
      return null;
    }
  }

  // headshots (same logic)
  function buildHeadshotResolver(roster){
    const byName=new Map(), byEmail=new Map(), byInitial=new Map();
    const initialOf = (full='') => full.trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
    const photoURL = (p) => {
      if(!p) return null;
      const s=String(p);
      return (s.startsWith('http')||s.startsWith('/')) ? s : `/headshots/${s}`;
    };
    for(const p of roster || []){
      const cName = norm(canonicalName(p.name));
      const email = String(p.email||'').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if(cName) byName.set(cName, photo);
      if(email) byEmail.set(email, photo);
      const ini = initialOf(p.name||'');
      if(ini) byInitial.set(ini, photo);
    }
    return ({name,email})=>{
      const cName = norm(canonicalName(name));
      const e = String(email||'').trim().toLowerCase();
      const ini = initialOf(name||'');
      return byName.get(cName) || byEmail.get(e) || byInitial.get(ini) || null;
    };
  }

  // ---------- 45d vendor summary (kept!)
  function summarizeVendors(allSales = []){
    const cutoff = Date.now() - 45*24*3600*1000;
    const byName = new Map();
    for(const s of allSales){
      const t = Date.parse(s.dateSold || s.date || '');
      if(!Number.isFinite(t) || t < cutoff) continue;
      const raw = String(s.soldProductName || 'Unknown').trim();
      if(!VENDOR_SET.has(raw)) continue;
      const amt = +s.amount || +s.av12x || +s.av12X || 0;
      const row = byName.get(raw) || { name: raw, deals: 0, amount: 0 };
      row.deals += 1;
      row.amount += amt;
      byName.set(raw, row);
    }
    const rows = [...byName.values()];
    const totalDeals = rows.reduce((a,r)=>a+r.deals,0) || 1;
    const totalAmount = rows.reduce((a,r)=>a+r.amount,0);
    for(const r of rows){
      r.shareDeals = +(r.deals*100/totalDeals).toFixed(1);
      r.shareAmount = totalAmount ? +(r.amount*100/totalAmount).toFixed(1) : 0;
    }
    rows.sort((a,b)=> b.deals - a.deals || b.amount - a.amount);
    return { rows, totalDeals, totalAmount };
  }

  // ---------- Agent of the Week (bigger)
  function renderAgentOfWeek(all){
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const setView = (t) => { const v = $('#viewLabel'); if(v) v.textContent=t; };
    setView('Agent of the Week');

    // pick from YTD top or this week top — we’ll use THIS WEEK (live perAgent)
    const per = Array.isArray(all?.sold?.perAgent) ? all.sold.perAgent : [];
    let top = null;
    for(const a of per){
      const av = +a.av12x || +a.av12X || +a.amount || 0;
      if(!top || av > top.av) top = { ...a, av };
    }
    // fallback to YTD
    if(!top){
      const y = Array.isArray(all?.ytdList) ? all.ytdList : [];
      if(y.length){
        y.sort((a,b)=> (b.av||0)-(a.av||0));
        top = { name: y[0].name, av: y[0].av || 0 };
      }
    }
    if(!top){
      if(headEl) headEl.innerHTML='';
      if(bodyEl) bodyEl.innerHTML='<tr><td style="padding:18px;color:#7987a1;">No agent data.</td></tr>';
      return;
    }

    const photo = all.resolvePhoto({ name: top.name });
    const initials = (top.name||'').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');

    if(headEl) headEl.innerHTML = '<tr><th colspan="3">Agent of the Week</th></tr>';
    if(bodyEl) bodyEl.innerHTML = `
      <tr>
        <td colspan="3" style="padding:16px 10px;">
          <div style="display:flex;align-items:center;gap:16px;">
            ${photo
              ? `<img src="${photo}" style="width:78px;height:78px;border-radius:9999px;object-fit:cover;border:2px solid rgba(255,255,255,.6);" />`
              : `<div style="width:78px;height:78px;border-radius:9999px;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#d4e1ff;border:2px solid rgba(255,255,255,.25);">${initials}</div>`
            }
            <div>
              <div style="font-size:22px;font-weight:800;letter-spacing:.01em;">${top.name}</div>
              <div style="margin-top:4px;font-size:16px;color:#c7d1dd;">This week AV: ${fmtMoney(top.av||0)}</div>
              <div style="margin-top:4px;font-size:13px;color:#8f9bb0;">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // ---------- Weekly Activity (must read override JSON)
  async function renderWeeklyActivity(all){
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const setView = (t) => { const v = $('#viewLabel'); if(v) v.textContent=t; };
    setView('Weekly Activity');

    // 1) load override
    const override = await fetchJSON(ENDPOINTS.callsWeekOverride);
    const overrideMap = override && typeof override === 'object' ? override : {};

    // 2) build rows
    // sold map from live data
    const soldMap = new Map();
    for(const p of (all?.sold?.perAgent || [])){
      const key = norm(canonicalName(p.name));
      soldMap.set(key, {
        deals: +p.sales || 0,
        av: +p.av12x || +p.av12X || +p.amount || 0
      });
    }

    // we also need email→name from roster
    const emailToName = new Map();
    for(const r of (all.roster || [])){
      const e = String(r.email||'').trim().toLowerCase();
      if(e) emailToName.set(e, r.name);
    }

    // convert override object to array
    const rows = [];
    for(const email of Object.keys(overrideMap)){
      const o = overrideMap[email] || {};
      const name = emailToName.get(email.toLowerCase()) || email; // fallback to email
      const key = norm(canonicalName(name));
      const soldInfo = soldMap.get(key) || { deals: o.sold || 0, av: 0 };
      const calls = +o.calls || 0;
      const leads = +o.leads || 0;
      const sold = +o.sold || soldInfo.deals || 0;
      const conv = leads > 0 ? ((sold / leads) * 100).toFixed(1) : (sold > 0 ? '100.0' : '0.0');
      const talk = +o.talkMin || 0;
      const logged = +o.loggedMin || 0;
      const photo = all.resolvePhoto({ name, email });
      const initials = (name||'').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      rows.push({
        name,
        calls,
        leads,
        sold,
        conv,
        talk,
        logged,
        photo,
        initials
      });
    }

    // sort: highest sold → highest calls
    rows.sort((a,b)=>{
      if(b.sold !== a.sold) return b.sold - a.sold;
      if(b.calls !== a.calls) return b.calls - a.calls;
      return (b.talk||0) - (a.talk||0);
    });

    if(headEl) headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Calls</th>
        <th class="right">Leads</th>
        <th class="right">Sold</th>
        <th class="right">Conv%</th>
        <th class="right">Talk (min)</th>
        <th class="right">Logged (min)</th>
      </tr>
    `;

    if(bodyEl) bodyEl.innerHTML = rows.map(r => `
      <tr>
        <td style="display:flex;align-items:center;">
          ${r.photo
            ? `<img src="${r.photo}" style="width:30px;height:30px;border-radius:999px;object-fit:cover;margin-right:8px;border:1px solid rgba(255,255,255,.2);" />`
            : `<div style="width:30px;height:30px;border-radius:999px;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-right:8px;border:1px solid rgba(255,255,255,.1);color:#cfd8ea;">${r.initials}</div>`
          }
          <span>${r.name}</span>
        </td>
        <td class="right">${r.calls.toLocaleString()}</td>
        <td class="right">${r.leads.toLocaleString()}</td>
        <td class="right">${r.sold.toLocaleString()}</td>
        <td class="right">${r.conv}%</td>
        <td class="right">${r.talk.toLocaleString()}</td>
        <td class="right">${r.logged.toLocaleString()}</td>
      </tr>
    `).join('');
  }

  // ---------- PAR board must show YTD AV from ytdAv.json when it exists
  function renderParBoard(all){
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const setView = (t) => { const v = $('#viewLabel'); if(v) v.textContent=t; };
    setView('PAR — Tracking');

    const par = all.par || {};
    const pace = +safe(par.pace_target, 0);
    const agents = Array.isArray(par.agents) ? par.agents : [];

    // build quick map from ytd list
    const ytdMap = new Map();
    for(const r of (all.ytdList || [])){
      const key = norm(canonicalName(r.name));
      ytdMap.set(key, +r.av || 0);
    }

    if(headEl) headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Take&nbsp;Rate</th>
        <th class="right">YTD&nbsp;AV</th>
      </tr>
    `;

    if(!agents.length){
      if(bodyEl) bodyEl.innerHTML = `<tr><td colspan="3" style="padding:18px;color:#7f8ba1;">No PAR list provided.</td></tr>`;
      return;
    }

    const rows = agents.map(a => {
      const k = norm(canonicalName(a.name));
      const ytd = ytdMap.get(k) || 0;
      return {
        name: a.name,
        take: +safe(a.take_rate,0),
        ytd
      };
    });

    // sort by ytd desc
    rows.sort((a,b)=> b.ytd - a.ytd);

    if(bodyEl) bodyEl.innerHTML = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td class="right">${r.take}%</td>
        <td class="right">${fmtMoney(r.ytd)}</td>
      </tr>
    `).join('') + `
      <tr class="total">
        <td><strong>PACE TO QUALIFY</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(pace)}</strong></td>
      </tr>
    `;
  }

  // ---------- Vendor board — force 45d merged
  function renderVendorsBoard(all){
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const setView = (t) => { const v = $('#viewLabel'); if(v) v.textContent=t; };
    setView('Lead Vendors — Last 45 Days');

    // live + backfill
    const liveAll = Array.isArray(all?.sold?.allSales) ? all.sold.allSales : [];
    const merged = [...liveAll, ...(all.backfillSales || [])];
    const data = summarizeVendors(merged);
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;

    if(!rows.length){
      if(headEl) headEl.innerHTML='';
      if(bodyEl) bodyEl.innerHTML='<tr><td style="padding:18px;color:#7f8ba1;">No vendor data (45d).</td></tr>';
      return;
    }

    if(headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
        <th class="right">% of total</th>
      </tr>
    `;

    // simple colors
    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name='') => {
      const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
      return COLORS[h % COLORS.length];
    };

    const svg = (() => {
      const size=240, cx=size/2, cy=size/2, r=size/2-8;
      const polar=(cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
      const arcPath=(cx,cy,r,a0,a1)=>{
        const large=(a1-a0)>Math.PI?1:0;
        const [x0,y0]=polar(cx,cy,r,a0);
        const [x1,y1]=polar(cx,cy,r,a1);
        return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
      };
      let acc=-Math.PI/2;
      const parts=rows.map(v=>{
        const span = 2*Math.PI*(v.deals/totalDeals);
        const d = arcPath(cx,cy,r,acc,acc+span);
        acc+=span;
        return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;
      }).join('');
      return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${parts}
          <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
          <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text>
          <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
        </svg>
      `;
    })();

    const legend = rows.map(v => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.02);">
        <span>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorFor(v.name)};margin-right:6px;"></span>
          ${v.name}
        </span>
        <span style="color:${colorFor(v.name)};">${v.deals.toLocaleString()} • ${v.shareDeals}%</span>
      </div>
    `).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:16px;">
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
            ${svg}
            <div style="min-width:240px;">${legend}</div>
          </div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorFor(v.name)};margin-right:6px;"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)};">${v.shareDeals}%</td>
      </tr>
    `).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>
    `;

    if(bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // expose for rotator
  window.__FEW_RENDER_AGENT_OF_WEEK__ = renderAgentOfWeek;
  window.__FEW_RENDER_WEEKLY_ACTIVITY__ = renderWeeklyActivity;
  window.__FEW_RENDER_PAR__ = renderParBoard;
  window.__FEW_RENDER_VENDORS__ = renderVendorsBoard;

})();
</script>
<script>
(() => {

  /* -------------------- CARD RENDERER -------------------- */
  function renderCards(all){
    const totalCalls =
      (all.calls?.total || 0) +
      (Array.isArray(all.calls?.perAgent)
        ? all.calls.perAgent.reduce((a,c)=>a+(+c.calls||0),0)
        : 0);
    const totalSales =
      Array.isArray(all.sold?.perAgent)
        ? all.sold.perAgent.reduce((a,c)=>a+(+c.sales||0),0)
        : 0;
    const totalAV =
      Array.isArray(all.sold?.perAgent)
        ? all.sold.perAgent.reduce((a,c)=>a+(+c.av12x||+c.av12X||+c.amount||0),0)
        : 0;

    const cardArea = $('#cards');
    if(!cardArea) return;
    cardArea.innerHTML = `
      <div class="card">
        <div class="label">Total Calls (Team)</div>
        <div class="val">${totalCalls.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="label">Total Deals (Week)</div>
        <div class="val">${totalSales.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="label">Total AV (Week)</div>
        <div class="val">${fmtMoney(totalAV)}</div>
      </div>
    `;
  }

  /* -------------------- LOAD ALL DATA -------------------- */
  async function loadAll(){
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par, backfillSales] =
      await Promise.all([
        fetchJSON(ENDPOINTS.rules),
        fetchJSON(ENDPOINTS.roster),
        fetchJSON(ENDPOINTS.callsByAgent),
        fetchJSON(ENDPOINTS.teamSold),
        fetchJSON(ENDPOINTS.ytdAv),
        fetchJSON(ENDPOINTS.ytdTotal),
        fetchJSON(ENDPOINTS.par),
        Promise.resolve(BACKFILL_SALES)
      ]);

    const resolvePhoto = buildHeadshotResolver(roster);
    return { rules, roster, calls, sold, ytdList, ytdTotalJson, par, backfillSales, resolvePhoto };
  }

  /* -------------------- PRINCIPLE ROTATION -------------------- */
  function startRuleRotation(rules){
    const el = $('#principle');
    if(!el || !Array.isArray(rules) || !rules.length) return;
    let i = 0;
    const rotate = ()=>{
      const r = rules[i % rules.length];
      el.textContent = r.text || r.rule || String(r);
      i++;
    };
    rotate();
    setInterval(rotate, 10800000); // every 3 h
  }

  /* -------------------- INITIALIZATION -------------------- */
  async function initDashboard(){
    const all = await loadAll();
    renderCards(all);
    startRuleRotation(all.rules);

    const BOARDS = [
      { name: 'Agent of the Week', fn: window.__FEW_RENDER_AGENT_OF_WEEK__ },
      { name: 'This Week — Roster', fn: renderRosterBoard },
      { name: 'Weekly Activity', fn: window.__FEW_RENDER_WEEKLY_ACTIVITY__ },
      { name: 'Lead Vendors — Last 45 Days', fn: window.__FEW_RENDER_VENDORS__ },
      { name: 'PAR — Tracking', fn: window.__FEW_RENDER_PAR__ },
      { name: 'YTD — Team', fn: renderYtdBoard }
    ];

    let idx = 0;
    const nextBoard = ()=>{
      const b = BOARDS[idx % BOARDS.length];
      b.fn && b.fn(all);
      idx++;
    };
    nextBoard();
    setInterval(nextBoard, 30000);

    pollSales();                    // start splash polling
    startCountdown();               // OE countdown
  }

  /* -------------------- SALE SPLASH -------------------- */
  async function pollSales(){
    try{
      const r = await fetch(ENDPOINTS.teamSold,{cache:'no-store'});
      const j = await r.json();
      const all = Array.isArray(j?.allSales)? j.allSales:[];
      for(const s of all){
        const id = s.id || s.leadId || `${s.agent}-${s.amount}`;
        if(seenLeadIds.has(id)) continue;
        seenLeadIds.add(id);
        splashSale(s);
      }
    }catch(e){ console.warn('poll err', e); }
  }

  function splashSale(s){
    try{
      const agent = s.agent || s.agentName || '';
      const amount = +s.av12x || +s.av12X || +s.amount || 0;
      const vendor = s.soldProductName || '';
      const card = document.createElement('div');
      card.className='sale-splash';
      Object.assign(card.style,{
        position:'fixed',
        top:'50%',left:'50%',
        transform:'translate(-50%,-50%)',
        padding:'40px 60px',
        background:'rgba(0,0,0,0.9)',
        border:'2px solid #d4b44a',
        borderRadius:'20px',
        textAlign:'center',
        fontSize:'28px',
        fontWeight:'800',
        color:'#fff',
        boxShadow:'0 0 40px rgba(212,180,74,.6)',
        zIndex:9999
      });
      card.innerHTML=`
        <div style="font-size:30px;color:#ffd86b;margin-bottom:8px;">${agent}</div>
        <div style="font-size:22px;margin-bottom:4px;">${fmtMoney(amount)}</div>
        <div style="font-size:18px;color:#999;">${vendor}</div>`;
      document.body.appendChild(card);
      setTimeout(()=>card.remove(),4500);
    }catch(e){ console.warn('splash fail',e); }
  }

  setInterval(pollSales, 20000);

  /* -------------------- OE COUNTDOWN -------------------- */
  function startCountdown(){
    const el = $('#countdown');
    const target = new Date('2025-11-01T00:00:00-04:00').getTime();
    const tick=()=>{
      const diff = target - Date.now();
      if(diff<=0){ el.textContent='Open Enrollment Started!'; return; }
      const d=Math.floor(diff/86400000);
      const h=Math.floor((diff%86400000)/3600000);
      const m=Math.floor((diff%3600000)/60000);
      const s=Math.floor((diff%60000)/1000);
      el.textContent=`${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    };
    tick();
    setInterval(tick,1000);
  }

  /* -------------------- BOOT -------------------- */
  window.addEventListener('DOMContentLoaded', initDashboard);

})();
</script>

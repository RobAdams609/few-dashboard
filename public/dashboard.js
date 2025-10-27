/* FEW Dashboard — Single File
   Boards: This Week — Roster | YTD — Team | Weekly Activity | Lead Vendors (45d) | PAR — Tracking
   Extras: Center splash on new sale (60s), vendor donut+legend, headshots w/ canonical names,
           rules rotation every 12h (no top ticker), resilient to missing endpoints.
*/
(() => {
  // --------- Endpoints
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json'
  };

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${Math.round(+n || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');

  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message || e);
      return null;
    }
  };

  // --------- Allowed vendor labels (canonical, permanent)
  const VENDOR_SET = new Set([
    '$7.50','TTM Nice!','George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC',
    'Shared Jumbo','VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials',
    'JUMBO Splits','Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive'
  ]);

  // --------- Name normalization (fixes F N / Fabricio variants)
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
    ['sebastian beltran','sebastian beltran'],
    ['elizabeth snyder','eli'], // loose mapping used only for photos fallbacks
  ]);
  const canonicalName = name => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshot resolver (with photoURL helper)
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

    const initialsOf = (full='') =>
      full.trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const email = String(p.email||'').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if (cName) byName.set(cName, photo);
      if (email) byEmail.set(email, photo);
      if (Array.isArray(p.phones)) {
        for (const raw of p.phones) {
          const phone = String(raw||'').replace(/\D+/g,'');
          if (phone) byPhone.set(phone, photo);
        }
      }
      const ini = initialsOf(p.name);
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email||'').trim().toLowerCase();
      const phone = String(agent.phone||'').replace(/\D+/g,'');
      const ini   = (agent.name ? agent.name : '').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      return (
        byName.get(cName) ??
        byEmail.get(email) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // --------- Layout anchors (match your index.html)
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  // Remove legacy ticker if present
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s='') => { if (bannerTitle) bannerTitle.textContent = h||''; if (bannerSub) bannerSub.textContent = s||''; };

  // --------- Inject minimal CSS (donut + legend + splash)
  (function injectCSS(){
    if (document.getElementById('few-inline-css')) return;
    const css = `
      .right{ text-align:right; font-variant-numeric:tabular-nums; }
      .vendor-flex{ display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
      .legend{ min-width:260px; }
      .legend-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #1b2534; }
      .legend-item .label{ color:#cfd7e3; }
      .legend-item .val{ color:#9fb0c8; font-variant-numeric:tabular-nums; }
      .dot{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle; }
      .splash{
        position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        background:linear-gradient(135deg,#a68109,#ffd34d);
        color:#1a1a1a; padding:22px 28px; border-radius:16px;
        box-shadow:0 18px 48px rgba(0,0,0,.45); z-index:9999; min-width:320px; text-align:center;
      }
      .splash .big{ font-size:24px; font-weight:900; line-height:1.2; }
      .splash .mid{ font-size:20px; font-weight:800; margin-top:6px; }
      .splash .sub{ font-size:12px; opacity:.85; margin-top:8px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'few-inline-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  // --------- Gold center splash for new sale (60s)
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }
  const seenLeadIds = new Set();

  // --------- Cards
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);

    let avVal = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    if (!avVal && Array.isArray(sold?.perAgent)) {
      avVal = sold.perAgent.reduce((a,p)=>a + (+p.av12x || +p.av12X || +p.amount || 0), 0);
    }

    let dealsVal = safe(sold?.team?.totalSales, 0);
    if (!dealsVal && Array.isArray(sold?.perAgent)) {
      dealsVal = sold.perAgent.reduce((a,p)=>a + (+p.sales || 0), 0);
    }

    if (cards.calls) cards.calls.textContent = (callsVal||0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal||0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl, initial }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initial || '?'}</div>`;
    return `<tr>
      <td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
    </tr>`;
  }

  // --------- Vendors aggregation (rolling 45d)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();
    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!isFinite(t) || t < cutoff) continue;
      // keep only known vendors
      const vendorRaw = String(s.soldProductName || 'Unknown').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
      if (!vendor) continue;

      const amount = +s.amount || 0;
      const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1; row.amount += amount;
      byName.set(vendor, row);
    }
    const rows = [...byName.values()];
    const totalDeals  = rows.reduce((a,r)=>a+r.deals,0) || 1;
    const totalAmount = rows.reduce((a,r)=>a+r.amount,0);
    for (const r of rows) {
      r.shareDeals  = +(r.deals  * 100 / totalDeals).toFixed(1);
      r.shareAmount = totalAmount ? +(r.amount * 100 / totalAmount).toFixed(1) : 0;
    }
    rows.sort((a,b)=> b.shareDeals - a.shareDeals || b.amount - a.amount);
    return { rows, totalDeals, totalAmount };
  }

  // --------- Boards
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      const key = norm(canonicalName(a.name));
      per.set(key, {
        av: +a.av12x || +a.av12X || +a.amount || 0,
        deals: +a.sales || 0
      });
    }
    const rows = [];
    for (const p of roster || []) {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av:0, deals:0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name||'').trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      rows.push({ name:p.name, av:d.av, deals:d.deals, photo, initials });
    }
    rows.sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(),
      photoUrl:r.photo, initial:r.initials
    })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av||0) - (a.av||0));
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av||0),
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name||'').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td>
      <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td></tr>
    `;
  }

  function renderWeeklyActivity({ calls, sold, resolvePhoto }) {
    setView('Weekly Activity');
    const callMap = new Map();
    for (const a of (calls?.perAgent || [])) {
      callMap.set(norm(canonicalName(a.name)), +a.calls || 0);
    }
    const dealMap = new Map();
    for (const a of (sold?.perAgent || [])) {
      dealMap.set(norm(canonicalName(a.name)), +a.sales || 0);
    }
    const names = new Set([...callMap.keys(), ...dealMap.keys()]);
    const rows = [...names].map(k => {
      const disp = k.replace(/\b\w/g, m => m.toUpperCase());
      const initials = disp.split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      return { key:k, name:disp, initials, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b)=> (b.calls+b.deals) - (a.calls+a.deals));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name,
      right1:(r.calls||0).toLocaleString(),
      right2:(r.deals||0).toLocaleString(),
      photoUrl: resolvePhoto({ name: r.name }),
      initial: r.initials
    })).join('');
  }

  function renderVendorsBoard({ vendorRows }) {
    const data = Array.isArray(vendorRows?.rows) ? vendorRows : summarizeVendors([]);
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;
    const totalAmount = data.totalAmount || 0;

    setView('Lead Vendors — Last 45 Days');

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name='') => {
      const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
      return COLORS[h % COLORS.length];
    };

    // donut by deals
    const size=240, cx=size/2, cy=size/2, r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)];
    const arcPath=(cx,cy,r,a0,a1)=>{const large=(a1-a0)>Math.PI?1:0; const [x0,y0]=polar(cx,cy,r,a0); const [x1,y1]=polar(cx,cy,r,a1); return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;};
    let acc=-Math.PI/2;
    const arcs = rows.map(v=>{
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(cx,cy,r,acc,acc+span); acc+=span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;
    }).join('');
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
        <th class="right">% of total</th>
        <th class="right">Amount (45d)</th>
      </tr>
    `;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}% • ${fmtMoney(v.amount)}</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="4" style="padding:18px">
          <div class="vendor-flex">${svg}<div class="legend">${legend}</div></div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
        <td class="right">${fmtMoney(v.amount)}</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(totalAmount)}</strong></td>
      </tr>
    `;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];
    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }
    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate,0)}%</td>
          <td class="right">${fmtMoney(safe(a.annual_av,0))}</td>
        </tr>`).join('')}
      <tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td>
      <td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>
    `;
  }

  // --------- Rules rotation (every 12h) — no ticker
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    if (!list.length) {
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
      return;
    }
    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 12*60*60*1000);
  }

  // ---------- Backfill Parser (uses your pasted block; no other files)
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
Natalie Slaughter
JUMBO Splits - $120
Sebastian Beltran  10-15-2025 6:35 pm
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
Matthew Hermsen
CG Exclusive - $106
ACA/Suppy: 106
Eli Thermilus  10-13-2025 7:18 pm
Courtney Rosencrance
Exclusive 30s - $600.51
Robert Adams  10-13-2025 6:44 pm
Rosanna Kohrs
Referral - $830
Supplemental/Association/Other: 2112
PA/PC : 831
Philip Baxter  10-13-2025 5:38 pm
Autumn Roche
Red Media - $94
ACA/Suppy/wrap: 94
Eli Thermilus  10-13-2025 5:01 pm
Monette Jj
Red Media - $62
Stand Alone Supplemental/Association/Other: 62
A S  10-13-2025 4:12 pm
Guadalupe Martin Hernandez
Red Media - $48
Robert Adams  10-13-2025 4:05 pm
Lester Bynog
Red Media - $189
Stand Alone Supplemental/Association/Other: 159
Philip Baxter  10-13-2025 11:51 am
Madison Conquest
Red Media - $84
Anna Gleason  10-12-2025 4:20 pm
Michael Mazzoleni
Red Media - $268
Anna Gleason  10-10-2025 1:51 pm
Monica Jones
Referral - $7
ACA/Suppy: 7
Eli Thermilus  10-09-2025 6:23 pm
Patti Hodges Shaw
Referral - $158
PA/PC : 158
Red Media - $1
Philip Baxter  10-09-2025 6:13 pm
Chinenye Oguejiofor
Red Media - $130
ACA/Suppy/wrap: 130
F N  10-09-2025 1:50 pm
Zoey Sheeder
Referral - $53
ACA/Suppy: 53
A S  10-09-2025 11:58 am
Wranslee Wichum
Referral - $158
PA/PC : 158
Philip Baxter  10-09-2025 10:26 am
Margaretta Yancey
Red Media - $120
ACA/Suppy/wrap: 120
Eli Thermilus  10-08-2025 7:05 pm
Abigail Robeson
Red Media - $52
ACA: 52
Philip Baxter  10-08-2025 6:07 pm
Stephanie Reina
Referral - $94
Dental/Vision : 94
Philip Baxter  10-08-2025 1:20 pm
Charles Holt
Red Media - $92
Sebastian Beltran  10-08-2025 10:52 am
Amanda Switek
Red Media - $51
UHC: 0
UHC/Suppy/wrap: 51
Philip Baxter  10-08-2025 8:59 am
Sander Hosteenez
Red Media - $111
ACA/Suppy/wrap: 111
F N  10-07-2025 3:57 pm
Laura Rojas Rodriguez
Red Media - $259
Philip Baxter  10-07-2025 10:46 am
Abigail Londrigan
Red Media - $132
ACA/Suppy/wrap: 132
F N  10-06-2025 9:13 pm
Makayla King
$7.50 - $16
Sebastian Beltran  10-06-2025 8:43 pm
Skylar Broz
Exclusive JUMBO - $192
PA/PC : 192
Eli Thermilus  10-06-2025 7:54 pm
Orlando Castillo
Red Media - $253
Robert Adams  10-06-2025 6:42 pm
Jamise Bradley
Referral - $40
ACA/Suppy: 40
Eli Thermilus  10-06-2025 5:57 pm
Mitchel Alburo
Red Media - $318
Robert Adams  10-06-2025 5:52 pm
Nicole Emerson
HotLine Bling - $187
ACA/Suppy: 187
F N  10-06-2025 5:01 pm
Emily Beets
Referral - $55
ACA: 55
Philip Baxter  10-06-2025 4:36 pm
Camilla Pulka
Red Media - $20
Anna Gleason  10-06-2025 2:51 pm
Lola Hampton
Red Media - $110
ACA/Suppy/wrap: 110
A S  10-06-2025 1:55 pm
Avery Russell
Red Media - $85
ACA/Suppy/wrap: 85
Eli Thermilus  10-06-2025 1:34 pm
Joshua Brodsky
ABC - $251
PA/PC : 251
Marie Saint Cyr  10-06-2025 12:47 pm
Kerri Johnson
Lamy Dynasty Specials - $252
Philip Baxter  10-06-2025 11:29 am
Hollyann Walden
Red Media - $1
Robert Adams  10-06-2025 11:14 am
Clarissa Velez
Red Media - $84
Dental/Vision : 84.00
Robert Adams  10-05-2025 4:32 pm
Deoveon Gallman
Red Media - $209
Anna Gleason  10-05-2025 3:27 pm
Maria Cantu
Red Media - $1
ACA: 1
F N  10-05-2025 2:03 pm
Isaiah Anaya
CG Exclusive - $35
F N  10-05-2025 1:22 pm
Bo Bailey
Red Media - $632
PA/PC : 632
Marie Saint Cyr  10-05-2025 12:36 pm
Amanthia Jeffs
Red Media - $73
ACA/Suppy/wrap: 73
A S  10-03-2025 5:04 pm
Deneen Portenier
Red Media - $78
Robert Adams  10-02-2025 6:02 pm
Isabella Madrid
Red Media - $475
ACA/Suppy/wrap: 475/115
Marie Saint Cyr  10-02-2025 8:56 am
Kailey Secrest
Red Media - $52
Anna Gleason  10-01-2025 8:02 pm
Caleb Gardner
Red Media - $60
Anna Gleason  10-01-2025 8:01 pm
Lina Waterstradt
Red Media - $247
PA/PC : 247
Eli Thermilus  10-01-2025 7:54 pm
Wendy Bradley
Red Media - $154
ACA/Suppy/wrap: 154
Eli Thermilus  10-01-2025 6:16 pm
Karthik Surapaneni
Referral - $230
PA/PC : 230
Eli Thermilus  10-01-2025 6:14 pm
Hope McIntosh
Red Media - $56
Robert Adams  10-01-2025 5:47 pm
Theresa Croker
RKA Website - $1,445
Robert Adams  10-01-2025 1:23 pm
Ryan Manning
Red Media - $389
PA/PC : 389
Marie Saint Cyr  10-01-2025 12:05 pm
Brianna Barnes
Red Media - $359
PA/PC : 359
Eli Thermilus  10-01-2025 11:32 am
Tara Roth
Red Media - $193
Sebastian Beltran  10-01-2025 9:49 am
Priscilla Villasenor
Red Media - $89
ACA/Suppy/wrap: 89
A S  09-30-2025 7:31 pm
Elizabeth Grant
Red Media - $221
PA/PC : 221
Eli Thermilus  09-30-2025 6:15 pm
Gregory Rudisill
Blast/Bulk - $142.21
UHC/Suppy: 142.21
UHC: 142.21
Robert Adams  09-30-2025 4:10 pm
Joseph Brooks
Red Media - $598
Anna Gleason  09-30-2025 9:17 am
Christian Ponce
CG Exclusive - $209
PA/PC : 209
Eli Thermilus  09-29-2025 8:33 pm
Garrett Caldwell
Lamy Dynasty Specials - $406
PA/PC: 406
Marie Saint Cyr  09-29-2025 5:38 pm
Samuel Cody Lammons Lammons
Red Media - $213
Robert Adams  09-29-2025 3:57 pm
Kristin Kingston
Red Media - $52
Robert Adams  09-29-2025 3:53 pm
Sharon Lawrence
Red Media - $582
PA/PC : 582
Eli Thermilus  09-29-2025 3:28 pm
Valarie Lincoln
Red Media - $568
Anna Gleason  09-29-2025 11:51 am
Kyle Brady
Red Media - $64
Anna Gleason  09-29-2025 10:10 am
Daniel Ingman
Red Media - $73
Robert Adams  09-29-2025 9:33 am
Zanivia Dixon
Red Media - $180
Anna Gleason  09-28-2025 4:15 pm
Guillermo Trejo
Red Media - $64
Sebastian Beltran  09-28-2025 2:11 pm
David Cwynar
Red Media - $854
PA/PC : 854
F N  09-27-2025 10:40 am
Antwon Smith
ABC - $1
UHC/Suppy: 1
F N  09-26-2025 11:36 am
Diana Henning
ABC - $75
Dental/Vision : 75
F N  09-26-2025 10:06 am
Meggen Lang
Red Media - $648
PA/PC : 648
Marie Saint Cyr  09-26-2025 9:22 am
Aaron Harris
Red Media - $651
Health Access/Secure Access: 651
Nathan Johnson  09-25-2025 8:34 pm
Alison Warren
Red Media - $431
Secure Advantage : 431
Eli Thermilus  09-25-2025 8:31 pm
Bradley Battle
$7.50 - $320
Sebastian Beltran  09-25-2025 6:03 pm
Lohana Lacenapadron
CG Exclusive - $1
ACA: 1
Marie Saint Cyr  09-25-2025 9:14 am
Neil Valmores
Referral - $330
ACA/Suppy: 330
F N  09-24-2025 7:23 pm
Jordanne Torres
Red Media - $316
Robert Adams  09-24-2025 7:19 pm
Tanja Hinote
Red Media - $437
Sebastian Beltran  09-24-2025 7:10 pm
Tericia Thomas
Red Media - $59
Anna Gleason  09-24-2025 6:37 pm
Kirra McMenomy
Red Media - $50
ACA/Suppy/wrap: 50
Eli Thermilus  09-24-2025 5:53 pm
Alexa Peoples
Red Media - $566
PA/PC : 566
Eli Thermilus  09-24-2025 5:50 pm
Ashley Chapman
Red Media - $284
Marie Saint Cyr  09-24-2025 5:40 pm
Pamela Layne
Lamy Dynasty Specials - $38
Dental/Vision: 38
Eli Thermilus  09-24-2025 5:29 pm
Rico Williams
Red Media - $348
Red Media - $348
Sebastian Beltran  09-24-2025 4:54 pm
Serenity Johnson
RKA Website - $336
Health Access/Secure Access: 336
F N  09-24-2025 10:43 am
Jill Chenevert
ABC - $548
PA/PC : 548
F N  09-24-2025 10:42 am
Mia Knight
Red Media - $52
Anna Gleason  09-24-2025 10:01 am
Madison Ford
Red Media - $361
PA/PC : 361
Nathan Johnson  09-23-2025 8:18 pm
Scott Wozniczka
Red Media - $138
PA/PC : 138
Eli Thermilus  09-23-2025 8:11 pm
Cheyanne Dillard Colbert
Red Media - $68
Anna Gleason  09-23-2025 7:53 pm
Hannah Skendziel
Red Media - $552
PA/PC : 552
Nathan Johnson  09-23-2025 6:00 pm
Mik Asay
Red Media - $386
PA/PC : 386
A S  09-23-2025 10:32 am
Tiara Gilead
Red Media - $292
PA/PC : 292
Nathan Johnson  09-22-2025 9:57 pm
Tonya Weston
ABC - $138
UHC/Suppy: 140
F N  09-22-2025 7:37 pm
Abraham Mendez
Red Media - $986
PA/PC : 986
Marie Saint Cyr  09-22-2025 1:23 pm
Kathryn Ross
ABC - $1,094
Secure Advantage : 1094
A S  09-22-2025 11:47 am
Fredrick Ward
Lamy Dynasty Specials - $446
Health Access/Secure Access: 448
Philip Baxter  09-22-2025 11:42 am
Melisande Perrott
Red Media - $79
ACA: 19
ACA/Suppy/wrap: 79
Nathan Johnson  09-21-2025 12:00 pm
Yosef Attiayh
VS Default - $198
Robert Adams  09-20-2025 10:19 am
Laura Risola
Lamy Dynasty Specials - $565
Robert Adams  09-19-2025 7:44 pm
Tara Filius
Red Media - $806
Robert Adams  09-19-2025 7:00 pm
Packer Gorner
Red Media - $141
Philip Baxter  09-19-2025 5:53 pm
Olivia Gorman
Red Media - $253
Philip Baxter  09-19-2025 3:20 pm
Tyler Kok
Red Media - $856
PA/PC : 856
Nathan Johnson  09-19-2025 12:08 pm
Rex Bowden
CG Exclusive - $834.69
Robert Adams  09-18-2025 9:02 pm
Ethan Hazelwood
Red Media - $1
Anna Gleason  09-18-2025 5:20 pm
Jessica Harrell
Red Media - $45.67
UHC/Suppy/wrap: $45.67
Robert Adams  09-18-2025 1:55 pm
Angel Givens
Red Media - $300
Philip Baxter  09-18-2025 1:38 am
Ricardo Glynn
VS Default - $505
Sebastian Beltran  09-17-2025 8:01 pm
Carly Gulsby
Lamy Dynasty Specials - $618
ACA/Suppy: 618
Eli Thermilus  09-17-2025 6:15 pm
Terah Graham
Red Media - $303
Philip Baxter  09-17-2025 3:57 pm
Kathy Haye
Red Media - $301
Philip Baxter  09-17-2025 3:07 pm
William Nelson
Red Media - $348
PA/PC : 348
Marie Saint Cyr  09-16-2025 8:35 pm
Jesus Romero
Red Media - $1
ACA: 0
Marie Saint Cyr  09-16-2025 8:28 pm
Pravaliika Vella
Red Media - $1
ACA: 1
Eli Thermilus  09-16-2025 6:16 pm
Ariana Stevens
Red Media - $55
Dental/Vision : 55
Robert Adams  09-16-2025 5:49 pm
Zachary Redinger
Red Media - $223
Secure Advantage : 223
A S  09-16-2025 4:30 pm
Karen House
RKA Website - $599
Robert Adams  09-16-2025 10:06 am
Hyungwoo Noh
Red Media - $190
ACA/Suppy/wrap: 190
Eli Thermilus  09-16-2025 10:05 am
Beatrice Mboga
Red Media - $1
ACA/Suppy/wrap: 150
Sebastian Beltran  09-15-2025 8:18 pm
Jawun Savage
VS Default - $149
Robert Adams  09-15-2025 8:14 pm
Michael Odenwald
ABC - $884
PA/PC : 884
Marie Saint Cyr  09-15-2025 6:45 pm
Edna Meffert
Red Media - $97
ACA/Suppy/wrap: 97
Robert Adams  09-15-2025 1:11 pm
Traci Wulf
Redrip/Give up Purchased - $70
ACA/Suppy: 72
F N  09-15-2025 10:57 am
Una Coleman
Red Media - $45
ACA/Suppy/wrap: 45
Eli Thermilus  09-15-2025 9:50 am
Mandie Smaus
CG Exclusive - $351
Health Access/Secure Access: 351
F N  09-13-2025 12:25 pm
`;

  function parseBackfill(text) {
    const out = [];
    const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // vendor line: "<Vendor> - $<amount>"
    const vendorRe = /^([A-Za-z0-9 $!\/&:+.'-]+?)\s*-\s*\$([\d,]+(?:\.\d+)?)$/;
    // agent/date line: "<Name>  MM-DD-YYYY hh:mm am/pm"
    const agentRe  = /^([A-Za-z .'-]+?)\s+(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))$/i;

    let pending = null;

    for (const ln of lines) {
      const v = vendorRe.exec(ln);
      if (v) {
        const vendor = v[1].trim();
        if (!VENDOR_SET.has(vendor)) { continue; } // ignore non-vendor product lines
        const amount = +v[2].replace(/,/g,'');
        pending = { soldProductName: vendor, amount, date: '', agent: '' };
        out.push(pending);
        continue;
      }
      const a = agentRe.exec(ln);
      if (a && pending) {
        pending.agent = a[1].trim();
        pending.date  = a[2].trim();
        pending = null;
      }
    }
    // normalize date field name for summarizeVendors
    return out.map(o => ({ ...o, dateSold: o.date }));
  }

  // Parse once
  const BACKFILL_SALES = parseBackfill(BACKFILL_TEXT);

  // ---------- Data load ----------
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // Merge live sales + parsed backfill, then build vendor rows from merged
    const liveAllSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const mergedAllSales = [...liveAllSales, ...BACKFILL_SALES];
    const vendorRows = summarizeVendors(mergedAllSales);

    // Center splash alerts for new live sales within 45d (only liveAllSales, not backfill)
    if (Array.isArray(liveAllSales)) {
      const cutoff = Date.now() - 45*24*3600*1000;
      for (const s of liveAllSales) {
        const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        const t = Date.parse(s.dateSold || s.date || '');
        if (!seenLeadIds.has(id) && isFinite(t) && t >= cutoff) {
          seenLeadIds.add(id);
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold: sold || { team: { totalSales: 0, totalAV12X: 0 }, perAgent: [], allSales: [] },
      vendorRows,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s each)
  function startBoardRotation(data) {
    const order = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
    ];
    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();

// ---------- OE Countdown ----------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  // Set your OE deadline here
  const deadline = new Date('2025-11-01T00:00:00-04:00'); // Nov 1st at midnight ET
  const pad = n => String(n).padStart(2, '0');

  function updateCountdown() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) {
      timerEl.textContent = 'LIVE';
      return;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    timerEl.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(() => setTimeout(updateCountdown, 250));
  }

  updateCountdown();
})();

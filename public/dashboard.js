/* ===========================
   FEW Dashboard — Single File Override
   - No hardcoded headshot list
   - Uses /headshots/roster.json for mapping
   - Works with existing index.html (no placeholders added)
   =========================== */

(() => {
const ENDPOINTS = {
  teamSold: '/api/team_sold',
  callsByAgent: '/api/calls_by_agent',

  // TEMP fallback while vendor API missing env vars
  salesByVendor: '/sales_by_vendor.json',

  // FIX: YTD override files are at root, not /boards/
  ytdAv: '/ytd_av.json',
  rules: '/rules.json',
  roster: '/headshots/roster.json'
};

  // ---- tiny utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${(+n || 0).toLocaleString()}`;

  // replace lines 27–31 with this:
const fetchJSON = async (url) => {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;         // don't blow up the page on a bad endpoint
    return await r.json();
  } catch (e) {
    console.warn('fetchJSON failed:', url, e);
    return null;                    // keep rendering the rest of the dashboard
  }
};

  // ---------- Headshots: build dynamic resolver from roster.json
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byInitials = new Map();
    const byEmail = new Map();
    const byPhone = new Map();

    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const initialsOf = (full) =>
      (full || '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w[0].toUpperCase())
        .join('');

    for (const person of roster || []) {
      const name = norm(person.name);
      const photo = person.photo || null;

      if (name) byName.set(name, photo);
      const init = initialsOf(person.name);
      if (init) byInitials.set(init, photo);

      if (person.email) byEmail.set(norm(person.email), photo);
      if (Array.isArray(person.phones)) {
        for (const p of person.phones) {
          const onlyDigits = (p || '').replace(/\D/g, '');
          if (onlyDigits) byPhone.set(onlyDigits, photo);
        }
      }
    }

    // manual alias glue for known short names → full names from your notes
    const ALIASES = new Map([
      ['f n', 'fabricio navarrete'],
      ['f n.', 'fabricio navarrete'],
      ['a s', 'ajani senior'],
      ['a s.', 'ajani senior']
      // add more if you want, but roster names should cover it
    ]);

    const resolve = ({ name, email, phone }) => {
      // exact name
      let key = norm(name);
      if (byName.has(key)) return byName.get(key);

      // alias name
      if (ALIASES.has(key)) {
        const aliased = ALIASES.get(key);
        if (byName.has(aliased)) return byName.get(aliased);
      }

      // initials from name
      const init = (name || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('');
      if (init && byInitials.has(init)) return byInitials.get(init);

      // email
      if (email && byEmail.has(norm(email))) return byEmail.get(norm(email));

      // phone (digits only)
      if (phone) {
        const digits = String(phone).replace(/\D/g, '');
        if (byPhone.has(digits)) return byPhone.get(digits);
      }

      // no photo found
      return null;
    };

    return resolve;
  }

  // ---------- Render helpers
  function renderBannerAndMetrics({ teamSold }) {
    // Banner text & bonus line are already in your HTML; leave them.
    // Fill the three metric cards if present.
    const totalAV = teamSold?.team?.totalAV12x ?? teamSold?.team?.totalAV ?? 0;
    const deals = Array.isArray(teamSold?.allSales) ? teamSold.allSales.length : (teamSold?.team?.totalSales ?? 0);

    const metricAV = $('#metric-av') || $$('#board .metric-av')[0] || $$('#board [data-metric="av"]')[0];
    const metricDeals = $('#metric-deals') || $$('#board .metric-deals')[0] || $$('#board [data-metric="deals"]')[0];

    if (metricAV) metricAV.textContent = fmtMoney(totalAV);
    if (metricDeals) metricDeals.textContent = deals;
  }

  function ensureOECentered() {
    // Force center if theme CSS misses it
    const el = $('#oe') || $('.oe-countdown') || $$('#board .oe')[0];
    if (!el) return;
    el.style.margin = '0 auto';
    el.style.display = 'block';
  }

  function avatarImg(photo, name) {
    if (photo) {
      return `<img class="avatar" src="/headshots/${photo}" alt="${name}" />`;
    }
    // fallback: initials circle (no external image required)
    const initials = (name || '')
      .split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="avatar avatar--initials">${initials}</div>`;
  }

  function renderRosterTable(container, rows, resolvePhoto) {
    if (!container) return;
    const html = [
      `<table class="table table--roster">
        <thead>
          <tr>
            <th>Agent</th>
            <th class="ta-right">Submitted AV</th>
            <th class="ta-right">Deals</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const photo = resolvePhoto({ name: r.name, email: r.email, phone: r.phone });
            return `
              <tr>
                <td>
                  <div class="agent">
                    ${avatarImg(photo, r.name)}
                    <span class="agent__name">${r.name}</span>
                  </div>
                </td>
                <td class="ta-right">${fmtMoney(r.amount || r.av || r.total || 0)}</td>
                <td class="ta-right">${r.deals ?? r.count ?? r.sales ?? 0}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`
    ].join('');
    container.innerHTML = html;
  }

  function renderAgentOfWeek(container, leader, resolvePhoto) {
    if (!container || !leader) return;
    const photo = resolvePhoto({ name: leader.name, email: leader.email, phone: leader.phone });
    container.innerHTML = `
      <div class="aow">
        ${avatarImg(photo, leader.name)}
        <div class="aow__meta">
          <div class="aow__name">${leader.name}</div>
          <div class="aow__badges">
            <span class="badge">${leader.deals ?? 0} deals (this week)</span>
            <span class="badge badge--gold">${fmtMoney(leader.amount || 0)} submitted AV (this week)</span>
            <span class="badge">${fmtMoney(leader.ytd || 0)} YTD AV</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderVendors(container, list) {
    if (!container) return;
    // sort by deals desc
    const rows = [...(list || [])].sort((a, b) => (b.deals || 0) - (a.deals || 0));
    container.innerHTML = `
      <table class="table table--vendors">
        <thead>
          <tr>
            <th>Vendor</th>
            <th class="ta-right">Deals</th>
            <th class="ta-right">% of total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(v => `
            <tr>
              <td>${v.vendor}</td>
              <td class="ta-right">${v.deals ?? 0}</td>
              <td class="ta-right">${v.percent ?? 0}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function rotateRules(rules) {
    const el = $('#rule-of-the-day') || $('#rule') || $('.rule') || null;
    if (!el || !Array.isArray(rules) || rules.length === 0) return;
    let i = 0;
    const set = () => { el.textContent = rules[i % rules.length]; i++; };
    set();
    // rotate every 30s
    setInterval(set, 30000);
  }

  // ---------- main
  async function main() {
    try {
      const [teamSold, callsByAgent, salesByVendor, ytd, rules, roster] = await Promise.all([
        fetchJSON(ENDPOINTS.teamSold).catch(() => ({})),
        fetchJSON(ENDPOINTS.callsByAgent).catch(() => ({})),
        fetchJSON(ENDPOINTS.salesByVendor).catch(() => ({})),
        fetchJSON(ENDPOINTS.ytdAv).catch(() => ({})),
        fetchJSON(ENDPOINTS.rules).catch(() => []),
        fetchJSON(ENDPOINTS.roster).catch(() => [])
      ]);

      const resolvePhoto = buildHeadshotResolver(roster);

      // metrics + banner (keeps your existing markup)
      renderBannerAndMetrics({ teamSold });
      ensureOECentered();

      // ---------- Roster (This Week)
      const perAgent = Array.isArray(teamSold?.perAgent) ? teamSold.perAgent : [];
      const rosterBox = $('#board') || $('.board') || $('.roster-board');
      renderRosterTable(rosterBox, perAgent.map(a => ({
        name: a.name,
        amount: a.av12x ?? a.amount ?? a.av,
        deals: a.sales ?? a.deals ?? 0
      })), resolvePhoto);

      // ---------- Agent of the Week
      const leader = perAgent
        .map(a => ({
          name: a.name,
          amount: a.av12x ?? a.amount ?? 0,
          deals: a.sales ?? 0,
          // stitch in YTD if present from the ytd.json
          ytd: (ytd?.agents || []).find(p => (p.name || '').toLowerCase() === (a.name || '').toLowerCase())?.av ?? 0
        }))
        .sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];

      const aowBox = $('#aow') || $('.agent-of-week') || null;
      renderAgentOfWeek(aowBox, leader, resolvePhoto);

      // ---------- Vendors (last 45 days)
      const vendorBox = $('#vendors') || $('.vendor-board') || null;
      const vendorRows = Array.isArray(salesByVendor?.vendors) ? salesByVendor.vendors : (salesByVendor || []);
      renderVendors(vendorBox, vendorRows);

      // ---------- Rules rotation
      rotateRules(rules?.rules || rules);

      // minimal CSS fixes for avatars and badges (safe, scoped)
      injectOnce('few-inline-fixes', `
        .avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;display:inline-block;margin-right:10px}
        .avatar--initials{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#1f2a37;color:#e5e7eb;font-weight:700;margin-right:10px}
        .agent{display:flex;align-items:center;gap:10px}
        .table{width:100%;border-collapse:separate;border-spacing:0 8px}
        .table th,.table td{padding:12px 16px}
        .ta-right{text-align:right}
        .aow{display:flex;align-items:center;gap:16px}
        .aow .avatar{width:64px;height:64px}
        .aow__name{font-size:22px;font-weight:700}
        .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#0f172a;color:#cbd5e1;margin-right:8px;font-size:12px}
        .badge--gold{background:#3b2f1a;color:#f6e3a1}
      `);

    } catch (err) {
      console.error('Dash init failed:', err);
    }
  }

  function injectOnce(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();

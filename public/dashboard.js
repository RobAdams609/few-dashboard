/* FEW Dashboard — robust v3 */
const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a) => { if (DEBUG) console.log(...a); };

async function fetchJSON(url) {
  const bust = (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const res = await fetch(url + bust, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

function initials(name='') {
  return name.trim().split(/\s+/).map(s => s[0] || '').join('').slice(0,2).toUpperCase();
}

function setRuleText(rules) {
  try {
    if (!Array.isArray(rules) || rules.length === 0) return;
    const idx = (new Date().getUTCDate()) % rules.length;
    const text = String(rules[idx] || '').trim();
    const ticker = document.getElementById('ticker');
    const sub = document.getElementById('principle');
    if (ticker) ticker.textContent = `RULE OF THE DAY — ${text}`;
    if (sub) sub.textContent = text;
  } catch (e) { log('rule error', e); }
}

function renderRosterSkeleton(agents) {
  const tbody = document.getElementById('rosterBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  agents.forEach(a => {
    const tr = document.createElement('tr');
    const photo = a.photo ? `/headshots/${a.photo}` : '';
    tr.innerHTML = `
      <td class="agent">
        ${photo ? `<img class="avatar" src="${photo}" onerror="this.remove();this.closest('td').insertAdjacentHTML('afterbegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">` : `<div class="avatar-fallback">${initials(a.name)}</div>`}
        <span>${a.name}</span>
      </td>
      <td class="num" data-col="calls">0</td>
      <td class="num" data-col="talk">0</td>
      <td class="num" data-col="sales">$0</td>
      <td class="num" data-col="av">$0</td>
    `;
    tbody.appendChild(tr);
  });
}

async function init() {
  try {
    // Load roster + rules first so the table renders even if APIs are empty
    const [rosterRaw, rules] = await Promise.all([
      fetchJSON('/headshots/roster.json'),
      fetchJSON('/rules.json').catch(() => [])
    ]);

    const agents = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : Array.isArray(rosterRaw) ? rosterRaw : [];
    log('roster size', agents.length);
    renderRosterSkeleton(agents);
    setRuleText(rules);

    // Kick API calls (non-blocking for initial render)
    fetchJSON('/api/calls_diag?days=7&limit=5000')
      .then(calls => log('calls count', calls?.count ?? 0))
      .catch(err => log('calls error', err.message || err));

    fetchJSON('/api/sales_diag?days=30&limit=5000')
      .then(sales => log('sales count', sales?.count ?? 0))
      .catch(err => log('sales error', err.message || err));

  } catch (err) {
    log('init error', err);
    const tbody = document.getElementById('rosterBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="padding:18px;color:#e37b7b;">Failed to load roster.json — put it at /public/headshots/roster.json</td></tr>`;
  }
}

window.addEventListener('DOMContentLoaded', init);

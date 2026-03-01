import { CONFIG } from './config.js';

const $ = (sel) => document.querySelector(sel);
const THEME_KEY = 'pm_theme';

function normalizeTheme(v) {
  return v === 'dark' ? 'dark' : 'light';
}
function currentTheme() {
  return normalizeTheme(document.documentElement.getAttribute('data-theme'));
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function applyTheme(theme) {
  const next = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {}
  const btn = $('#themeToggle');
  if (!btn) return;
  btn.textContent = next === 'dark' ? 'DARK' : 'LIGHT';
  btn.setAttribute('aria-pressed', String(next === 'dark'));
  btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
function initTheme() {
  let saved = 'light';
  try {
    saved = normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch (_) {}
  applyTheme(saved);
}

function fmt(n, d = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(d);
}
function fmtPct(x) {
  const n = Number(x || 0);
  const s = (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  return s;
}
function groupKind(group) {
  if (!group) return 'other';
  if (group.startsWith('macro_')) return 'macro';
  if (group.startsWith('tech_')) return 'tech';
  return 'other';
}
function daysToEnd(endDate) {
  if (!endDate) return null;
  const d = (new Date(endDate).getTime() - Date.now()) / 86400000;
  if (!Number.isFinite(d)) return null;
  return d;
}

const CPI_GROUP = 'macro_cpi_feb2026';
const CPI_OUTCOME_ORDER = ['≤2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '≥2.7'];

function parseCpiOutcomeLabel(question) {
  const q = String(question || '');
  if (q.includes('≤2.1%')) return '≤2.1';
  if (q.includes('≥2.7%')) return '≥2.7';
  const m = q.match(/\b(2\.[2-6])%/);
  return m ? m[1] : null;
}

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function midPrice(market) {
  const bid = toNumOrNull(market.bestBid);
  const ask = toNumOrNull(market.bestAsk);
  if (bid != null && ask != null) return (bid + ask) / 2;
  const last = toNumOrNull(market.lastTradePrice);
  return last;
}

function setKind(kind) {
  const btns = [...document.querySelectorAll('#kindFilter .seg')];
  btns.forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
  window.__KIND = kind;
}
function getKind() {
  return window.__KIND || 'all';
}
function kindOk(m) {
  const k = getKind();
  if (k === 'all') return true;
  return groupKind(m.group) === k;
}

function kpiHtml(label, value, sub = '') {
  return `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
}

function badge(text) {
  return `<span class="badge">${text}</span>`;
}

function rowHtml(m, rightLines = []) {
  const title = m.question || m.slug || m.id;
  const end = (m.endDate || '').slice(0,10);
  return `
  <div class="row">
    <div class="left">
      <div class="qline"><a href="${m.url}" target="_blank" rel="noopener">${title}</a></div>
      <div class="badges">
        ${badge(m.group)}
        ${end ? badge('end:' + end) : ''}
      </div>
    </div>
    <div class="kvs">
      <div class="kv">bid/ask <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code></div>
      <div class="kv">spread <code>${fmt(m.spread,3)}</code></div>
      ${rightLines.map(x => `<div class="kv">${x}</div>`).join('')}
    </div>
  </div>`;
}

function alertTags(m) {
  const t = CONFIG.thresholds;
  const tags = [];
  if ((m.spread ?? 0) >= t.spread) tags.push({ txt: `WIDE SPREAD ≥ ${t.spread}`, cls: 'yellow' });
  if (Math.abs(m.oneHourPriceChange ?? 0) >= t.absMove1h) tags.push({ txt: `FAST MOVE |1h| ≥ ${(t.absMove1h*100).toFixed(2)}%`, cls: 'red' });
  if ((m.volume24hr ?? 0) >= t.vol24h) tags.push({ txt: `LIQUID vol24h ≥ ${t.vol24h}`, cls: 'green' });
  const d = daysToEnd(m.endDate);
  if (d != null && d <= t.daysToEnd) tags.push({ txt: `EVENT SOON ≤ ${t.daysToEnd}d`, cls: 'yellow' });
  return tags;
}

function renderAlerts(markets) {
  const t = CONFIG.thresholds;
  const alerts = markets
    .filter(kindOk)
    .map(m => ({ m, tags: alertTags(m) }))
    .filter(x => x.tags.length)
    .sort((a,b) => (b.m.volume24hr ?? 0) - (a.m.volume24hr ?? 0))
    .slice(0, CONFIG.maxAlerts);

  $('#alertCount').textContent = String(alerts.length);

  if (!alerts.length) {
    $('#alerts').innerHTML = `<div class="alert"><div><div class="q">No alerts under current thresholds.</div><div class="tags"><span class="tag">Try switching Macro/Tech/All</span></div></div></div>`;
    return;
  }

  $('#alerts').innerHTML = alerts.map(({m,tags}) => {
    const title = m.question || m.slug || m.id;
    return `
      <div class="alert">
        <div>
          <div class="q"><a href="${m.url}" target="_blank" rel="noopener">${title}</a></div>
          <div class="tags">
            ${tags.map(t => `<span class="tag ${t.cls}">${t.txt}</span>`).join('')}
            <span class="tag">${m.group}</span>
          </div>
        </div>
        <div class="kvs">
          <div class="kv">bid/ask <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code></div>
          <div class="kv">spread <code>${fmt(m.spread,3)}</code></div>
          <div class="kv">1h <code>${fmtPct(m.oneHourPriceChange)}</code></div>
          <div class="kv">vol24h <code>${fmt(m.volume24hr,0)}</code></div>
        </div>
      </div>`;
  }).join('');
}

function renderPanels(data) {
  const ks = {
    vol: (data.panels?.topVol24 || []).filter(kindOk),
    move: (data.panels?.topMove1h || []).filter(kindOk),
    spread: (data.panels?.widestSpreads || []).filter(kindOk)
  };

  $('#panelVol').innerHTML = ks.vol.map(m => rowHtml(m, [`vol24h <code>${fmt(m.volume24hr,0)}</code>`])).join('') || '';
  $('#panelMove').innerHTML = ks.move.map(m => rowHtml(m, [`1h <code>${fmtPct(m.oneHourPriceChange)}</code>`, `1d <code>${fmtPct(m.oneDayPriceChange)}</code>`])).join('') || '';
  $('#panelSpread').innerHTML = ks.spread.map(m => rowHtml(m, [`vol24h <code>${fmt(m.volume24hr,0)}</code>`])).join('') || '';
}

function renderKpis(markets) {
  const m = markets.filter(kindOk);
  const topVol = [...m].sort((a,b) => (b.volume24hr ?? 0)-(a.volume24hr ?? 0))[0];
  const maxMove = [...m].sort((a,b) => Math.abs(b.oneHourPriceChange ?? 0) - Math.abs(a.oneHourPriceChange ?? 0))[0];
  const maxSpread = [...m].filter(x => x.spread != null).sort((a,b) => (b.spread ?? 0)-(a.spread ?? 0))[0];

  const alertsCount = m.map(x => alertTags(x)).filter(t => t.length).length;

  $('#kpis').innerHTML = [
    kpiHtml('Scanned', `${m.length}`, 'markets in view'),
    kpiHtml('Alerts', `${alertsCount}`, `thresholded signals`),
    kpiHtml('Top vol24h', topVol ? fmt(topVol.volume24hr,0) : '—', topVol ? (topVol.question || topVol.slug || topVol.id) : ''),
    kpiHtml('Max |1h|', maxMove ? fmtPct(maxMove.oneHourPriceChange) : '—', maxMove ? (maxMove.question || maxMove.slug || maxMove.id) : ''),
    kpiHtml('Max spread', maxSpread ? fmt(maxSpread.spread,3) : '—', maxSpread ? (maxSpread.question || maxSpread.slug || maxSpread.id) : ''),
    kpiHtml('Mode', getKind().toUpperCase(), 'macro / tech filter')
  ].join('');
}

function renderCpiConsistency(markets) {
  const card = $('#cpiConsistencyCard');
  if (!card) return;

  const rows = markets
    .filter(m => m.group === CPI_GROUP)
    .map(m => {
      const label = parseCpiOutcomeLabel(m.question);
      return {
        label,
        bestBid: toNumOrNull(m.bestBid),
        bestAsk: toNumOrNull(m.bestAsk),
        mid: midPrice(m),
        vol24h: toNumOrNull(m.volume24hr)
      };
    })
    .filter(r => r.label);

  if (!rows.length) {
    card.hidden = true;
    return;
  }

  const byLabel = new Map();
  for (const label of CPI_OUTCOME_ORDER) byLabel.set(label, null);
  for (const row of rows) byLabel.set(row.label, row);
  const orderedRows = CPI_OUTCOME_ORDER.map(label => byLabel.get(label) || { label, bestBid: null, bestAsk: null, mid: null, vol24h: null });

  const sumMid = orderedRows.reduce((acc, r) => acc + (r.mid ?? 0), 0);
  const sumAsk = orderedRows.reduce((acc, r) => acc + (r.bestAsk ?? 0), 0);
  const sumBid = orderedRows.reduce((acc, r) => acc + (r.bestBid ?? 0), 0);

  const warnMid = Math.abs(1 - sumMid) > 0.02;
  const warnAsk = sumAsk < 0.99;
  const inconsistent = warnMid || warnAsk;

  const badge = $('#cpiStatusBadge');
  badge.classList.remove('ok', 'warning');
  badge.classList.add(inconsistent ? 'warning' : 'ok');
  badge.textContent = inconsistent ? 'WARNING' : 'OK';

  const reasons = [];
  if (warnMid) reasons.push(`sumMid=${fmt(sumMid,3)}`);
  if (warnAsk) reasons.push(`sumAsk=${fmt(sumAsk,3)}`);
  const lead = inconsistent ? reasons.join(' · ') : `sumMid=${fmt(sumMid,3)} · sumAsk=${fmt(sumAsk,3)} · sumBid=${fmt(sumBid,3)}`;
  $('#cpiSummary').textContent = `${lead}`;

  $('#cpiTableBody').innerHTML = orderedRows.map(r => `
    <tr>
      <td>${r.label}</td>
      <td><code>${fmt(r.bestBid,3)}/${fmt(r.bestAsk,3)}</code></td>
      <td><code>${fmt(r.mid,3)}</code></td>
      <td><code>${fmt(r.vol24h,0)}</code></td>
    </tr>
  `).join('');

  card.hidden = false;
}

function renderTable(markets) {
  const search = ($('#search').value || '').toLowerCase().trim();
  const sort = $('#sort').value;

  let rows = markets.filter(kindOk);
  if (search) rows = rows.filter(m => (m.question||'').toLowerCase().includes(search) || (m.group||'').toLowerCase().includes(search));

  if (sort === 'vol24h') rows.sort((a,b) => (b.volume24hr ?? 0)-(a.volume24hr ?? 0));
  if (sort === 'spread') rows.sort((a,b) => (b.spread ?? -1)-(a.spread ?? -1));
  if (sort === 'absMove1h') rows.sort((a,b) => Math.abs(b.oneHourPriceChange ?? 0)-Math.abs(a.oneHourPriceChange ?? 0));
  if (sort === 'endDate') rows.sort((a,b) => String(a.endDate||'').localeCompare(String(b.endDate||'')));

  rows = rows.slice(0, CONFIG.maxTableRows);

  $('#table').innerHTML = rows.map(m => rowHtml(m, [
    `1h <code>${fmtPct(m.oneHourPriceChange)}</code>`,
    `vol24h <code>${fmt(m.volume24hr,0)}</code>`
  ])).join('');
}

function renderRadar(markets) {
  const canvas = $('#radar');
  const ctx = canvas.getContext('2d');
  const tip = $('#radarTip');
  const radarGrid = cssVar('--radar-grid') || 'rgba(27,36,64,.9)';
  const radarLabel = cssVar('--radar-label') || 'rgba(169,179,214,.9)';
  const radarMacro = cssVar('--radar-macro') || 'rgba(78,161,255,.95)';
  const radarTech = cssVar('--radar-tech') || 'rgba(0,194,168,.95)';

  const ms = markets.filter(kindOk).filter(m => (m.spread ?? 0) > 0 && (m.volume24hr ?? 0) >= 0);
  const w = canvas.width, h = canvas.height;
  const pad = 40;

  const spreads = ms.map(m => m.spread ?? 0);
  const vols = ms.map(m => Math.max(1, m.volume24hr ?? 0));

  const minX = 0;
  const maxX = Math.max(0.04, ...spreads);
  const minY = Math.log10(Math.min(...vols));
  const maxY = Math.log10(Math.max(...vols));

  function xScale(x){
    return pad + (x - minX) / (maxX - minX) * (w - pad*2);
  }
  function yScale(v){
    const y = Math.log10(Math.max(1, v));
    const t = (y - minY) / (maxY - minY || 1);
    return (h - pad) - t * (h - pad*2);
  }

  // background
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.strokeStyle = radarGrid;
  ctx.lineWidth = 1;

  // grid
  for (let i=0;i<=4;i++){
    const gx = pad + i*(w-pad*2)/4;
    ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, h-pad); ctx.stroke();
  }
  for (let i=0;i<=4;i++){
    const gy = pad + i*(h-pad*2)/4;
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(w-pad, gy); ctx.stroke();
  }

  // axes labels
  ctx.fillStyle = radarLabel;
  ctx.font = '12px ui-sans-serif, system-ui';
  ctx.fillText('spread →', w-110, h-14);
  ctx.save();
  ctx.translate(12, 140);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('vol24h (log) →', 0, 0);
  ctx.restore();

  // points
  const points = ms.map(m => {
    const x = xScale(m.spread ?? 0);
    const y = yScale(m.volume24hr ?? 0);
    const r = 4 + Math.min(10, Math.abs(m.oneHourPriceChange ?? 0) * 1200);
    const kind = groupKind(m.group);
    const color = kind === 'macro' ? radarMacro : radarTech;
    return { x,y,r,color,m };
  });

  for (const p of points){
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.restore();

  function hit(mx,my){
    for (let i=points.length-1;i>=0;i--){
      const p = points[i];
      const dx = mx-p.x, dy=my-p.y;
      if (dx*dx+dy*dy <= (p.r+3)*(p.r+3)) return p;
    }
    return null;
  }

  function onMove(ev){
    const rect = canvas.getBoundingClientRect();
    const mx = (ev.clientX-rect.left) * (canvas.width/rect.width);
    const my = (ev.clientY-rect.top) * (canvas.height/rect.height);
    const p = hit(mx,my);
    if (!p){ tip.hidden = true; return; }

    const m = p.m;
    tip.hidden = false;
    tip.innerHTML = `
      <div class="tip-title">${m.question || m.slug || m.id}</div>
      <div class="tip-group">${m.group}</div>
      <div>bid/ask <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code> · spread <code>${fmt(m.spread,3)}</code></div>
      <div>1h <code>${fmtPct(m.oneHourPriceChange)}</code> · vol24h <code>${fmt(m.volume24hr,0)}</code></div>
      <div class="tip-link"><a href="${m.url}" target="_blank" rel="noopener">open →</a></div>
    `;

    tip.style.left = `${Math.min(window.innerWidth-380, ev.clientX + 12)}px`;
    tip.style.top = `${Math.max(60, ev.clientY - 10)}px`;
  }

  canvas.onmousemove = onMove;
  canvas.onmouseleave = () => { tip.hidden = true; };
}

async function load() {
  const res = await fetch('./data/latest.json', { cache: 'no-store' });
  const data = await res.json();

  $('#lastUpdated').textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—';

  const markets = (data.markets || []).filter(m => !m.error);

  // render all
  renderKpis(markets);
  renderCpiConsistency(markets);
  renderAlerts(markets);
  renderPanels(data);
  renderRadar(markets);
  renderTable(markets);

  // interactions
  document.querySelectorAll('#kindFilter .seg').forEach(btn => {
    btn.addEventListener('click', () => {
      setKind(btn.dataset.kind);
      renderKpis(markets);
      renderAlerts(markets);
      renderPanels(data);
      renderRadar(markets);
      renderTable(markets);
    });
  });
  $('#themeToggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    renderRadar(markets);
  });
  $('#search').addEventListener('input', () => renderTable(markets));
  $('#sort').addEventListener('change', () => renderTable(markets));
}

setKind('all');
initTheme();
load().catch(err => {
  console.error(err);
  $('#lastUpdated').textContent = 'Failed to load data';
});

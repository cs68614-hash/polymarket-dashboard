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
  btn.setAttribute('aria-label', next === 'dark' ? '切换到浅色主题' : '切换到深色主题');
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

// --- My model (local, manual) ---
const MY_MODEL_KEY = 'pm_my_model_v1';
function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch (_) { return fallback; }
}
function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}
function triMean(a, b, c) {
  return (a + b + c) / 3;
}
// Triangular CDF
function triCdf(x, a, b, c) {
  if (x <= a) return 0;
  if (x >= c) return 1;
  if (x <= b) return ((x - a) * (x - a)) / ((b - a) * (c - a));
  return 1 - ((c - x) * (c - x)) / ((c - a) * (c - b));
}
function triTailProb(x, a, b, c) {
  return 1 - triCdf(x, a, b, c);
}
function pct(x, d = 1) {
  if (x == null) return '—';
  return (x * 100).toFixed(d) + '%';
}
function price(x, d = 3) {
  if (x == null) return '—';
  return Number(x).toFixed(d);
}
function loadMyModelState() {
  const raw = localStorage.getItem(MY_MODEL_KEY);
  return safeJsonParse(raw, { selectedId: '', low: '', base: '', high: '', entry: '' });
}
function saveMyModelState(st) {
  localStorage.setItem(MY_MODEL_KEY, JSON.stringify(st));
}

function renderMyModel(markets) {
  const host = $('#myModel');
  if (!host) return;

  const st = loadMyModelState();
  const options = markets
    .filter(kindOk)
    .slice()
    .sort((a,b) => String(a.group||'').localeCompare(String(b.group||'')) || String(a.question||'').localeCompare(String(b.question||'')))
    .map(m => {
      const title = (m.question || m.slug || m.id);
      const label = `${m.group} · ${title}`;
      return `<option value="${m.id}">${label}</option>`;
    })
    .join('');

  host.innerHTML = `
    <div class="mm-row">
      <label>选择市场
        <select id="mmSelect">
          <option value="">（请选择）</option>
          ${options}
        </select>
      </label>
    </div>

    <div class="mm-row">
      <label>p_low
        <input id="mmLow" inputmode="decimal" placeholder="如 0.10" />
      </label>
      <label>p_base
        <input id="mmBase" inputmode="decimal" placeholder="如 0.30" />
      </label>
      <label>p_high
        <input id="mmHigh" inputmode="decimal" placeholder="如 0.40" />
      </label>
      <label>挂单价（可选）
        <input id="mmEntry" inputmode="decimal" placeholder="如 0.008" />
      </label>
      <div class="mm-actions">
        <button id="mmSave" type="button">保存</button>
        <button id="mmClear" type="button">清空</button>
      </div>
    </div>

    <div class="mm-out" id="mmOut">选择一个市场并填写区间概率（0~1），我会给出：均值、认为市场低估的概率、以及一个保守挂单建议。</div>
  `;

  const sel = $('#mmSelect');
  const lowEl = $('#mmLow');
  const baseEl = $('#mmBase');
  const highEl = $('#mmHigh');
  const entryEl = $('#mmEntry');
  const out = $('#mmOut');

  const byId = new Map(markets.map(m => [String(m.id), m]));

  function getInputs() {
    const id = String(sel.value || '');
    const low = clamp01(lowEl.value);
    const base = clamp01(baseEl.value);
    const high = clamp01(highEl.value);
    const entry = clamp01(entryEl.value);
    return { id, low, base, high, entry };
  }

  function computeAndRender() {
    const { id, low, base, high, entry } = getInputs();
    if (!id) {
      out.textContent = '请选择一个市场。';
      return;
    }
    const m = byId.get(id);
    if (!m) {
      out.textContent = '未找到该市场数据。';
      return;
    }

    const pMkt = toNumOrNull(m.bestAsk) ?? toNumOrNull(m.lastTradePrice) ?? null;

    if (low == null || base == null || high == null) {
      out.innerHTML = `市场价格参考（ASK）: <code>${price(pMkt, 3)}</code>。请填写 p_low/p_base/p_high（0~1）。`;
      return;
    }
    // basic validation
    const a = Math.min(low, base, high);
    const c = Math.max(low, base, high);
    const b = base; // treat base as mode
    if (!(a <= b && b <= c) || a === c) {
      out.textContent = '请保证 p_low ≤ p_base ≤ p_high，且区间有宽度。';
      return;
    }

    const mean = triMean(a, b, c);
    const tail = (pMkt == null) ? null : triTailProb(pMkt, a, b, c);
    const edgeMean = (pMkt == null) ? null : (mean - pMkt);

    // conservative entry suggestion: min(p_low, 0.6 * p_mkt)
    const suggested = (pMkt == null) ? null : Math.min(a, 0.6 * pMkt);

    const entryTxt = (entry != null)
      ? `你的挂单价：<code>${price(entry, 3)}</code>`
      : `建议挂单价（保守）：<code>${price(suggested, 3)}</code>（= min(p_low, 0.6×p_mkt)）`;

    out.innerHTML = `
      <div>市场：<a href="${m.url}" target="_blank" rel="noopener">${m.question || m.slug || m.id}</a></div>
      <div>市场价格参考（ASK）：<code>${price(pMkt, 3)}</code> · 点差：<code>${fmt(m.spread, 3)}</code> · 24h成交量：<code>${fmt(m.volume24hr, 0)}</code></div>
      <div>你的区间：<code>${pct(a,1)} / ${pct(b,1)} / ${pct(c,1)}</code> · 均值：<code>${pct(mean,1)}</code></div>
      <div>你认为“市场低估”(p > p_mkt) 的概率：<code>${tail == null ? '—' : pct(tail, 0)}</code> · 期望 edge（均值 - p_mkt）：<code>${edgeMean == null ? '—' : pct(edgeMean, 1)}</code></div>
      <div>${entryTxt}</div>
      <div style="margin-top:6px;color:var(--muted2)">提示：这不是自动交易；它只是把直觉标准化，便于做挂单与复盘（Brier）。</div>
    `;
  }

  // restore state
  sel.value = st.selectedId || '';
  lowEl.value = st.low || '';
  baseEl.value = st.base || '';
  highEl.value = st.high || '';
  entryEl.value = st.entry || '';
  computeAndRender();

  sel.addEventListener('change', () => {
    const next = loadMyModelState();
    next.selectedId = sel.value;
    saveMyModelState(next);
    computeAndRender();
  });
  [lowEl, baseEl, highEl, entryEl].forEach(el => el.addEventListener('input', computeAndRender));

  $('#mmSave').addEventListener('click', () => {
    const next = loadMyModelState();
    next.selectedId = sel.value;
    next.low = lowEl.value;
    next.base = baseEl.value;
    next.high = highEl.value;
    next.entry = entryEl.value;
    saveMyModelState(next);
    computeAndRender();
  });
  $('#mmClear').addEventListener('click', () => {
    saveMyModelState({ selectedId: '', low: '', base: '', high: '', entry: '' });
    sel.value = '';
    lowEl.value = '';
    baseEl.value = '';
    highEl.value = '';
    entryEl.value = '';
    computeAndRender();
  });
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
        ${end ? badge('到期:' + end) : ''}
      </div>
    </div>
    <div class="kvs">
      <div class="kv">买/卖 <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code></div>
      <div class="kv">点差 <code>${fmt(m.spread,3)}</code></div>
      ${rightLines.map(x => `<div class="kv">${x}</div>`).join('')}
    </div>
  </div>`;
}

function alertTags(m) {
  const t = CONFIG.thresholds;
  const tags = [];
  if ((m.spread ?? 0) >= t.spread) tags.push({ txt: `点差偏宽 ≥ ${t.spread}`, cls: 'yellow' });
  if (Math.abs(m.oneHourPriceChange ?? 0) >= t.absMove1h) tags.push({ txt: `快速变动 |1h| ≥ ${(t.absMove1h*100).toFixed(2)}%`, cls: 'red' });
  if ((m.volume24hr ?? 0) >= t.vol24h) tags.push({ txt: `流动性高 24h成交量 ≥ ${t.vol24h}`, cls: 'green' });
  const d = daysToEnd(m.endDate);
  if (d != null && d <= t.daysToEnd) tags.push({ txt: `临近到期 ≤ ${t.daysToEnd}天`, cls: 'yellow' });
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
    $('#alerts').innerHTML = `<div class="alert"><div><div class="q">当前阈值下暂无告警。</div><div class="tags"><span class="tag">可切换 全部/宏观/科技</span></div></div></div>`;
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
          <div class="kv">买/卖 <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code></div>
          <div class="kv">点差 <code>${fmt(m.spread,3)}</code></div>
          <div class="kv">1h <code>${fmtPct(m.oneHourPriceChange)}</code></div>
          <div class="kv">24h成交量 <code>${fmt(m.volume24hr,0)}</code></div>
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

  $('#panelVol').innerHTML = ks.vol.map(m => rowHtml(m, [`24h成交量 <code>${fmt(m.volume24hr,0)}</code>`])).join('') || '';
  $('#panelMove').innerHTML = ks.move.map(m => rowHtml(m, [`1h <code>${fmtPct(m.oneHourPriceChange)}</code>`, `1d <code>${fmtPct(m.oneDayPriceChange)}</code>`])).join('') || '';
  $('#panelSpread').innerHTML = ks.spread.map(m => rowHtml(m, [`24h成交量 <code>${fmt(m.volume24hr,0)}</code>`])).join('') || '';
}

function renderKpis(markets) {
  const m = markets.filter(kindOk);
  const topVol = [...m].sort((a,b) => (b.volume24hr ?? 0)-(a.volume24hr ?? 0))[0];
  const maxMove = [...m].sort((a,b) => Math.abs(b.oneHourPriceChange ?? 0) - Math.abs(a.oneHourPriceChange ?? 0))[0];
  const maxSpread = [...m].filter(x => x.spread != null).sort((a,b) => (b.spread ?? 0)-(a.spread ?? 0))[0];

  const alertsCount = m.map(x => alertTags(x)).filter(t => t.length).length;

  $('#kpis').innerHTML = [
    kpiHtml('扫描数', `${m.length}`, '当前视图市场数'),
    kpiHtml('告警数', `${alertsCount}`, '阈值筛选信号'),
    kpiHtml('24h最大成交量', topVol ? fmt(topVol.volume24hr,0) : '—', topVol ? (topVol.question || topVol.slug || topVol.id) : ''),
    kpiHtml('最大|1h|', maxMove ? fmtPct(maxMove.oneHourPriceChange) : '—', maxMove ? (maxMove.question || maxMove.slug || maxMove.id) : ''),
    kpiHtml('最大点差', maxSpread ? fmt(maxSpread.spread,3) : '—', maxSpread ? (maxSpread.question || maxSpread.slug || maxSpread.id) : ''),
    kpiHtml('模式', getKind() === 'all' ? '全部' : (getKind() === 'macro' ? '宏观' : '科技'), '宏观 / 科技过滤')
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
  const buyAllCostAsk = sumAsk;
  const theoreticalEdge = 1 - sumAsk;

  const warnMid = Math.abs(1 - sumMid) > 0.02;
  const warnAsk = sumAsk < 0.99;
  const inconsistent = warnMid || warnAsk;

  const statusBadge = $('#cpiStatusBadge');
  statusBadge.classList.remove('ok', 'warning');
  statusBadge.classList.add(inconsistent ? 'warning' : 'ok');
  statusBadge.textContent = inconsistent ? '告警' : '正常';

  const metrics = `sumMid=${fmt(sumMid,3)} · sumBid=${fmt(sumBid,3)} · sumAsk=${fmt(sumAsk,3)} · buyAllCostAsk=${fmt(buyAllCostAsk,3)} · theoreticalEdge=${fmt(theoreticalEdge,3)}`;
  let summary = '';
  if (warnAsk) {
    summary = `可能存在买全套利：按ASK买全成本=${fmt(buyAllCostAsk,3)}，理论毛利=${fmt(theoreticalEdge,3)}（未计手续费/滑点/成交不完整） · ${metrics}`;
  } else if (warnMid) {
    summary = `分布不一致：sumMid=${fmt(sumMid,3)}（可能流动性不足/盘口失真） · ${metrics}`;
  } else {
    summary = `分布正常：${metrics}`;
  }
  $('#cpiSummary').textContent = summary;

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
    `24h成交量 <code>${fmt(m.volume24hr,0)}</code>`
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
  ctx.fillText('点差 →', w-90, h-14);
  ctx.save();
  ctx.translate(12, 170);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('24h成交量(log) →', 0, 0);
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
      <div>买/卖 <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code> · 点差 <code>${fmt(m.spread,3)}</code></div>
      <div>1h <code>${fmtPct(m.oneHourPriceChange)}</code> · 24h成交量 <code>${fmt(m.volume24hr,0)}</code></div>
      <div class="tip-link"><a href="${m.url}" target="_blank" rel="noopener">打开 →</a></div>
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
  renderMyModel(markets);
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
  $('#lastUpdated').textContent = '加载数据失败';
});

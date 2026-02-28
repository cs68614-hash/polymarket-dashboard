const $ = (sel) => document.querySelector(sel);

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

function getSelectedKinds() {
  const checks = [...document.querySelectorAll('input.group')];
  return new Set(checks.filter(c => c.checked).map(c => c.value));
}

function rowHtml(m, extraRight = []) {
  const title = m.question || m.slug || m.id;
  const badges = [
    { k: m.group, v: 'group' },
    { k: `end:${(m.endDate || '').slice(0,10)}`, v: 'end' },
  ];

  const right = [
    `bid/ask <code>${fmt(m.bestBid,3)}/${fmt(m.bestAsk,3)}</code>`,
    `spread <code>${fmt(m.spread,3)}</code>`,
    ...extraRight,
  ];

  return `
  <div class="row">
    <div class="left">
      <div class="q"><a href="${m.url}" target="_blank" rel="noopener">${title}</a></div>
      <div class="badges">
        ${badges.map(b => `<span class="badge">${b.k}</span>`).join('')}
      </div>
    </div>
    <div class="right">
      ${right.map(x => `<div class="kv">${x}</div>`).join('')}
    </div>
  </div>`;
}

function renderPanel(el, items, kindSet, mode) {
  const filtered = items.filter(m => kindSet.has(groupKind(m.group)));
  const html = filtered.map(m => {
    if (mode === 'vol') return rowHtml(m, [`vol24h <code>${fmt(m.volume24hr,0)}</code>`]);
    if (mode === 'move') return rowHtml(m, [`1h <code>${fmtPct(m.oneHourPriceChange)}</code>`, `1d <code>${fmtPct(m.oneDayPriceChange)}</code>`]);
    if (mode === 'spread') return rowHtml(m, [`vol24h <code>${fmt(m.volume24hr,0)}</code>`]);
    return rowHtml(m);
  }).join('');
  el.innerHTML = html || '<div class="row"><div class="left"><div class="q">No items match the filter.</div></div></div>';
}

async function load() {
  const res = await fetch('./data/latest.json', { cache: 'no-store' });
  const data = await res.json();
  $('#lastUpdated').textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—';

  const kindSet = getSelectedKinds();
  renderPanel($('#panelVol'), data.panels?.topVol24 || [], kindSet, 'vol');
  renderPanel($('#panelMove'), data.panels?.topMove1h || [], kindSet, 'move');
  renderPanel($('#panelSpread'), data.panels?.widestSpreads || [], kindSet, 'spread');

  document.querySelectorAll('input.group').forEach(el => {
    el.addEventListener('change', () => {
      const ks = getSelectedKinds();
      renderPanel($('#panelVol'), data.panels?.topVol24 || [], ks, 'vol');
      renderPanel($('#panelMove'), data.panels?.topMove1h || [], ks, 'move');
      renderPanel($('#panelSpread'), data.panels?.widestSpreads || [], ks, 'spread');
    });
  });
}

load().catch(err => {
  console.error(err);
  $('#lastUpdated').textContent = 'Failed to load data';
});

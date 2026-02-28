#!/usr/bin/env node
/**
 * Read-only Polymarket scan for GitHub Pages dashboard.
 *
 * - Reads ./watchlist.json
 * - Fetches market JSON from Polymarket Gamma API:
 *     https://gamma-api.polymarket.com/markets/<id>
 * - Writes: docs/data/latest.json
 * - Appends: docs/data/history.jsonl (one JSON object per run)
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const OUT_DIR = path.join(ROOT, 'docs', 'data');
const LATEST_PATH = path.join(OUT_DIR, 'latest.json');
const HISTORY_PATH = path.join(OUT_DIR, 'history.jsonl');

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

function toNum(x, d = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function utcNowIso() {
  return new Date().toISOString();
}

async function getMarket(id) {
  const url = `${GAMMA_BASE}/markets/${id}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function summarizeMarket(m, group) {
  const bid = toNum(m.bestBid);
  const ask = toNum(m.bestAsk);
  const spread = toNum(m.spread, bid != null && ask != null ? (ask - bid) : null);

  return {
    id: String(m.id),
    group,
    slug: m.slug || null,
    question: m.question || null,
    endDate: m.endDate || null,
    active: !!m.active,
    closed: !!m.closed,
    acceptingOrders: m.acceptingOrders ?? null,
    restricted: !!m.restricted,

    bestBid: bid,
    bestAsk: ask,
    spread,

    lastTradePrice: toNum(m.lastTradePrice),
    oneHourPriceChange: toNum(m.oneHourPriceChange, 0),
    oneDayPriceChange: toNum(m.oneDayPriceChange, 0),

    volume24hr: toNum(m.volume24hr, 0),
    volume1wk: toNum(m.volume1wk, 0),
    volume1mo: toNum(m.volume1mo, 0),
    liquidityNum: toNum(m.liquidityNum, toNum(m.liquidity, 0)),

    url: `https://polymarket.com/market/${m.slug || m.id}`
  };
}

function rankPanels(markets) {
  const ok = markets.filter(m => !m.error);

  const topVol24 = [...ok]
    .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))
    .slice(0, 10);

  const topMove1h = [...ok]
    .sort((a, b) => Math.abs(b.oneHourPriceChange ?? 0) - Math.abs(a.oneHourPriceChange ?? 0))
    .slice(0, 10);

  const widestSpreads = [...ok]
    .filter(m => m.spread != null)
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))
    .slice(0, 10);

  return { topVol24, topMove1h, widestSpreads };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const watch = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  const groups = watch.groups || {};

  const markets = [];
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) {
      try {
        const m = await getMarket(id);
        markets.push(summarizeMarket(m, group));
      } catch (e) {
        markets.push({ id: String(id), group, error: String(e) });
      }
    }
  }

  const panels = rankPanels(markets);

  const payload = {
    schema: 'polymarket.dashboard.latest.v1',
    generatedAt: utcNowIso(),
    watchlistGeneratedAt: watch.generatedAt || null,
    markets,
    panels
  };

  ensureDir(OUT_DIR);
  fs.writeFileSync(LATEST_PATH, JSON.stringify(payload, null, 2) + '\n');
  fs.appendFileSync(HISTORY_PATH, JSON.stringify({ at: payload.generatedAt, panels: payload.panels }) + '\n');

  const errCount = markets.filter(m => m.error).length;
  console.log(`Wrote ${path.relative(ROOT, LATEST_PATH)} with ${markets.length} markets (${errCount} errors)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

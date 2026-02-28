# Polymarket Dashboard (Macro + Tech)

Static GitHub Pages dashboard that displays a read-only Polymarket scan.

## What it does

- A GitHub Action runs **3x daily** (09:30 / 15:30 / 21:30 Asia/Shanghai).
- The action runs a Node script that calls the local `polymarket` CLI (read-only) and writes:
  - `docs/data/latest.json`
  - `docs/data/history.jsonl` (append-only)
- GitHub Pages serves `docs/` as the website.

## Local run

Prereqs:
- Node 20+

```bash
node scripts/scan.mjs
```

(Uses the public Polymarket Gamma API; no CLI, no wallet, no secrets.)

Then open:
- `docs/index.html`

## Enable GitHub Pages

In the GitHub repo settings:
- Settings → Pages
- Source: **Deploy from a branch**
- Branch: `main` (or `master`) / Folder: `docs`

## Notes

- This project uses **read-only** Polymarket endpoints (`markets get`).
- No private keys or wallet configuration is required.

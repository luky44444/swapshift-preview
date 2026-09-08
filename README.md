# SWAPSHIFT preview

A public demo of **SWAPSHIFT** — a shift-swap app for cafés, shops, and similar teams. Staff offer a shift, a teammate claims it, and shop rules decide whether it goes through or waits for the owner.

This repository is a representative snapshot for review. It is not the development repo.

## What you can try

You land as **Luka Majitel**, owner of **Café Luka** / **Kavárna Luka**. The demo already includes a week of shifts, an open offer, a pending swap, and a join request. You also belong to a second shop, **Shop Luka** / **Obchod Luka**.

Switch CS / EN in the sidebar. Shop names, job roles, and the original demo notes follow the interface language. If you rename a shop, role, or type, that custom name stays as you typed it — only the original preset is translated.

From there you can:

- move around the week / month calendar
- offer, claim, approve, or reject swaps
- edit the team, roles, and shop settings
- look at hours / stats

## How this preview works

- **No login.** Opening the site signs you in as the demo owner automatically.
- **Same starting point for everyone.** Each visit gets a fresh in-memory copy of the demo café.
- **Refresh of the site will reset everything to the original preset.** Changes from that visit are discarded.
- Visitors do not share data. Someone else opening the preview still sees the original demo.

## Run it locally

Needs **Node 22+** (`node:sqlite`).

```bash
npm start
```

Then open http://127.0.0.1:3000

## Deploy (Railway)

This preview is meant to be hosted on Railway. After it's live, the public URL will go here.

Node 22, `npm start`, no database volume — the demo must stay in memory so refresh can reset.

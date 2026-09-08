# SWAPSHIFT preview

A live demo of **SWAPSHIFT** — a small shift-swap app for cafés, shops, and similar teams. People offer a shift, someone claims it, and shop rules decide whether it goes through or waits for the owner.

This is **not the real product repo**. It is a public snapshot so you can click around without signing up.

## Not done — I'm building this for fun

The app is early. Layout, copy, and rules will change. There are rough edges. I'm making it because I want a simple way for a team to trade shifts without a spreadsheet, not because it's finished.

Please treat this site as a playground, not a service.

## What you can try

You land as **Luka Majitel**, owner of **Kavárna Luka** (a Czech café). There is already a week of shifts, an open offer, a pending swap, and a join request. You also belong to a second shop, **Obchod Luka**, so you can switch shops in the sidebar.

From there you can:

- move around the week / month calendar
- offer, claim, approve, or reject swaps
- edit the team, roles, and shop settings
- look at hours / stats

## How this preview works

- **No login.** Opening the site signs you in as the demo owner automatically.
- **Same starting point for everyone.** Each visit gets a fresh in-memory copy of the demo café. Nothing is written to disk.
- **Refresh resets.** Reload the page and the café goes back to the beginning. Edits from this visit are gone.
- **You don't affect other people.** Your clicks live in your browser session only. Someone else opening the preview still sees the original demo, not your experiments.

A short banner in the app repeats this so nobody thinks their schedule is saved.

## Run it locally

Needs **Node 22+** (`node:sqlite`).

```bash
npm start
```

Then open http://127.0.0.1:3000

## Deploy (Railway)

This preview is meant to be hosted on Railway. After it's live, the public URL will go here.

Node 22, `npm start`, no database volume — the demo must stay in memory so refresh can reset.

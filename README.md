# Afterglow — Analytics & Funnel Console

Static, self-contained dashboard for **feelafterglow.com**. Single file: `index.html`.
No build step, no dependencies, no external requests except Google Fonts.

Live at **https://afterglow-analytics-shopify.vercel.app** — Vercel redeploys on every push to `main`.

## What it shows

| Tab | Contents |
|---|---|
| 01 Where they come from | Per-order attribution, daily sessions, entry source, referring sites, country × shippability |
| 02 Where they land | Landing paths, product page vs homepage entry |
| 03 Where they drop off | Top-to-bottom funnel, exact step rates, mobile vs desktop, servable vs unservable markets |
| 04 What they do on the page | Clarity click and scroll maps, GA4 purchase journey, behaviour signals |
| 05 What to trust | Order ledger, own-testing removal, market config, data-quality caveats |

Two controls in the header drive the page:

- **Dates** — a calendar with presets and custom ranges. Every Shopify-derived figure recalculates: tiles, charts, both funnels, the country table, the servable split, the entry comparison and the prose inside the callouts.
- **Cleaned / As Shopify reports it** — switches between the corrected set and the raw Shopify numbers.

Sections that cannot follow the date picker carry a dashed badge naming their own window.

## Daily refresh

`.github/workflows/refresh.yml` runs `refresh.mjs` every morning at **04:10 UTC**, pulls the last 90 days from Shopify, rewrites the data constants inside `index.html`, and commits only if something changed. Vercel picks the commit up and redeploys.

Cron is UTC and does not shift — after the October clock change this lands at 05:10 local rather than 06:10. Change the cron to `10 5 * * *` if that matters.

### Setup — one secret, done once

1. In Shopify admin: **Settings → Apps and sales channels → Develop apps → Create an app**.
2. Under **Configuration → Admin API integration**, grant `read_reports` (ShopifyQL) and `read_orders`.
3. **Install app**, then copy the **Admin API access token** (`shpat_…`). It is shown once.
4. In this repo: **Settings → Secrets and variables → Actions → New repository secret**, named `SHOPIFY_ADMIN_TOKEN`.
5. **Actions → Refresh dashboard data → Run workflow** to test it immediately.

Optional repository *variable* `SHOPIFY_API_VERSION` overrides the default `2026-07` if that version stops being served.

The script refuses to write when Shopify returns no days or zero sessions, so a permissions problem fails the run loudly instead of publishing an empty dashboard.

### What the refresh does and does not touch

Refreshed daily: the session day-cube (source × device, raw and cleaned), the country day-cube with its shippability flags, and the two landing-page series.

**Not** refreshed: the order ledger, per-order attribution, and the whole GA4 / Clarity tab. Those are point-in-time reads that need either order classification or a browser session, and they are labelled with their own dates on the page.

## Corrections applied in the "Cleaned" view

1. **Store-owner testing removed** — all sessions from Bratislava, which carried 27 of the store's 62 cart adds in the reference window, plus 13 own test orders.
2. **Matrixify imports separated** — `#W`-prefixed orders were bulk-imported, not storefront sales.
3. **Unservable markets flagged** — the store ships to Czechia, the EU and the US only.

## Privacy

Customer names are replaced with order number, country and value. Order IDs are kept so figures can be reconciled against Shopify.

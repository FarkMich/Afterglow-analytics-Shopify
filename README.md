# Afterglow — Analytics & Funnel Console

Static, self-contained dashboard for **feelafterglow.com**, covering 25 Jul – 24 Aug 2026.

Single file: `index.html`. No build step, no dependencies, no external requests except Google Fonts.

## What it shows

| Tab | Contents |
|---|---|
| 01 Where they come from | Per-order attribution, daily sessions, entry source, referring sites, country × shippability |
| 02 Where they land | Landing paths, product page vs homepage entry |
| 03 Where they drop off | Filterable funnel (source × device), mobile vs desktop, servable vs unservable markets |
| 04 What they do on the page | Clarity click and scroll maps, GA4 purchase journey, behaviour signals |
| 05 What to trust | Order ledger, own-testing removal, market config, data-quality caveats |

The **Cleaned / As Shopify reports it** toggle in the header switches every figure between the raw Shopify numbers and the corrected set.

## Data sources

- **Shopify Analytics** (ShopifyQL) and **Shopify Admin API** — sessions, funnel steps, order ledger, per-order visit trails, markets and delivery zones.
- **GA4** property `490579883` — purchase and checkout journeys, page engagement. Window 27 Jul – 23 Aug (GA4's own last-28-days).
- **Microsoft Clarity** project `xpfllluenp` — heatmaps, scroll depth, smart events, bot exclusion. Window: last 30 days.

Figures are a point-in-time snapshot taken 24 Aug 2026, hard-coded into the page. Nothing refreshes on its own.

## Corrections applied in the "Cleaned" view

1. **Store-owner testing removed** — all sessions from Bratislava (103 sessions carrying 27 of the store's 62 cart adds) and 13 own test orders.
2. **Matrixify imports separated** — orders `#W8337` / `#W8338` were bulk-imported, not storefront sales.
3. **Unservable markets flagged** — the store ships to CZ, the EU and the US only; 743 sessions came from countries with no market.

## Privacy

Customer names have been replaced with order number, country and value. Order IDs are retained because they are needed to reconcile against Shopify.

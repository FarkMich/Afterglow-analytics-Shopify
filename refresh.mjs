#!/usr/bin/env node
/**
 * Refreshes the Shopify data embedded in index.html.
 *
 * Runs in GitHub Actions on a schedule. Talks to the Shopify Admin GraphQL API
 * (ShopifyQL via `shopifyqlQuery`), rebuilds the four day-grain data constants,
 * and rewrites them in place. Everything else in the page is left untouched.
 *
 * Required environment:
 *   SHOPIFY_SHOP          e.g. zr1zpm-bj.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN   Admin API access token from a custom app
 *                         with read_reports and read_orders scopes
 * Optional:
 *   SHOPIFY_API_VERSION   defaults to 2026-07
 *   OWN_CITY              city whose sessions are the store owner's own
 *                         testing and are stripped from the cleaned view
 *                         (defaults to Bratislava)
 */

import { readFile, writeFile } from "node:fs/promises";

const SHOP = requireEnv("SHOPIFY_SHOP");
const TOKEN = requireEnv("SHOPIFY_ADMIN_TOKEN");
const VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const OWN_CITY = process.env.OWN_CITY || "Bratislava";
const WINDOW_DAYS = 90;
const FILE = "index.html";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable ${name}.`);
    console.error("See the README for how to create the Shopify custom app and add the repository secrets.");
    process.exit(1);
  }
  return v;
}

const METRICS =
  "sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout";

const GQL = `query Q($q: String!) {
  shopifyqlQuery(query: $q) {
    __typename
    ... on TableResponse {
      tableData { columns { name } rowData }
    }
    parseErrors { code message }
  }
}`;

async function shopifyql(q) {
  const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query: GQL, variables: { q } }),
  });

  if (!res.ok) {
    throw new Error(
      `Shopify returned HTTP ${res.status} ${res.statusText}. ` +
        (res.status === 401 || res.status === 403
          ? "Check that SHOPIFY_ADMIN_TOKEN is valid and the app has the read_reports scope."
          : res.status === 404
          ? `Check SHOPIFY_SHOP (${SHOP}) and SHOPIFY_API_VERSION (${VERSION}).`
          : "")
    );
  }

  const body = await res.json();
  if (body.errors?.length) {
    throw new Error("GraphQL errors: " + JSON.stringify(body.errors));
  }
  const r = body.data?.shopifyqlQuery;
  if (!r) {
    throw new Error(
      `The API version ${VERSION} did not return a shopifyqlQuery field. Try a different SHOPIFY_API_VERSION.`
    );
  }
  if (r.parseErrors?.length) {
    throw new Error("ShopifyQL rejected the query:\n  " + q + "\n  " + JSON.stringify(r.parseErrors));
  }
  if (!r.tableData) {
    throw new Error("ShopifyQL returned no table for:\n  " + q);
  }
  const cols = r.tableData.columns.map((c) => c.name);
  return r.tableData.rowData.map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const iso = (v) => String(v ?? "").slice(0, 10);

/* ---------------- fetch ---------------- */

const since = `SINCE -${WINDOW_DAYS}d UNTIL today`;
const notOwn = `WHERE session_city != '${OWN_CITY}'`;

console.log(`Fetching ${WINDOW_DAYS} days from ${SHOP} (API ${VERSION})…`);

const [cubeRaw, cubeClean, ctryRaw, ctryClean, pdp, home] = await Promise.all([
  shopifyql(`FROM sessions SHOW ${METRICS} GROUP BY referrer_source, session_device_type TIMESERIES day ${since}`),
  shopifyql(`FROM sessions SHOW ${METRICS} GROUP BY referrer_source, session_device_type TIMESERIES day ${since} ${notOwn}`),
  shopifyql(`FROM sessions SHOW ${METRICS} GROUP BY session_country TIMESERIES day ${since}`),
  shopifyql(`FROM sessions SHOW ${METRICS} GROUP BY session_country TIMESERIES day ${since} ${notOwn}`),
  shopifyql(`FROM sessions SHOW ${METRICS} TIMESERIES day ${since} WHERE landing_page_path = '/products/afterglow-recovery-protocol'`),
  shopifyql(`FROM sessions SHOW ${METRICS} TIMESERIES day ${since} WHERE landing_page_path = '/'`),
]);

/* ---------------- day index ---------------- */

const allDays = [...new Set([...cubeRaw, ...ctryRaw].map((r) => iso(r.day)))].filter(Boolean).sort();
if (!allDays.length) throw new Error("Shopify returned no days at all — refusing to write an empty page.");

// start at the first day that actually carries a session, so the calendar has no dead lead-in
const firstLive = cubeRaw.filter((r) => num(r.sessions) > 0).map((r) => iso(r.day)).sort()[0] || allDays[0];
const days = allDays.filter((d) => d >= firstLive);
const dayIdx = new Map(days.map((d, i) => [d, i]));
const DAY0 = days[0];
const DAYN = days.length;

const SRCK = ["direct", "unknown", "social", "search", "paid", "email"];
const DEVK = ["mobile", "desktop", "tablet", "other"];

/* ---------------- source x device cube ---------------- */

const cube = new Map();
function cubeAdd(rows, offset) {
  for (const r of rows) {
    const d = dayIdx.get(iso(r.day));
    if (d === undefined) continue;
    const si = SRCK.indexOf(r.referrer_source);
    const vi = DEVK.indexOf(r.session_device_type);
    if (si < 0 || vi < 0) continue;
    const key = `${d}|${si}|${vi}`;
    const cell = cube.get(key) || cube.set(key, [d, si, vi, 0, 0, 0, 0, 0, 0, 0, 0]).get(key);
    cell[offset] += num(r.sessions);
    cell[offset + 1] += num(r.sessions_with_cart_additions);
    cell[offset + 2] += num(r.sessions_that_reached_checkout);
    cell[offset + 3] += num(r.sessions_that_completed_checkout);
  }
}
cubeAdd(cubeRaw, 3);
cubeAdd(cubeClean, 7);
const DAYCUBE = [...cube.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

/* ---------------- country cube ---------------- */

// markets the store actually ships to — keep in step with Shopify Markets
const SHIPS = new Set([
  "United States", "Czechia", "Austria", "Belgium", "Bulgaria", "Germany", "Denmark", "Spain",
  "Estonia", "Finland", "France", "Greece", "Croatia", "Hungary", "Ireland", "Italy", "Lithuania",
  "Luxembourg", "Latvia", "Netherlands", "Poland", "Portugal", "Romania", "Sweden", "Slovenia",
  "Slovakia",
]);
const OWN_ROW = `${OWN_CITY}, own testing`;

const rawByCountryDay = new Map();
const cleanByCountryDay = new Map();
const key2 = (d, c) => `${d}|${c}`;
function collect(rows, target) {
  for (const r of rows) {
    const d = dayIdx.get(iso(r.day));
    const c = r.session_country;
    if (d === undefined || !c) continue;
    const k = key2(d, c);
    const v = target.get(k) || target.set(k, [0, 0, 0, 0]).get(k);
    v[0] += num(r.sessions);
    v[1] += num(r.sessions_with_cart_additions);
    v[2] += num(r.sessions_that_reached_checkout);
    v[3] += num(r.sessions_that_completed_checkout);
  }
}
collect(ctryRaw, rawByCountryDay);
collect(ctryClean, cleanByCountryDay);

const totals = new Map();
for (const [k, v] of rawByCountryDay) {
  const c = k.split("|")[1];
  totals.set(c, (totals.get(c) || 0) + v[0]);
}
const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([c]) => c);
const CNAMES = [...top, OWN_ROW, "Other · ships there", "Other · no market"];
const nameIdx = new Map(CNAMES.map((n, i) => [n, i]));
const CSHIPS = CNAMES.map((n) => (n === OWN_ROW || n === "Other · ships there" || SHIPS.has(n) ? 1 : 0));

const cAcc = new Map();
function cAdd(d, name, v, offset) {
  const i = nameIdx.get(name);
  const k = key2(d, i);
  const cell = cAcc.get(k) || cAcc.set(k, [d, i, 0, 0, 0, 0, 0, 0, 0, 0]).get(k);
  for (let j = 0; j < 4; j++) cell[offset + j] += v[j];
}
for (const [k, raw] of rawByCountryDay) {
  const [dStr, c] = k.split("|");
  const d = Number(dStr);
  const clean = cleanByCountryDay.get(k) || [0, 0, 0, 0];
  const own = raw.map((n, j) => n - clean[j]);
  const bucket = top.includes(c) ? c : SHIPS.has(c) ? "Other · ships there" : "Other · no market";
  // the country's own row always excludes the owner's testing; that goes on its own line
  cAdd(d, bucket, clean, 2);
  cAdd(d, bucket, clean, 6);
  if (own.some((n) => n > 0)) cAdd(d, OWN_ROW, own, 2); // raw only — dropped in the cleaned view
}
const CDAY = [...cAcc.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

/* ---------------- landing pages ---------------- */

function landMap(rows) {
  const out = {};
  for (const r of rows) {
    const d = dayIdx.get(iso(r.day));
    if (d === undefined) continue;
    const v = [
      num(r.sessions),
      num(r.sessions_with_cart_additions),
      num(r.sessions_that_reached_checkout),
      num(r.sessions_that_completed_checkout),
    ];
    if (v[0] || v[1] || v[2] || v[3]) out[d] = v;
  }
  return out;
}
const LPDP = landMap(pdp);
const LHOME = landMap(home);

/* ---------------- rewrite the page ---------------- */

const J = (v) => JSON.stringify(v);
const replacements = [
  [/^  var DAY0=.*?,DAYN=\d+;$/m, `  var DAY0=${J(DAY0)},DAYN=${DAYN};`],
  [/^  var SRCK=.*?,DEVK=.*?;$/m, `  var SRCK=${J(SRCK)},DEVK=${J(DEVK)};`],
  [/^  var DAYCUBE=.*?;$/m, `  var DAYCUBE=${J(DAYCUBE)};`],
  [/^  var CNAMES=.*?;$/m, `  var CNAMES=${J(CNAMES)};`],
  [/^  var CSHIPS=.*?;$/m, `  var CSHIPS=${J(CSHIPS)};`],
  [/^  var CDAY=.*?;$/m, `  var CDAY=${J(CDAY)};`],
  [/^  var LPDP=.*?;$/m, `  var LPDP=${J(LPDP)};`],
  [/^  var LHOME=.*?;$/m, `  var LHOME=${J(LHOME)};`],
];

let html = await readFile(FILE, "utf8");
for (const [pattern, value] of replacements) {
  if (!pattern.test(html)) throw new Error(`Could not find ${pattern} in ${FILE} — the page structure changed.`);
  html = html.replace(pattern, value);
}

const stamp = new Date().toISOString().slice(0, 10);
html = html.replace(/Built [0-9]{1,2} [A-Za-z]{3} 2[0-9]{3}/, `Data refreshed ${stamp}`);
html = html.replace(/Data refreshed \d{4}-\d{2}-\d{2}/, `Data refreshed ${stamp}`);

await writeFile(FILE, html);

const totalSessions = DAYCUBE.reduce((a, r) => a + r[3], 0);
const cleanSessions = DAYCUBE.reduce((a, r) => a + r[7], 0);
if (totalSessions === 0) {
  throw new Error(
    "Shopify returned zero sessions across the whole window. That usually means the token " +
      "lacks the read_reports scope, or the queries returned empty tables — refusing to publish an empty dashboard."
  );
}
console.log(
  `Wrote ${FILE}: ${DAYN} days from ${DAY0}, ${DAYCUBE.length} cube rows, ` +
    `${CDAY.length} country rows, ${totalSessions} sessions raw / ${cleanSessions} cleaned.`
);

# Astro + React + Webflow Cloud

Example [Astro](https://astro.build) app with React islands and the Cloudflare adapter, set up for [Webflow Cloud](https://webflow.com/cloud).

[![Deploy to Webflow](https://webflow.com/img/deploy-dark.svg)](https://webflow.com/dashboard/cloud/deploy?repo=https://github.com/Webflow-Examples/hello-world-astro)

## Project structure

```text
.
├── .env.example
├── CLAUDE.md
├── astro.config.mjs
├── package.json
├── package-lock.json
├── public/
│   ├── .assetsignore
│   ├── favicon.svg
│   └── webflow.svg
├── src/
│   ├── env.d.ts
│   ├── layouts/
│   │   └── Layout.astro
│   ├── lib/
│   │   └── counter.ts
│   ├── pages/
│   │   ├── api/
│   │   │   └── hello.ts
│   │   └── index.astro
│   └── styles/
│       └── global.css
├── tsconfig.json
├── webflow.json
├── wrangler.json
└── worker-configuration.d.ts
```

## Commands

| Command | Action |
| :------ | :----- |
| `npm install` | Installs dependencies |
| `npm run dev` | Starts the Astro dev server at `http://localhost:4321` |
| `npm run build` | Builds the production site |
| `npm run preview` | Runs `astro build` then `wrangler dev` for a local preview |
| `npm run deploy` | Deploys with `webflow cloud deploy` |
| `npm run astro` | Runs the Astro CLI (e.g. `astro add`, `astro check`) |
| `npm run cf-typegen` | Generates Wrangler TypeScript types (`wrangler types`) |
| `npm run devlink:export` | Pulls Webflow components into `src/devlink/` as React |

## DevLink

DevLink pulls components out of the Webflow site and writes them into this repo
as React components, which are then mounted as Astro islands.

### One-time setup

1. Generate a Workspace API token: Webflow Dashboard → Apps & Integrations →
   Manage → Workspace API Token.
2. `cp .env.example .env` and set `WEBFLOW_API_TOKEN`. `.env` is gitignored.

### Pulling components

```sh
npm run devlink:export
```

Configuration lives in the `devlink-export` block of `webflow.json`. The target
site is pinned there as `siteId` (`6a73c4d12df78ea4c276a06b`, the "Stone" site),
and output goes to `src/devlink/`.

**The generated output in `src/devlink/` is committed.** Webflow Cloud builds
from the repo and has no API token, so the export must be run locally and the
result checked in. Re-run the export and commit whenever the Webflow components
change.

Note: `webflow devlink sync` is deprecated in CLI 2.x — `export` replaces it.

### Prop naming

Prop names defined on a Webflow component become the React prop names after
export. They must match the canonical `Listing` field names exactly — see the
naming convention in `CLAUDE.md`. Renaming later costs a change in two
codebases.

### `Listing Card` props

The component (group `Listings`) exposes 14 props, each bound to an element:

| Prop | Type | Bound to |
| :--- | :--- | :------- |
| `listingId` | string | card root DOM id (see below) |
| `suburb` | textContent | `.listing-suburb` |
| `displayAddress` | textContent | `.listing-address` |
| `priceDisplay` | textContent | `.listing-price` |
| `bedrooms` | number | 1st `.feature-value` |
| `bathrooms` | number | 2nd `.feature-value` |
| `carspaces` | number | 3rd `.feature-value` |
| `photoCount` | number | `.photo-count` |
| `agentName` | textContent | `.agent-name` |
| `agentPhone` | textContent | `.agent-phone` |
| `contactUrl` | link | `.contact-agent` href |
| `openDate` | textContent | `.open-date` |
| `openTime` | textContent | `.open-time` |
| `hasOpenTimes` | boolean | `.open-times` visibility |

Notes for whoever wires the results grid:

- `displayAddress` must be passed **street-level only** — the suburb renders
  separately, so a full display address would duplicate it. Compose it from
  `unitNumber` / `streetNumber` / `street`.
- `agentName`, `agentPhone`, `openDate`, `openTime` are **not** `Listing`
  fields. Agent details are joined from the `agents` table via `agentIds`;
  open-home times have no field in the canonical type or the schema yet.
- `photoCount` is derived from `images.length`.
- Webflow props are scalars only, so `images[]`, `agentIds[]` and `features[]`
  cannot be props. Anything list-shaped is composed around the card, not in it.
- The listing photo (`.media-placeholder`) and agent headshot (`.agent-avatar`)
  are plain `div`s, not Image elements, so they take no image prop yet. They
  need converting to Image elements in the Designer first.
- `listingId` is bound to the card root's **DOM id**, not a `data-listing-id`
  attribute. Attribute *values* cannot be bound to a prop through the Webflow
  MCP: a static value applies fine, but a bound one is rejected with
  `value must be a string or a binding`, and `get_bindable_sources` reports
  `Setting "attributes" is not applicable to this element`. This holds on Block
  elements and on genuine DOM elements alike, so it is not an element-capability
  limitation that a custom element works around. Setting the binding by hand in
  the Designer UI may still be possible; it has not been tested.

## Listing search

`/listings` is server-rendered with **no client JavaScript at all** — the filter
is a plain GET form. Listing data is present in view-source with JS disabled,
and every filter combination is a distinct, shareable, crawlable URL.

These parameter names are inherited from the current live site and must not
drift, because the URLs are indexed:

```
keywords  property_type  price_min  price_max  bedrooms  bathrooms  carspaces
```

`status`, `state`, `office`, `sort` and `page` are additions, not part of that
inherited contract. `keywords` maps onto the suburb filter.

### Local setup

```sh
npm run fixtures    # regenerate the synthetic dev data (deterministic)
npm run db:migrate  # apply migrations to local D1
npm run db:seed     # upsert fixtures into D1; safe to re-run
npm run build && npx wrangler dev
```

Then visit `/CLOUD_MOUNT_PATH/listings` (the mount path is substituted on
Webflow Cloud).

### Checks

```sh
npm test                                                   # MockSource unit tests
npm run typecheck
node --experimental-strip-types scripts/verify-search.ts   # SQL vs fixture counts
```

`verify-search.ts` computes each filter's count twice — once in SQL against D1,
once in plain JS over the fixture file — and fails if they disagree.

### The fixture data is synthetic

`seed-*.dev.json` is **fabricated**, generated by
`scripts/generate-dev-fixtures.mjs`, and every file carries a `_synthetic`
banner. It is not Stone data and not Agentbox data. It deliberately includes
duplicate listing IDs, a mix of 6- and 7-digit IDs, both `100P######` and
`IRE#######` unique-ID forms, and listings with hidden prices, so the rules in
CLAUDE.md are actually exercised rather than assumed. Replace the files with the
real export and update the filenames in `src/lib/ingestion/seed-data.ts`; no
other code changes.

## Learn more

- [Astro documentation](https://docs.astro.build)
- [Webflow Cloud](https://webflow.com/cloud)

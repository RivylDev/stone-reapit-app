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
| `listingId` | string | card root DOM id |
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

## Learn more

- [Astro documentation](https://docs.astro.build)
- [Webflow Cloud](https://webflow.com/cloud)

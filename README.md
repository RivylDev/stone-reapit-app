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

### Credential status — the export runs, via OAuth

Authenticate with `npx webflow auth login` and the export works. Two of the
three routes in are dead ends; that third one is the live path. It opens a
browser and waits on a localhost callback, so it cannot run in CI.

**Site API tokens — gone.** Webflow has removed per-site API tokens from Site
settings → Apps & integrations. There is no "API access" section and no
"Generate API token" button. The CLI still accepts a `WEBFLOW_SITE_API_TOKEN`
env var, but it is marked deprecated in the CLI's own source and there is no
longer any way to obtain one.

**Workspace API token — generated, but missing the scope.** A Workspace token
*can* be generated (it is a permissions wall, not an Enterprise plan wall: you
need workspace Admin or Owner). But the permission list in the token dialog has
**no DevLink Export row**. A token generated without it authenticates fine and
then fails at the last hop:

```
✖ Components export failed: The access token is missing the required
  "Read DevLink Export data" permission.
```

Note that the "Code components" permission is *not* this. Its description —
"Import React components from an external codebase" — is the `devlink import`
direction, the opposite of export.

**OAuth login — this is the one that works.** `npx webflow auth login`
runs a browser OAuth flow and writes credentials to `.env`. It is worth one
attempt because the CLI's OAuth scope request list contains `devlink_export:read`
directly, so it asks for the export scope through a channel that does not depend
on the token dialog exposing a checkbox for it. It cannot run in CI or headless:
it opens a browser and waits on a localhost callback. If it works, the resulting
token can be copied from `.env` into the `WEBFLOW_API_TOKEN` GitHub secret to
make the Actions workflow work thereafter.

**Meanwhile**, `src/components/ListingCard.tsx` and its CSS are generated from
the same live Webflow data the export reads — the component's element tree,
each class's real properties, and the site's design tokens — pulled through the
Webflow MCP. It is accurate but does not track design changes automatically;
it has to be regenerated on request.

### Running the export, once a credential exists

Either put the token in the `WEBFLOW_API_TOKEN` GitHub secret and run the
**DevLink export** workflow from the Actions tab, or set it in a local `.env`
and run `npm run devlink:export`.

The workflow file lives on `main` as well as this branch, because GitHub only
lists a `workflow_dispatch` workflow in the Actions sidebar when it is present
on the default branch.

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

Browsing is split into five sections, each a real URL rather than a filter state
of one page:

```
/properties        every public listing
/buy               for sale, including under offer
/rent              for rent
/sold              sold
/leased            leased
/property/<slug>   one property
```

**These are relative to the app's mount path.** `base` in `astro.config.mjs` is
`/staging`, so they are really `/staging/buy`, `/staging/rent` and so on;
production mounts at `/app`. Nothing should build these paths by hand — use
`sectionHref()` and `propertyHref()` from `src/lib/queries/sections.ts`, which
take the base.

`property` is singular and sits *beside* the sections, not under one: a listing
moves between sections over its life and its URL must not move with it.

Filters stay as query parameters *within* a section —
`/buy?keywords=Manly&bedrooms=3` — so one result set has exactly one URL.
Switching section keeps the filters and resets the page.

The whole `/listings` subtree is gone and 301s to its replacement, so anything
already linked or indexed still resolves:

```
/listings                  -> /properties
/listings?status=forSale   -> /buy
/listings/all              -> /properties
/listings/buy              -> /buy      (and rent, sold, leased; filters kept)
/listings/<slug>           -> /property/<slug>
```

Under offer sits inside Buy rather than in a section of its own: a property
goes under offer partway through its campaign and can come back, and a separate
URL would move it off the page that earned its ranking at the worst moment.

**`withdrawn` is not reachable from any public URL.** The sections are defined
as status sets in `src/lib/queries/sections.ts`, so there is no "no status
filter" path — `?status=withdrawn` is blanked and then overwritten by the
section's own statuses.

Every page is server-rendered with **no client JavaScript at all** — the filter
is a plain GET form and the section tabs are plain links. Listing data is
present in view-source with JS disabled.

These parameter names are inherited from the current live site and must not
drift, because the URLs are indexed:

```
keywords  property_type  price_min  price_max  bedrooms  bathrooms  carspaces
```

`state`, `office`, `sort` and `page` are additions, not part of that inherited
contract. `keywords` maps onto the suburb filter. `status` is still parsed, but
only by the `/listings` redirect — the path carries it now.

`/property/<listingId>` 301s to the current slug, so correcting an address does
not 404 an indexed URL.


## Office and agent directory

```
/offices           office directory
/offices/<slug>    one office: its team and its properties
/agents            agent directory
/agents/<slug>     one agent: profile, contact, their properties
```

Filled by `npm run db:seed:agentbox`, which calls `/offices` and `/staff` in
addition to the listing feed. The listing payload only names an office, so
without that sync these pages have a name and a count and nothing else.

### Who appears, and who must not

**The directory is not "everyone in the CRM."** The sandbox holds 119 agent
rows, 102 of them `role: Admin` — mostly integration and test accounts, and 47
of those front a live listing. So "has listings" is not a safe proxy for "is a
public agent".

The rule lives in `src/lib/directory-policy.ts` and is applied **in the query**,
not in a template, so an excluded account has no reachable page even if the URL
is guessed:

```
active AND ( role is not Admin OR webDisplay contains "Our Staff" )
```

`webDisplay` is Agentbox's own publication flag, so an office manager whose CRM
role is Admin can still be listed when Stone deliberately ticks the box. In the
sandbox this publishes 12 people out of 119.

### Personal data is dropped at the boundary

`/staff/{id}` returns `dateOfBirth` and `homeAddress`. Neither has any place on
a property website, so `mapStaffRecord` names the fields it wants and everything
else is discarded — there is no column for them to land in, and a field Reapit
adds later is dropped by default rather than silently persisted.

### Two things the API does not give us

- **No agent photographs.** There is no photo field on `/staff` or
  `/staff/{id}`. Headshots have to come from somewhere else.
- **Biographies are HTML.** Every populated `profile` in the sandbox is markup,
  and a couple of listing descriptions are too. `src/lib/rich-text.ts` converts
  both to plain paragraphs, which are rendered as text — this copy is typed by
  agents into a CRM and is never trusted as HTML.

### Local setup

```sh
npm run fixtures    # regenerate the synthetic dev data (deterministic)
npm run db:migrate  # apply migrations to local D1
npm run db:seed     # upsert fixtures into D1; safe to re-run
npm run build && npx wrangler dev
```

Then visit `/staging/properties` — `base` in `astro.config.mjs` is pinned to
`/staging`, matching the staging environment's mount path. Production mounts at
`/app`, so that value has to change before this lands on `main`.

### Running against the real Agentbox feed

`npm run db:seed` loads the synthetic fixtures. To load real listings instead,
put credentials in `.dev.vars` at the project root — gitignored, and **not**
`.env.example`, which is committed:

```sh
AGENTBOX_CLIENT_ID=...   # base64 of the admin URL; it selects the instance
AGENTBOX_API_KEY=...
```

Then:

```sh
npm run agentbox:probe      # one listing, and what the mapping makes of it
npm run db:seed:agentbox    # drain the feed into local D1
```

Useful flags on the seed (`node --experimental-strip-types scripts/seed-d1.ts …`):

| Flag | Effect |
|---|---|
| `--agentbox` | Use the API instead of the fixtures |
| `--limit N` | Stop after N listings — a quick look without draining the instance |
| `--no-hydrate` | Skip the per-listing detail fetch: much faster, but no photos and no numeric prices |
| `--allow-production` | Address a live instance (see below) |
| `--remote` | Write to the deployed D1 rather than the local one |

Three things about the API that the published reference does not tell you, all
confirmed by probing the sandbox:

- **Every request needs a `version` query parameter.** Without one the API
  answers HTTP 300 "Invalid Version". The client sends `version=2` on every
  call.
- **`/listings` does not return photos.** `include=images` is accepted and
  silently ignored there; images exist only on `/listings/{id}`. A complete sync
  is therefore a list walk plus one detail fetch per listing, which is what
  hydration does and why it costs a request each.
- **Most of an instance is not publishable.** On the sandbox, 1,167 of 2,103
  listings carry `marketingStatus: "Not Listed"` — appraisals and pre-listings.
  The source filters to `Available, Sold, Leased, Under Contract` by default,
  leaving 936.

Agents and offices come from the listing payloads themselves; Agentbox embeds
the whole staff record in each listing, so no separate `/staff` sync is needed
and the fixture agent files are not used on this path.

### Sandbox and production

The client refuses a client ID that does not base64-decode to a sandbox admin
URL. That is deliberate — live vendor data is not something to reach for by
accident.

When the production credentials arrive, nothing in the code changes. Swap the
two values in `.dev.vars` and opt in explicitly, per run:

```sh
node --experimental-strip-types scripts/seed-d1.ts --agentbox --allow-production
```

or, for a shell that only ever holds live keys, set
`AGENTBOX_ALLOW_PRODUCTION=true` in the environment or `.dev.vars`. Both the
probe and the seed print which instance they are addressing before they do
anything.

### Seeding a deployed environment

A deploy creates the tables but leaves them empty — migrations build schema,
they do not load rows. `npm run db:seed` fills the local database, but it drives
the wrangler CLI and needs Cloudflare account access that Webflow Cloud
environments do not give you.

`POST /api/seed` does the same work from inside the Worker, through the D1
binding it already holds.

1. Add **`SEED_TOKEN`** as a **Secret** variable in Webflow Cloud, with any long
   random value. Redeploy so the Worker picks it up.
2. Call the endpoint:

```sh
curl -X POST \
  -H "content-type: application/json" \
  -H "x-seed-token: YOUR_SEED_TOKEN" \
  https://YOUR-SITE/staging/api/seed
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "https://YOUR-SITE/staging/api/seed" `
  -Headers @{ "content-type" = "application/json"; "x-seed-token" = "YOUR_SEED_TOKEN" }
```

**The `content-type: application/json` header is required.** Astro's CSRF
protection rejects POSTs with form-like content types and no matching `Origin`,
returning `403 Cross-site POST form submissions are forbidden` — which looks
like an auth failure but is not one.

The response reports progress:

```json
{ "done": true, "seededThisCall": 500, "listingsInDatabase": 500, "nextFrom": null }
```

If `done` is `false`, the run hit its internal time budget rather than failing.
POST again with `?from=<nextFrom>` to continue. Locally the whole set lands in a
single call in about half a second.

The endpoint is **idempotent** — the same upserts the offline loader uses, so
re-running changes nothing. It also **fails closed**: with no `SEED_TOKEN` set it
returns 503 and refuses to run, so an environment that has not opted in cannot
be seeded by accident.

### About `database_id` — do not go looking for a real one

`wrangler.json` carries `"database_id": "123456789"`, matching the dummy value
in Webflow Cloud's own instructions. **This is correct as-is and needs no
edit.**

Webflow Cloud has no "create a database and copy its ID" flow. Its Storage tab
does not open a creation form; it shows instructions telling you to declare the
`d1_databases` array in `wrangler.json`, commit, and deploy. Webflow provisions
the database and **assigns the real `database_id` at deploy time**, overwriting
whatever placeholder is in the file. The deploy also runs everything in
`migrations_dir` automatically.

So no Cloudflare account access is needed, and there is nothing to paste in.

One gotcha if you ever do change this value: local D1 state is keyed by
`database_id`, so changing it silently repoints local development at a fresh,
empty database. The old data is still on disk under the previous key, but the
app will report `no such table: listings`. Re-run `npm run db:migrate` and
`npm run db:seed` after any change.

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

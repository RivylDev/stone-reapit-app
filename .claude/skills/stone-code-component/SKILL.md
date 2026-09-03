---
name: stone-code-component
description: Build a React code component for the Webflow Designer in this repo, publish it to the Stone Listings library, and deploy the Cloud app. Use when adding a component designers place on the canvas, or when a deploy fails. Covers the SSR decision, prop naming, the publish and deploy commands, and the platform traps that cost hours the first time.
---

# Stone code components

Everything here was verified against this repo on 3 September 2026. The commands
work; the traps are ones we actually hit.

## First, the decision that governs everything

**Does this component need listing data?**

| | Server-rendered | Browser-fetched |
|---|---|---|
| `ssr` | `true` | `false` |
| Data source | `search()` from D1, via props | `fetch('/api/listings.json')` |
| In view-source | yes | no |
| Where it may go | anywhere, including `/buy` | marketing pages only |
| Example | `PropertySearch` | `ListingGrid` |

**Hard rule 4 is the boundary.** Listing content must appear in view-source with
JavaScript disabled on any page organic search depends on — roughly 5,200
property pages carry Stone's traffic. A browser-fetched component on `/buy`,
`/rent`, `/sold`, `/leased` or `/property/*` is a project failure, not a style
choice.

Do not declare `ssr: true` on a component that fetches. It puts an empty shell
in the HTML and implies the content is indexable when it is not.

## File layout

Three files per component, in `src/components/<Name>/`:

```
ListingGrid.tsx           the React component
ListingGrid.module.css    styles
ListingGrid.webflow.tsx   the Designer declaration
```

The glob in `webflow.json` (`./src/components/**/*.webflow.tsx`) picks them up.
No registration step.

### The CSS import is deliberately awkward

```ts
import * as cssModule from "./ListingGrid.module.css";
const styles = cssModule as unknown as Record<string, string>;
```

Webflow's bundler emits one named export per class and no default; Astro's
ambient `*.module.css` type declares the opposite. A namespace import is what
works at runtime, and the cast stops the type checker rejecting it. Copy this
pattern — do not "fix" it to a default import.

### Style through the site's tokens, with fallbacks

```css
border: 1px solid var(--_stone-tokens---border, #e0e0e0);
```

The fallback keeps the component legible on a page that does not load the
tokens. A designer restyles through Webflow variables, so aim for a sane
default, not a finished look.

## Prop naming is a contract

Props must match the canonical `Listing` field names in
`src/lib/types/listing.ts` exactly:

`listingId`, `uniqueId`, `slug`, `status`, `propertyType`, `suburb`, `state`,
`displayAddress`, `priceValue`, `priceDisplay`, `bedrooms`, `bathrooms`,
`carspaces`, `officeId`, `agentIds`

Never `beds`, `address` or `price`. A rename costs a change across two
codebases.

DevLink exports go the other way and prefix props with their Designer property
group — `suburb` arrives as `listingSuburb`, and the Listing Card's id prop is
`listingListingId`. That prefixing is DevLink's, not ours; do not imitate it in
components we author.

## Publishing to the Designer

```bash
npx webflow library share
```

Deprecated — it will be removed in the next major release, and the replacement
is `webflow devlink import`. Both components land in the **Stone Listings**
library, group **Listings**, and appear on the canvas immediately.

## Deploying the Cloud app

This is where the time goes. The command that works:

```bash
MSYS_NO_PATHCONV=1 /c/Users/eskel/AppData/Roaming/npm/webflow cloud deploy \
  --app-id dfe049f1-035f-445a-b71d-8301294f7142 \
  --site-id 6a73c4d12df78ea4c276a06b \
  --environment staging --mount /staging
```

Roughly 10 minutes: ~9 building, ~45s uploading. Every part of that command is
load-bearing:

**Call the global binary by full path, not `npx`.** `npx` prefers the local
`node_modules` copy. The CLI loads rspack from that tree, then shells out to
`npm ci`, which tries to delete the tree — and Windows will not unlink a
`.node` binary the running parent has mapped. You get:

```
npm error code EPERM
npm error syscall unlink
npm error path ...\@rspack\binding-win32-x64-msvc\rspack.win32-x64-msvc.node
```

Deleting `@rspack` does not help: it breaks the local CLI, `npx` silently
downloads **1.23.0** from the registry, and you get `unknown option '--app-id'`
because that older CLI calls them "projects". The global binary loads its rspack
from `AppData\Roaming\npm`, outside the tree being wiped.

**`MSYS_NO_PATHCONV=1`.** Without it Git Bash rewrites `/staging` into a Windows
path and the API rejects it with a misleading
`mount_path should match pattern` error.

**`--environment` and `--mount` together.** Without `--mount` the CLI defaults to
`/app` and you get `ENVIRONMENT_MOUNT_MISMATCH`. Passing the value the
environment already has is an assertion, not a re-path.

**`--app-id`, never `--app-name`.** A name creates a *new* app and fails with
`DUPLICATE_ENVIRONMENT_MOUNT` because `/staging` is taken. No CLI command lists
apps; the id is in the dashboard URL.

### If you get an OAuth scope error

```
OAuthForbidden: You are missing the following scopes - 'sites:write'
```

Check `npx webflow auth status`. If the session *has* the scope, something else
is being used instead — most likely `WEBFLOW_API_TOKEN` in `.env`, a Workspace
token with narrower scopes that shadows the OAuth session. Comment it out.

### After the deploy

The tooling edits `webflow.json` (Cloud contract fields), `package.json` and
`package-lock.json` and does **not** revert them. It does correctly restore
`astro.config.mjs`. Check `git status` and keep the contract fields.

## Fetching from the API

If the component fetches, it needs `src/pages/api/listings.json.ts`, which is
already CORS-enabled — required because the Designer canvas is served from
Webflow's origin, and Webflow's docs state a component's requests run in the
browser and the API must allow cross-origin.

**Prefix the mount path yourself.** A Designer page knows nothing about where
the app is mounted, so a bare `/api/listings.json` 404s against the Webflow
site. Take the base as a prop (`basePath`), defaulting to `/app`.

**Fall back on empty `priceDisplay`.** Around 70% of records carry a real
`priceValue` and no display string. Format the number rather than rendering a
blank line; use "Contact agent" only when there is genuinely no price.

## Verify before calling it done

```bash
npm run typecheck                      # must be clean
npm run build                          # must compile into the worker
```

Then against a running `wrangler dev --local`, or the deployed environment:

- the component renders with real rows, not just an empty shell
- `?status=withdrawn` returns public statuses, never a withdrawn listing
- `per_page` is clamped
- `href` values carry the mount path
- for an `ssr: true` component, the content is in view-source with JS off

A screenshot through headless Chrome is worth more than reasoning about it. Two
real bugs this session were only visible that way: a data-attribute name that
collided with a filter, and blank prices from empty `priceDisplay`.

## Current state worth knowing

Deployed at `https://stone-6adb3b.webflow.io/staging`. That environment runs on
**synthetic fixtures** — addresses, prices and descriptions are generated by
`scripts/generate-dev-fixtures.mjs`, and images are random Lorem Picsum photos.
It is publicly reachable, so treat anything you see there as fake and do not
screenshot it as if it were Stone's data.

The mount path is not settled — see `docs/WEBFLOW-CLOUD-ARCHITECTURE.md` before
assuming `/app`.

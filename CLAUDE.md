# CLAUDE.md

Instructions for Claude Code working in this repository.

## What this is

The listing feed for Stone Real Estate's new website. Stone is an Australian real estate franchise: 76 active offices, 837 agents, ~5,400 live property listings across NSW, QLD, ACT, VIC and TAS.

The old site is WordPress running ten proprietary plugins from a vendor called Agentpoint. This project replaces them. Property data comes from Agentbox (branded Reapit Sales), the group's CRM.

Stack: Astro on Webflow Cloud, which runs on Cloudflare Workers. D1 for storage. Webflow CMS for indexable pages. DevLink bridges Webflow components into the app as React islands.

## Current state

- Webflow Cloud app deployed and mounted at `/app`
- D1 binding configured in `wrangler.json`
- Seed data in the repo: `seed-listings.json` (5,376 records), `seed-listings-demo.json` (500), `seed-offices.json` (76), `seed-agents.json` (837)
- A `Listing Card` component exists in Webflow, being prepared for DevLink export
- **Reapit sandbox credentials issued.** `AgentboxSource` is written against them, but its response field mapping is unverified — the published API reference does not document the listing schema. Everything the app renders still runs on seed data.

## Hard rules

Do not violate these without asking first.

**1. All identifiers are strings, never numbers.**
Listing IDs are mostly 7 digits but some are 6. A second identifier exists in `100P######` and `IRE#######` forms. Integer columns will corrupt these silently.

**2. Agentbox is sandbox-only.**
*Amended 28 August 2026. This rule previously read "Never call the Agentbox API", on the premise that no credentials existed. Sandbox credentials have since been issued and the owner has authorised the integration.*

Only the sandbox instance may be called. `AgentboxClient` decodes the client ID and refuses one that does not resolve to a sandbox unless `allowProduction: true` is passed deliberately. Reaching a live instance still needs a decision, not a config change.

`createListingSource()` returns `MockSource` until the field mapping is verified against a real payload. Do not flip that default on guesswork.

**3. Nothing outside `src/lib/ingestion/` may import a concrete source.**
Consumers depend on the `ListingSource` interface, never on `MockSource` or a future `AgentboxSource` directly. This is what makes the eventual swap a non-event.

**4. Server-render everything on public routes.**
Listing data must appear in view-source with JavaScript disabled. Organic search is Stone's primary traffic channel and ~5,200 listing pages carry it. Client-side rendering of listing content is a project failure, not a style preference.

**5. Soft deletes only.**
Use `deleted_at` and `last_seen_at`. Never `DELETE FROM listings`. The source feed does not reliably signal removal, so "absent" and "withdrawn" are different states that must stay distinguishable.

**6. Store the raw payload on every record.**
Keep the untouched source object in `raw_payload`. When a field turns out to be needed later, it gets re-normalised from local data rather than re-fetched.

**7. Every write is idempotent.**
Upsert by `listing_id`. Running any sync twice must be a no-op. The source data contains genuine duplicate IDs.

**8. Never commit secrets.**
`.dev.vars` and `.env` stay in `.gitignore`. No credentials in code, config or commit messages.

## Naming convention

Webflow component prop names become React prop names after DevLink export. Both must match the canonical `Listing` type field names exactly:

`listingId`, `uniqueId`, `slug`, `status`, `propertyType`, `suburb`, `state`, `displayAddress`, `priceValue`, `priceDisplay`, `bedrooms`, `bathrooms`, `carspaces`, `officeId`, `agentIds`

Do not introduce alternative names like `beds`, `address` or `price`. A rename later costs a change across two codebases.

## Canonical type

Defined in `src/lib/types/listing.ts`. Treat as the contract.

```ts
export type ListingStatus =
  | 'forSale' | 'forRent' | 'underOffer' | 'sold' | 'leased' | 'withdrawn';

export interface Listing {
  listingId: string;
  uniqueId: string | null;
  slug: string;
  status: ListingStatus;
  propertyType: string;
  category: 'residential' | 'commercial' | 'rural' | 'land';
  unitNumber: string | null;
  streetNumber: string | null;
  street: string | null;
  suburb: string;
  state: string;
  postcode: string | null;
  displayAddress: string;
  latitude: number | null;
  longitude: number | null;
  priceValue: number | null;
  priceDisplay: string;
  priceSearchable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  landSize: number | null;
  landSizeUnit: 'sqm' | 'ha' | null;
  headline: string;
  description: string;
  features: string[];
  images: { url: string; order: number; caption: string | null }[];
  floorplans: { url: string; order: number }[];
  videoUrl: string | null;
  officeId: string;
  agentIds: string[];
  listedAt: string | null;
  soldAt: string | null;
  modifiedAt: string;
}
```

Price is deliberately three fields. `priceValue` filters, `priceDisplay` renders, `priceSearchable` handles vendors who hide the price. Do not collapse them.

## Source interface

```ts
export interface ListingSource {
  fetchAll(cursor?: string): Promise<{ listings: Listing[]; nextCursor?: string }>;
  fetchSince(since: Date): Promise<Listing[]>;
  fetchOne(listingId: string): Promise<Listing | null>;
}
```

## Task order

Work through these in sequence. Do not start a task before the previous one meets its exit criteria.

**Task 1. Types and interface**
Create `src/lib/types/listing.ts` and `src/lib/ingestion/source.ts` from the definitions above.
Exit: typechecks clean.

**Task 2. Schema and migrations**
Tables: `listings`, `listing_images`, `listing_agents`, `offices`, `agents`, `sync_runs`. Index for the facets: status, suburb, price, bedrooms, office.
Exit: migration applies to local D1 without error.

**Task 3. MockSource**
Reads the seed JSON, returns `Listing` objects. Implements all three interface methods. `fetchSince` filters on `modifiedAt`.
Exit: unit test returns 5,376 listings with no type errors.

**Task 4. Seed loader**
Script loading MockSource output into D1. Upsert, not insert.
Exit: running it twice produces identical row counts and no duplicates. This is the gate — do not proceed until it holds.

**Task 5. Query layer**
`src/lib/queries/listings.ts` exposing one `search()` function taking status, suburb, state, propertyType, priceMin, priceMax, bedsMin, bathsMin, carsMin, officeId, page, perPage, sort. Returns `{ results, total, facetCounts }`.
Exit: filtering by suburb and bedroom count returns correct counts against all 5,376 records.

**Task 6. Search route**
`/app/listings` reading query params and calling `search()`. Server-rendered.
Exit: results present in view-source with JavaScript disabled. Every filter combination produces a distinct shareable URL.

Preserve these exact parameter names, they match the current live site:
`keywords`, `property_type`, `price_min`, `price_max`, `bedrooms`, `bathrooms`, `carspaces`

**Task 7. DevLink card**
Consume the exported `Listing Card` React component as an Astro island in the results grid.
Exit: cards render with real seed data through DevLink props.

## Out of scope

Do not build these unless asked: authentication, property alerts, favourites, brochure PDF generation, the Webflow CMS sync writer, vendor reporting, map search, styling beyond what DevLink provides.

## Working style

- Ask before adding a dependency.
- Ask before changing the canonical type or the schema.
- Small commits, one task per branch.
- When a task's exit criteria cannot be met, stop and report rather than working around it.
- If a hard rule appears to block a task, that is a signal to ask, not to bypass.

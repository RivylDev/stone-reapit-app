# Reapit / Agentbox API — endpoints requested for Stone Real Estate

Prepared for the Reapit API team. Final list.

Compiled from the Stone website integration code, verified against the Reapit
Sales API v2 reference (sandbox docs), and checked against the current live
stonerealestate.com.au — all on 2 September 2026.

**Sixteen endpoints: fifteen read, one write.**

## Connection

| | |
|---|---|
| Base URL | `https://api.agentboxcrm.com.au` |
| API version | `2`, sent as `version=2` on every request |
| Auth | `X-Client-ID` and `X-API-Key` headers |
| Instance to date | Sandbox (`sandbox1`) only — production credentials not yet issued |

The client decodes `X-Client-ID` and refuses any value that does not resolve to a
sandbox admin URL unless production is deliberately enabled per run. Reaching a
live instance is a decision, not a configuration change.

---

## Group A — Listings and directory (in use today)

Implemented and verified against the sandbox.

### `GET /listings`

Collection key `listings`. Full and incremental listing sync.

| Parameter | Value |
|---|---|
| `limit` | `100` (documented default is 20) |
| `page` | incrementing, 1-based |
| `include` | `relatedStaffMembers,mainDescription` |
| `orderBy` | `firstCreated` (full) / `lastModified` (incremental) |
| `filter[modifiedAfter]` | ISO 8601 (incremental only) |
| `filter[marketingStatus]` | `Available,Sold,Leased,Under Contract` |

Roughly 70% of the sandbox carries `Not Listed` — appraisals and the pre-listing
pipeline, which is internal CRM state that does not belong on a public website.
Filtering server-side keeps it out.

We also expect to use `filter[offMarketListing]`, `filter[officeId]`,
`filter[projectId]` and the four `filter[inspection*Date*]` parameters. See the
verification notes below for why.

### `GET /listings/{listingId}`

`include=images,relatedStaffMembers,mainDescription`

The reference confirms what testing showed: `images` is an `include` on this
endpoint only — on `GET /listings` it is accepted and silently ignored. A
complete sync is therefore a list walk followed by one detail fetch per listing.
This is also the only source of a numeric price, and what a single-listing
refresh calls.

### `GET /offices` · `GET /offices/{officeId}`

The offices index — which doubles as the site's Contact page — and the individual
office pages. Stone has 76 active offices. `include=mainImage` on the collection,
`include=images` on the detail route, for office photography.

### `GET /staff` · `GET /staff/{memberId}`

The agent directory and individual profiles. We read `role`, `status` and
`webDisplay` to decide who may be published: in the sandbox, 98 of 108 staff
records carry an `Admin` role and are not public-facing, so the current rule
passes 12. `include=mainImage` and `include=images` for agent photography.

---

## Group B — Lookup vocabularies

Small, cached, refreshed infrequently. Each one replaces a value list we would
otherwise hard-code and let drift from the CRM.

| Endpoint | Why |
|---|---|
| `GET /property-types` | Property type and category vocabulary. Currently hard-coded in the site's search form |
| `GET /staff-role-types` | Valid `filter[role]` values. Our publication rule is written against the four roles in the sandbox; 76 offices will use roles it never shows |
| `GET /staff-web-display-types` | Valid `filter[webDisplay]` values, same reason |
| `GET /suburbs` | Suburb vocabulary for the search form |
| `GET /regions` | Region vocabulary, for `filter[region]` |

---

## Group C — Enquiry forms

The integration's only write operation, plus the four lookups its fields need.

### `POST /enquiries`

Three live forms on the current site post into the CRM, and one endpoint serves
all three:

1. **Ask a question** on every property page — roughly 5,200 pages — with
   quick-pick options *Price information*, *Rates and fees* and *Schedule an
   inspection*. Sent as a listing enquiry with `attachedListing`.
2. **Request Appraisal** under Sell.
3. **Request Appraisal** under Rent.

`POST /enquiries` matches an existing contact on email or mobile and creates one
only when no match is found, which is the behaviour a public form wants.

### The lookups it needs

| Endpoint | Feeds |
|---|---|
| `GET /enquiry-types` | The enquiry `type` — the quick-pick options above |
| `GET /enquiry-sources` | The enquiry `source` |
| `GET /contact-sources` | The appraisal form's "How did you find us?" dropdown |
| `GET /subscription` | The appraisal form's newsletter and property-alert checkboxes |

---

## Not requested

No contact records (`GET`/`POST`/`PUT /contacts`), no search requirements, no
subscription *management* (`PUT /subscribe`), no `internalInformation` or
`appraisalDetails` includes, no appraisal classifications, no enquiry interest
levels, no commission or financial data, and no property-management or tenancy
data.

We do not request access to the appraisal pipeline: `marketingStatus` excluding
`Not Listed` is sufficient.

---

## Questions

### 1. Is there a projects endpoint?

`GET /listings` offers `filter[projectId]` and `POST /enquiries` accepts an
`attachedProject`, so projects are clearly first-class. We can find no endpoint
in the reference that lists or reads them.

The live site has a New Projects section, and `Development` appears as a property
category. **Is there an endpoint outside this reference, or is the `Development`
category the intended way to model this?** We can filter listings by a project ID
we already hold, but cannot enumerate projects.

### 2. Please confirm `mainDescription` as an `include`

We depend on it on both listing endpoints and it works against the sandbox, but
it is not among the reference's visible `include` options for either. We would
rather have it confirmed than discover it was incidental.

### 3. Inspection and auction times in the response body

The filters exist — `filter[inspectionStartDateFrom]` and its three siblings,
plus `orderBy=nextInspectionDate`. The reference publishes response schemas as
empty objects, so we cannot confirm the times come back as fields.

This matters more than it might appear. The live site shows inspection times on
listing cards, on every property page, and in a homepage "What's on This Week"
calendar, with auction dates alongside them. **Do inspection and auction times
come back on `/listings`, on `/listings/{listingId}`, or only under a particular
`include`?**

### 4. Rate limit and page size

Documented default `limit` is 20 with no maximum stated. We use 100 and it works.
A full sync is roughly 54 list pages plus ~5,400 detail calls, at 6 concurrent,
retrying `429` and `5xx` with exponential backoff.

**If you have a documented rate limit or a preferred concurrency for a walk that
size, we will match it** — we would rather tune to your number than find it.

---

## Request volume

| Sync | Requests |
|---|---|
| Full listing sync | ~54 list pages + ~5,400 detail calls |
| Incremental sync | 1+ list pages + one detail call per changed listing |
| Directory sync | ~1 office page, ~9 staff pages, ~12 staff detail calls |
| Lookups | Nine small calls, cached, refreshed infrequently |
| Enquiries | One `POST` per form submission |

---

## Appendix — what was verified on the live site

Checked against stonerealestate.com.au on 2 September 2026, so that this request
matches what the site actually does rather than what we assumed.

- **Off-market listings are already public.** `/buy/off-market-sales/` displays
  12 properties with addresses, bed/bath/car counts and some prices, filtered by
  the same search form as the main listings. This is why
  `filter[offMarketListing]` is in scope.
- **Enquiry forms are load-bearing.** The property-page "Ask a question" form is
  the site's primary lead capture, and it sits on every listing page.
- **The appraisal form is CRM-shaped**, carrying a source dropdown and two
  subscription opt-ins that map onto the Agentbox contact model.
- **Inspection and auction times appear in three places** — homepage calendar,
  listing cards, and property detail pages.
- **Legacy URL formats**, needed for the 301 map rather than for this request:
  properties are
  `www.stonerealestate.com.au/property/{id}-{street}-{suburb}-{state}/`
  and agents are `www.stonerealestate.com.au/stone-{office}/meet-team/{name}/`.

One limit worth stating: the live-site check read rendered pages. We confirmed
the forms' fields, not their POST targets, so "these forms write to Agentbox" is
inferred from field shapes that match the contact model exactly — strong
evidence, not proof.

# Site map triage — what we can build, and what needs a decision

Every item in the site architecture map, sorted by whether this app can deliver it.

**Checked against:** the canonical `Listing` type, the section and query layer, the
migration schema, the agent directory policy, and the Reapit sandbox probes.

**Not checked against the live site.** Figures 02 and 03 of the source map are
inferred from URL structure, as its own footer notes.

| | Bucket | Count |
|---|---|---|
| | Live in the app | 11 |
| | Fits the model, not built yet | 5 |
| | Needs a decision before it can be built | 7 |
| | Aligned, but Webflow CMS rather than this app | 11 |
| | Out of scope for this project | 4 |

Map captured 28 August 2026. Triaged 2 September 2026.

---

## Live in the app

Server-rendered from D1 today. The map describes these accurately and nothing
about them needs revisiting.

### Buy — `/buy`
*header · fig 01, 02*

Carries `forSale` and `underOffer` together, which matches the map's read that
under-offer is a status rather than a view. A property that goes under offer
keeps the URL that earned its ranking.

### Rent — `/rent`
*header · fig 01, 02*

Residential rentals. The commercial split the map shows underneath it is the one
piece not yet wired — see the next section.

### Sold — `/sold`
*header · footer*

Reached from the Sell dropdown in the header and the Properties group in the
footer. One page, both entry points.

### Leased — `/leased`
*fig 02, 03*

Appears in the content model and in the office microsite nav but has no
corporate header entry. Built either way.

### All properties — `/properties`
*not in the map*

An addition, not something the live site has. It is where a bare entry point
lands and where the legacy `/listings` URLs redirect to.

### Property record — `/property/<slug>`
*fig 02 hub*

The hub the map is built around. One record, surfaced through every section —
correct. The **URL format** is a separate problem and sits in the decisions
section.

### Our offices — and Contact — `/offices`
*header ×2 · footer*

The map's observation that Contact has no page of its own and resolves to the
offices directory is right, and the app already follows it.

### Office page — `/offices/<slug>`
*fig 02, 03*

Already renders that office's team and a page of its listings, so "Our office"
and "Meet the team" from the microsite nav are partly covered.

### Our agents / Our people / Find an agent — `/agents`
*header ×2 · footer*

Three labels in the map, one index page. **Who appears on it** is an open
question — see the decisions section.

### Agent page — `/agents/<slug>`
*fig 02*

Flat, not nested under the office as the live site has it. Deliberate — an agent
changing office shouldn't change their URL — but it makes the redirect map
harder.

### Property search panel — `PropertySearch`
*implied by Buy / Rent*

Exported as a Webflow code component, so the same filter can sit on a
Designer-built Buy or Rent page and submit into the app. Plain GET form, nothing
to hydrate.

---

## Fits the model, not built yet

Nothing here needs a decision from Stone. The data supports it and the type
doesn't change — it is work, not risk.

### Buy → Residential / Commercial
*header · fig 01*

`category` is already a column in the migration and already on the canonical
type, but it isn't a filter in `SearchParams` yet. A small query-layer addition,
then two routes.

### Rent → Commercial
*header · fig 01*

The same addition as above, scoped to `forRent`. Both land together or neither
does.

### Office-scoped Buy / Rent / Sold / Leased
*fig 03 microsites*

**The largest unestimated item in the map.** The search function already takes an
`officeId`, so the capability exists — but fig 03 implies 76 offices × 4
sections, plus a scoped nav that has to stay in step with the corporate one.
Roughly 300 pages nobody has costed.

### Listings by agent
*fig 02 agent tier*

Search already accepts an `agentId` through the listing–agent join, so an agent
page can show what they front. Not yet on the page.

### "Just listed" badge
*fig 02 status list*

The map files this as a status. It is a recency rule over `listedAt` applied to a
for-sale listing — a display decision, and cheap. Keeping it out of the status
field is what makes it cheap.

---

## Needs a decision before it can be built

Each of these changes the canonical type, the schema, or what gets published
about a real vendor or a real person. They are questions for Stone, not
engineering choices.

### Off market sales
*header · footer · fig 02*

The map treats it as a fifth public view of the same record, with *Pre-market
opportunity* as its status. There is no such value in the type and none in the
public status set. Two questions, in order: **have vendors agreed to an
off-market listing sitting on a crawlable page**, and if so is it a new status or
a visibility flag? The first is the same consent question that keeps withdrawn
listings off every public URL.

### Legacy property URL format
*fig 02 · prose*

**The most urgent item here.** The map gives two shapes for the same page —
`/property/{id}-{address}-{suburb}/` in the prose, `/property/{id}/` in the
diagram. The only redirect handler in the app covers `/listings/*`, which is our
own earlier path space, not WordPress's. If the live shape is the long one,
nothing currently redirects roughly 5,200 indexed pages.

### Who appears in the agent directory
*fig 02 agent tier*

The map assumes every agent has a page. In the sandbox there are 108 staff, 98 of
them with an Admin role, and 47 front a live listing — including accounts named
"Atomix Sandbox" and "Birdeye Test". The publication rule currently passes 12.
Someone at Stone needs to confirm that rule against production before 837 agent
pages get generated.

### Agent URL nesting
*fig 02 · fig 03*

The live site nests an agent inside their office. Ours is flat. Preserving the
old URLs means a 301 map keyed on each agent's **historic** office assignment —
data the feed may not carry. Worth confirming what we actually have before
promising the redirects.

### Acreage as a Buy facet
*header · fig 01*

Listed as a sibling of Residential and Commercial, but it sits on a different
axis. Those two are categories; Acreage is a property type, alongside Farm and
Lifestyle. So this one nav item is `propertyType=Acreage`, or `category=rural`,
or a set of types — three different result sets. Someone has to pick.

### New projects
*header · fig 01*

In the header under Buy, absent from the content model in fig 02. Developments
are normally a parent record with child unit listings, and the schema has no
project entity and no parent–child relation. Either it is a filter — and we need
to know which — or it is a content type nobody has scoped.

### Opening Times calendar
*fig 02 prose*

The map says the homepage calendar reads the same records. Inspection and
open-home times are **not on the canonical type at all** — there is no field for
them and no table. A real schema addition, easy to miss because the map mentions
it in passing.

---

## Aligned, but Webflow CMS rather than this app

Marketing and policy content with no listing data behind it. Correct that they
exist, correct that they sit in the nav — they just aren't built here, and
shouldn't be.

| Item | Note |
|---|---|
| Selling with Stone | 3 labels, 1 page |
| Leasing with Stone | + approach to management |
| Manage | property management |
| About us | header · footer |
| Join us | resolves to `/careers/` |
| Franchise | footer only |
| Business agent | header only |
| Blog | footer only |
| Your questions our answers | footer only |
| Privacy policy | legal |
| Terms and conditions | legal |

The map's duplicate-label findings all live in this group and all hold up:
*Selling with Stone* in the header is the same page as *Our approach to selling*
in the footer, which makes three labels for one URL. Worth resolving in the CMS
before launch, but it costs nothing here.

---

## Out of scope for this project

Named as out of scope, or dependent on a system that does not exist yet. Each
still needs somewhere to point on launch day — leaving them on the old site is a
legitimate answer.

### Property alerts
*header ×2 · footer*

Explicitly out of scope. It also needs three things this project has none of:
accounts, a saved-search store and outbound email. The map notes all three links
appear to resolve to one page, which makes the launch-day decision simpler.

### Request appraisal
*header ×2 · fig 03*

A lead form that has to write back into Agentbox. Nothing in this project writes
to Agentbox in any direction — the integration is read-only, and against the
sandbox only.

### Property report
*header, top level*

The one standalone conversion item in the header, and the map is right that it
has no children. It is a third-party valuation tool, not listing data.

### The SHEDD
*footer · external*

Leaves the domain for a LightSpeed VT training platform. A link, correctly
flagged in the map as off-site.

---

## What still needs someone else

Three items cannot be settled from the codebase and need someone with CMS or
production access:

1. **Off market** — whether vendors consented to public off-market pages.
2. **The legacy property URL format** — which of the two shapes the live site uses.
3. **The Opening Times calendar** — whether inspection times are in scope, since
   they need a schema addition.

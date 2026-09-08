# Webflow CMS component to Astro, via DevLink and the CMS API

How Webflow-authored content reaches an Astro page in this app: what DevLink can
and cannot carry, what the Data API supplies instead, and the shape a component
has to have for the two to meet.

Worked out and verified against this repo on 8 September 2026.

---

## The short version

DevLink carries **presentation**. The Data API carries **data**. Neither carries
repetition, so Astro does that.

```
Webflow      one card component, styled          →  DevLink export
Webflow CMS  the collection's items              →  Data API
Astro        fetch, grid layout, .map()          →  the page
```

Build **one card**, never a Collection List, never a wrapper. Details below.

---

## What DevLink will not export

### Collection Lists

A Collection List is a CMS-bound repeater. DevLink has nothing to translate it
into, so it comes across as placeholders. `ListingCmsGrid` in this repo is the
worked example — the export ran and produced:

```ts
export type ListingCmsGridProps = {};   // no props at all

<NotSupported _atom={"Collection List"}>
  <NotSupported _atom={"Collection List Items"} />
  <NotSupported _atom={"Empty State"} />
</NotSupported>
```

`NotSupported` renders the literal string *"This builtin is not currently
supported: Collection List"*. Put that component on a page and you get three
lines of error text and no cards.

The export warns, but does not fail:

```
✓ 3 components exported to ./src/devlink
⚠ 1 component could not be fully exported:
    - ListingCmsGrid
        Unsupported elements: Collection List Items, Empty State
```

### Slots

Checked across the whole `src/devlink` output: no exported component accepts
children. Only `DevLinkProvider` mentions them.

So a wrapper component — even a plain Div Block grid — is useless. It would
export as a fixed empty box with no way to put anything inside it. **Do not
build a grid component.** The grid belongs in Astro.

(Code Components, the `.webflow.tsx` direction, are different and do support
slots. That is code → Designer, not DevLink.)

---

## What to build instead

One component per collection, representing **a single item**:

| Collection | Component | Props |
|---|---|---|
| Blogs | Blog Card | title, excerpt, author, date |
| Testimonials | Testimonial Card | quote, name, role, photo |
| Listings | Listing Card *(exists)* | address, suburb, price, beds… |

Astro fetches the rows, owns the grid CSS, and maps one card per item. This is
already how listings work: `ListingCard` is the export, and the grid lives in
`src/pages/index.astro`.

### The prop-prefix trap

DevLink prefixes every prop with its Designer **property group**. That is why
`suburb` arrives as `listingSuburb`, and why the id prop is the awkward
`listingListingId` — the group was "Listing" and the prop was already named
`listingId`, so it got the prefix twice.

**Name props without repeating the group.** A group called `Post` with props
`title`, `excerpt`, `author`, `date` exports as `postTitle`, `postExcerpt`,
`postAuthor`, `postDate`. Naming one `postTitle` inside group `Post` gives
`postPostTitle`.

### What it costs

The designer loses control of grid columns, gaps and breakpoints — those move
into Astro CSS. Unavoidable while DevLink has no slots. The card itself stays
fully designable in Webflow, which is where the visual work is.

---

## Reading the CMS

`src/lib/webflow/cms.ts`. Verified working against the live Blogs collection.

| | |
|---|---|
| Host | `https://api-cdn.webflow.com` — **not** `api.webflow.com` |
| Endpoint | `GET /v2/collections/{collection_id}/items/live` |
| Scope | `cms:read` |
| Page size | `limit` max 100, `offset` to page |
| Cache | 300s on non-enterprise plans, 120s enterprise |

Two reasons for the CDN host: it serves cached **published** content, and cached
responses **do not count against the rate limit** — which matters when every
render of a public page reads from it. `/items/live` returns published items
only, no drafts, which is what a public page wants.

The Blogs collection on this site is `6a9f5ee9da3cb06dec321c53`, fields
`name`, `slug`, `excerpt`, `author`, `date`, all PlainText.

### Getting a token

**Site settings → Apps & integrations → API access → Generate token.** Name it,
then set the permission per API — CMS to **read-only** is enough for this.

Site tokens last until revoked or 365 days of inactivity, and a site can hold
five. Mint one with the minimum scopes rather than reusing a broad one.

Then bind it as a **Secret** environment variable named `WEBFLOW_API_TOKEN` on
the Webflow Cloud environment, and add the same key to `.dev.vars` for local
work. Both are gitignored; hard rule 8 applies.

**The trap already hit twice:** a token with the wrong scopes fails with a
message naming exactly what it lacks —

```
OAuthForbidden: You are missing the following scopes - 'cms:read'
```

`fetchBlogPosts` surfaces that string verbatim, because it is the whole
diagnosis. Also check nothing is shadowing the token: a `WEBFLOW_API_TOKEN` in
`.env` overrides the CLI's OAuth session, and if it is narrower, commands fail
for a scope the session actually has.

### No token is not an error

`fetchBlogPosts` returns `{ posts: null, error: null }` when unconfigured, and
the page renders without the section. A fresh checkout has no Webflow
credentials and must still render every page — the same reason
`createListingSource()` defaults to fixtures.

---

## What this is not for

**Listings.** They come from Agentbox into D1. Reading them from Webflow CMS
would mean writing 5,376 records in there first — the CMS sync writer, which is
out of scope — leaving two sources of truth for the same data and a CMS round
trip to read back what D1 holds one hop away.

Use the Data API where **Webflow is the author** and nothing upstream exists:
blog, testimonials, editorial copy, office descriptions. Use D1 where Agentbox
is.

---

## Verified

`src/pages/index.astro` renders both sources on one page — six listings from D1,
three posts from Webflow CMS — and both appear in view-source with JavaScript
disabled, which is what hard rule 4 requires.

`src/lib/webflow/cms.test.ts` tests the mapping against a payload captured from
the live collection, so a field renamed in the Designer fails a test rather than
quietly emptying a section in production.

---

## To make ListingCmsGrid usable

Swap its Collection List for a plain Div Block containing **one** Listing Card,
then re-export. Astro supplies the repetition. Or leave it — the card alone is
enough, and the grid is four lines of CSS.

# Webflow Cloud architecture — mount paths and the public URL structure

**Status: open decision.** Nothing is blocked today, but this determines the URL
of every public page on the site, so it wants settling before more routes are
built. Ten files already read `BASE_URL`, and every route helper in
`src/lib/queries/sections.ts` takes a `base` — so the code is prefix-agnostic and
will follow whichever option is chosen. The decision is architectural, not a
refactor.

Sourced from the Webflow team's answers to our questions, 2 September 2026.

---

## What Webflow confirmed

| # | Question | Answer |
|---|---|---|
| 1 | Can Astro pages render in the Designer? | No. Cloud apps render at their mount path only. React that must appear on the Designer canvas has to be a **Code Component** |
| 2 | Does DevLink sync automatically? | **No — manual.** `webflow devlink export`, then commit and push. The push triggers the Cloud deploy. Publishing the Webflow site does not |
| 3 | Can Designer-page JS call Cloud API routes? | Yes. Data attributes authored in the Designer under Settings, your own DOM code. **You must prefix the mount path yourself on fetch calls** |
| 4 | Mount paths | One per environment, editable after creation with a redeploy. On a route conflict **the Cloud app wins and the native Designer page becomes unreachable** |
| 5 | One app or several? | Mount path is per environment, so one environment serves **one path prefix**. Bindings are scoped per app-environment, so **separate apps cannot share a D1 database or KV namespace** |

Two further notes from them: requests and CPU minutes pool across all apps on the
site plan, and any Cloud docs page has a markdown version if you append `.md`,
with a page index at `/llms.txt`.

---

## The problem

We are mounted at a single prefix — `base: "/staging"` in `astro.config.mjs`,
becoming `/app` in production. Answer 5 confirms that is structural rather than a
default we can configure away.

The live site's URLs are all top-level:

```
/property/8791905-34-sycamore-avenue-bateau-bay-nsw/
/buy/   /rent/   /sold/   /projects/
/our-people/our-agents/
/stone-tumbi-umbi/meet-team/tony-trinder/
```

Under one mount path those become `/app/property/...`, `/app/buy` and so on.

Hard rule 4 makes organic search the primary traffic channel, and roughly 5,200
listing pages carry it. So the platform constraint and the project requirement
are in direct conflict.

**The workaround Webflow suggested does not survive rule 4.** Answer 3 points at
Designer pages calling a Cloud API route from custom JS. That is client-side
rendering: listing content would not appear in view-source with JavaScript
disabled. Rule 4 calls that a project failure rather than a style preference.

---

## Options

### A. Accept the prefix

Everything lives under `/app/...`. 301 the old URLs to the new ones.

- **For:** cheapest to build, nothing changes in the code, one deploy
- **Against:** bakes `/app` permanently into 5,200 indexed URLs; makes the launch
  a single large ranking event rather than a quiet cutover
- **Unknown:** none. This is the known-safe option

### B. Several Cloud apps, one owning the data

One app holds D1 and exposes an API route. The others are mounted at their own
prefixes and call it **server-side during SSR**, never from the browser.

- **For:** preserves top-level URLs *and* server rendering — the only option that
  keeps both
- **Against:** several apps to deploy and keep in step; one extra network hop per
  render; the data app's API route becomes a public surface needing protection.
  Quota is shared across apps, not multiplied
- **Unknown:** whether an app-to-app server-side fetch is permitted and
  performant on Workers. **Needs verifying before this is chosen**

### C. Mount at `/` and move the marketing pages into Astro

The Cloud app becomes the whole site. Designer is reduced to a component source
via DevLink.

- **For:** cleanest URLs, one system, no cross-app hop
- **Against:** much the largest scope change — every marketing, legal and
  editorial page has to be rebuilt or migrated
- **Unknown:** **this option lives or dies on the routing question below**
- **Note:** the site map implies ~500 office-microsite pages. If those are in
  scope, this may be where the project ends up regardless

### D. Mount at `/property` only

Preserves the 5,200 detail pages at their exact existing URLs — where most of the
SEO value sits — and leaves the section pages elsewhere.

- **For:** protects the most valuable URLs at the lowest cost; a smaller bet
  than C
- **Against:** `/buy`, `/rent`, `/sold` and `/projects` still need
  server-rendered listing data and have no home. Solves half the problem
- **Unknown:** whether the section pages can be served acceptably some other way

### Comparison

| | Top-level URLs | Server-rendered | Build cost | Risk |
|---|---|---|---|---|
| A. Accept prefix | No | Yes | Lowest | URL migration for 5,200 pages |
| B. Multi-app | Yes | Yes | Medium | Unverified platform behaviour |
| C. Mount at `/` | Yes | Yes | Highest | Depends on the routing answer |
| D. `/property` only | Partly | Partly | Low | Leaves section pages unsolved |

---

## What we need to know before deciding

### 1. Ask Webflow: what does mounting at `/` actually conflict with?

They said a route conflict means the Cloud app wins and the native page becomes
unreachable. **If an app is mounted at `/`, does that conflict with every
Designer page on the site, or only the page at `/` itself?**

This single answer decides whether option C is clean or catastrophic. It cannot
be determined from what they have written so far.

### 2. Verify: can one Cloud app server-side fetch another?

Option B depends on it. Worth a spike before committing.

### 3. Decide: are the office microsites in scope?

~76 offices × several page types. If yes, option C gets substantially more
attractive, because that volume is not going to be hand-built in the Designer.

---

## A related problem this does not solve

Whichever option is chosen, `src/pages/listings/[...path].astro` sits *inside*
the mount prefix, so it only ever sees `/{prefix}/listings/*`. It can never catch
the real legacy WordPress URLs, which arrive at the site root.

**The 301s from the old site have to be handled at the root** — in Webflow's own
redirects, or by whatever owns `/` after this decision. Worth planning alongside
it rather than after.

---

## Operational note worth acting on now

DevLink does not sync automatically, and **publishing in Webflow does not deploy
the app**. A designer will change the Listing Card, hit Publish, see nothing
change and report a bug.

The sequence is `webflow devlink export` → commit → push. Somebody should write
that down where the design team will read it, not only here.

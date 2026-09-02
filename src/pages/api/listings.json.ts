import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { readRawFilters, toSearchParams } from '../../lib/queries/params.ts';
import { search, DEFAULT_PER_PAGE, type ListingSummary } from '../../lib/queries/listings.ts';
import { PUBLIC_STATUSES, propertyHref } from '../../lib/queries/sections.ts';

/**
 * Read-only listing search, as JSON.
 *
 * This exists for two consumers, and neither of them is a public listing page:
 *
 * 1. **Webflow Designer pages.** A Cloud app does not render on the Designer
 *    canvas, so a Designer-authored page that wants real listings has to fetch
 *    them. `public/stone-listings.js` is the client that does it.
 * 2. **The multi-app spike.** If the site ends up as several Cloud apps — one
 *    owning D1, the others mounted at their own path prefixes — this is the
 *    route they would call *server-side* while rendering. See
 *    `docs/WEBFLOW-CLOUD-ARCHITECTURE.md`.
 *
 * **It is not how `/buy`, `/rent` or a property page get their data.** Those
 * server-render from D1 directly, because hard rule 4 requires listing content
 * in view-source with JavaScript off. Fetching this route from the browser to
 * build a public listing page would undo that. The section pages call `search()`
 * directly and must keep doing so.
 *
 * The query parameters are deliberately the same ones the section pages take —
 * `keywords`, `property_type`, `price_min` and the rest — so there is one
 * vocabulary across the app rather than a second one here that drifts.
 */

/** Never widen. `withdrawn` is not reachable from any public URL, this included. */
const ALLOWED = new Set<string>(PUBLIC_STATUSES);

/** Lower than the page cap: this is a widget feed, not a bulk export. */
const MAX_PER_PAGE = 24;

/**
 * The shape sent to a browser.
 *
 * A deliberate subset of `ListingSummary`. `officeId`, `modifiedAt` and the
 * agent's phone number stay server-side — the first two are of no use to a
 * card, and the third is a real person's contact detail that should be
 * published on a page we control rather than handed out by an open endpoint.
 *
 * Field names match the canonical `Listing` type exactly, per the naming
 * convention. `bedrooms`, never `beds`. `priceDisplay`, never `price`.
 */
interface ListingPayload {
  listingId: string;
  slug: string;
  href: string;
  status: string;
  propertyType: string;
  suburb: string;
  state: string;
  postcode: string | null;
  displayAddress: string;
  streetAddress: string;
  priceDisplay: string;
  priceValue: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  photoCount: number;
  primaryImageUrl: string | null;
  agentName: string | null;
  listedAt: string | null;
}

function toPayload(listing: ListingSummary, base: string): ListingPayload {
  return {
    listingId: listing.listingId,
    slug: listing.slug,
    href: propertyHref(base, listing.slug),
    status: listing.status,
    propertyType: listing.propertyType,
    suburb: listing.suburb,
    state: listing.state,
    postcode: listing.postcode,
    displayAddress: listing.displayAddress,
    streetAddress: listing.streetAddress,
    priceDisplay: listing.priceDisplay,
    priceValue: listing.priceValue,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    carspaces: listing.carspaces,
    photoCount: listing.photoCount,
    primaryImageUrl: listing.primaryImageUrl,
    agentName: listing.agentName,
    listedAt: listing.listedAt,
  };
}

/*
 * Cross-origin reads are allowed, deliberately and narrowly.
 *
 * A code component renders on the Webflow Designer canvas, which is served from
 * Webflow's own origin rather than the site's. Webflow's docs are explicit that
 * a component's requests run in the browser and that "APIs must allow
 * cross-origin requests", so without this the cards render on the published
 * site but stay empty on the canvas — which is the one place a designer needs
 * to see them.
 *
 * What this does not open: the endpoint is GET-only, returns listing data that
 * is already public on every property page, sends no credentials, and carries
 * no header that would let a caller act as the user. The narrowing that matters
 * is in the handler — withdrawn listings and server-only fields never leave.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'accept, content-type',
  'Access-Control-Max-Age': '86400',
} as const;

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      // `Vary: Origin` keeps a cached response from being replayed to a
      // different origin than the one it was negotiated for.
      Vary: 'Origin',
      ...CORS,
    },
  });
}

/** Preflight. Some browsers send one for the `accept` header alone. */
export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: { ...CORS } });

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const db = env.DB;

  if (!db) {
    return json(
      { error: 'No database binding. Run `npm run db:migrate` and `npm run db:seed`.' },
      503,
      'no-store',
    );
  }

  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const params = toSearchParams(readRawFilters(url));

  /*
   * Whatever the caller asked for, intersected with what may be published.
   * `toSearchParams` already rejects unknown values, but it will happily accept
   * `withdrawn` because that is a legitimate internal status — so the narrowing
   * has to happen here rather than being assumed upstream.
   */
  const requested = params.status
    ? (Array.isArray(params.status) ? params.status : [params.status])
    : [];
  const statuses = requested.filter((s) => ALLOWED.has(s));

  params.status = statuses.length > 0 ? statuses : [...PUBLIC_STATUSES];

  /*
   * `per_page` is read here rather than in `toSearchParams`, which owns the
   * parameter vocabulary the indexed section-page URLs inherited from the live
   * site. A widget wanting six cards is this route's concern, not theirs.
   */
  const asked = Number.parseInt(url.searchParams.get('per_page') ?? '', 10);
  params.perPage = Number.isFinite(asked) && asked > 0
    ? Math.min(asked, MAX_PER_PAGE)
    : DEFAULT_PER_PAGE;

  try {
    const outcome = await search(db, params);

    return json(
      {
        results: outcome.results.map((listing) => toPayload(listing, base)),
        total: outcome.total,
        page: outcome.page,
        perPage: outcome.perPage,
        totalPages: outcome.totalPages,
      },
      200,
      // Short, because a sync can change this at any time, but long enough that
      // a Designer page with several widgets does not hit D1 once per widget.
      'public, max-age=60, stale-while-revalidate=300',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500, 'no-store');
  }
};

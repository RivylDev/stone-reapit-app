import type { ListingStatus } from '../types/listing.ts';

/**
 * The listing sections, and every URL the app builds for them.
 *
 * Status is a path segment, not a query parameter: `/buy`, not
 * `?status=forSale`. These are the pages organic search lands on, so each one
 * is a distinct URL with its own title, heading and description rather than a
 * filter state of a single page.
 *
 *   /properties          all public listings
 *   /buy                 for sale, including under offer
 *   /rent                for rent
 *   /sold                sold
 *   /leased              leased
 *   /property/<slug>     one property
 *
 * Everything above is relative to the app's mount path — `/staging` now, `/app`
 * in production — which is why the helpers below all take a `base`. Nothing
 * should concatenate these paths by hand.
 *
 * The status → section mapping lives here and nowhere else. The section pages,
 * the navigation tabs, the legacy `/listings/*` redirects and the detail page's
 * breadcrumb all read it, so a listing can never be filed under one section by
 * one of them and a different section by another.
 */

export type SectionSlug = 'all' | 'buy' | 'rent' | 'sold' | 'leased';

/**
 * Every status a member of the public may see.
 *
 * `withdrawn` is deliberately absent and is not reachable from any public URL:
 * a vendor who pulled their property off the market has not consented to it
 * staying visible. This list is what excludes it — the sections are defined as
 * status sets, so there is no "no status filter" path that could leak one.
 */
export const PUBLIC_STATUSES: readonly ListingStatus[] = [
  'forSale', 'underOffer', 'forRent', 'sold', 'leased',
];

export interface ListingSection {
  slug: SectionSlug;
  /**
   * The URL segment under the app mount — `/buy`, `/rent`, `/properties`.
   *
   * Not the same as `slug`: the "all" section lives at `properties`, because
   * `/all` is a poor URL to meet in a search result with no other context.
   */
  path: string;
  /** Navigation tab label. */
  label: string;
  /** The <h1>. */
  heading: string;
  /** Which statuses belong to this section. */
  statuses: ListingStatus[];
  /**
   * Slots into a title and meta description after the property noun:
   * "Properties for sale in Manly". Keep it a phrase, not a sentence.
   */
  phrase: string;
  /** Sits under the heading, and seeds the meta description. */
  blurb: string;
}

/**
 * Under offer sits in Buy rather than in a section of its own.
 *
 * A property goes under offer partway through its campaign and can come back.
 * Giving it a separate URL would move it off the page that earned its ranking
 * at exactly the moment interest peaks, and split the link equity across two
 * URLs for one property.
 */
export const SECTIONS: Record<SectionSlug, ListingSection> = {
  all: {
    slug: 'all',
    path: 'properties',
    label: 'All',
    heading: 'All properties',
    statuses: [...PUBLIC_STATUSES],
    phrase: 'listed',
    blurb: 'Every property currently listed with Stone.',
  },
  buy: {
    slug: 'buy',
    path: 'buy',
    label: 'Buy',
    heading: 'Properties for sale',
    statuses: ['forSale', 'underOffer'],
    phrase: 'for sale',
    blurb: 'Properties for sale with Stone, including those currently under offer.',
  },
  rent: {
    slug: 'rent',
    path: 'rent',
    label: 'Rent',
    heading: 'Properties for rent',
    statuses: ['forRent'],
    phrase: 'for rent',
    blurb: 'Properties available to rent with Stone.',
  },
  sold: {
    slug: 'sold',
    path: 'sold',
    label: 'Sold',
    heading: 'Sold properties',
    statuses: ['sold'],
    phrase: 'sold',
    blurb: 'Recent sales by Stone.',
  },
  leased: {
    slug: 'leased',
    path: 'leased',
    label: 'Leased',
    heading: 'Leased properties',
    statuses: ['leased'],
    phrase: 'leased',
    blurb: 'Recently leased properties managed by Stone.',
  },
};

/** The segment a single property sits under: `/property/<slug>`. */
export const PROPERTY_SEGMENT = 'property';

/** The directory, which sits alongside the sections rather than under one. */
export const OFFICES_SEGMENT = 'offices';
export const AGENTS_SEGMENT = 'agents';

export function officesHref(base: string): string {
  return `${base}/${OFFICES_SEGMENT}`;
}

export function officeHref(base: string, slug: string): string {
  return `${base}/${OFFICES_SEGMENT}/${slug}`;
}

export function agentsHref(base: string): string {
  return `${base}/${AGENTS_SEGMENT}`;
}

export function agentHref(base: string, slug: string): string {
  return `${base}/${AGENTS_SEGMENT}/${slug}`;
}

/**
 * A section's URL. `query` is a full query string including its `?`, or ''.
 */
export function sectionHref(base: string, section: ListingSection, query = ''): string {
  return `${base}/${section.path}${query}`;
}

/** One property's URL. Singular segment, so it cannot collide with a section. */
export function propertyHref(base: string, slug: string): string {
  return `${base}/${PROPERTY_SEGMENT}/${slug}`;
}

/** Tab order. `all` leads because it is where a bare entry point redirects. */
export const SECTION_ORDER: readonly SectionSlug[] = ['all', 'buy', 'rent', 'sold', 'leased'];

export const SECTION_LIST: readonly ListingSection[] =
  SECTION_ORDER.map((slug) => SECTIONS[slug]);

/**
 * The section a listing belongs to.
 *
 * Also drives the legacy `?status=` redirect. `withdrawn` has no section of its
 * own, so it resolves to `all` — which will not then show it, since `all` is
 * itself a status set. That is the intended dead end.
 */
export function sectionForStatus(status: string): SectionSlug {
  switch (status) {
    case 'forSale':
    case 'underOffer':
      return 'buy';
    case 'forRent':
      return 'rent';
    case 'sold':
      return 'sold';
    case 'leased':
      return 'leased';
    default:
      return 'all';
  }
}

export function isSectionSlug(value: string): value is SectionSlug {
  return Object.prototype.hasOwnProperty.call(SECTIONS, value);
}

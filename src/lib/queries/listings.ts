import type { ListingStatus } from '../types/listing.ts';

/**
 * The listing search.
 *
 * One entry point, `search()`, running against D1. It never touches a source —
 * the loader populates D1 and this reads it.
 */

export type SearchSort = 'newest' | 'priceAsc' | 'priceDesc' | 'suburb';

export const SORT_OPTIONS: readonly SearchSort[] = ['newest', 'priceAsc', 'priceDesc', 'suburb'];

export interface SearchParams {
  status?: ListingStatus | ListingStatus[];
  /** Case-insensitive substring match. The `keywords` URL param maps here. */
  suburb?: string;
  state?: string;
  propertyType?: string;
  priceMin?: number;
  priceMax?: number;
  bedsMin?: number;
  bathsMin?: number;
  carsMin?: number;
  officeId?: string;
  page?: number;
  perPage?: number;
  sort?: SearchSort;
}

/** A listing flattened for the results grid, with the card's props derived. */
export interface ListingSummary {
  listingId: string;
  uniqueId: string | null;
  slug: string;
  status: ListingStatus;
  propertyType: string;
  suburb: string;
  state: string;
  postcode: string | null;
  /** Full display address, including suburb and state. */
  displayAddress: string;
  /** Street-level only. This is what the DevLink card's displayAddress takes. */
  streetAddress: string;
  priceValue: number | null;
  priceDisplay: string;
  priceSearchable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  officeId: string | null;
  listedAt: string | null;
  modifiedAt: string;
  photoCount: number;
  primaryImageUrl: string | null;
  agentName: string | null;
  agentPhone: string | null;
}

export interface FacetCounts {
  status: Record<string, number>;
  suburb: Record<string, number>;
  propertyType: Record<string, number>;
  bedrooms: Record<string, number>;
}

export interface SearchOutcome {
  results: ListingSummary[];
  total: number;
  facetCounts: FacetCounts;
  page: number;
  perPage: number;
  totalPages: number;
}

export const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 60;
/** Facet lists are for a filter UI, not an index — keep them bounded. */
const FACET_LIMIT = 40;

type Bindable = string | number | null;

interface Condition {
  sql: string;
  values: Bindable[];
  /** Which facet dimension this constrains, so facet queries can drop it. */
  dimension?: keyof FacetCounts;
}

/**
 * Builds the WHERE fragments.
 *
 * `omit` drops the condition belonging to one facet dimension. Facet counts are
 * computed with every other filter applied but not their own, so the UI can
 * show what switching to a different value would yield rather than only
 * echoing the current selection.
 */
function buildConditions(params: SearchParams, omit?: keyof FacetCounts): {
  where: string;
  values: Bindable[];
} {
  const conditions: Condition[] = [];

  // Soft deletes: absent from the feed is not the same as withdrawn, and only
  // the former sets deleted_at.
  conditions.push({ sql: 'l.deleted_at IS NULL', values: [] });

  const statuses = params.status === undefined
    ? []
    : (Array.isArray(params.status) ? params.status : [params.status]);
  if (statuses.length > 0) {
    conditions.push({
      sql: `l.status IN (${statuses.map(() => '?').join(', ')})`,
      values: statuses,
      dimension: 'status',
    });
  }

  if (params.suburb) {
    conditions.push({
      sql: 'l.suburb LIKE ? COLLATE NOCASE',
      values: [`%${params.suburb}%`],
      dimension: 'suburb',
    });
  }

  if (params.state) {
    conditions.push({ sql: 'l.state = ? COLLATE NOCASE', values: [params.state] });
  }

  if (params.propertyType) {
    conditions.push({
      sql: 'l.property_type = ? COLLATE NOCASE',
      values: [params.propertyType],
      dimension: 'propertyType',
    });
  }

  /*
   * A price bound excludes listings whose price is hidden. price_value is NULL
   * for those, so they cannot satisfy a range, and silently keeping them would
   * misreport the count.
   */
  if (params.priceMin !== undefined) {
    conditions.push({ sql: 'l.price_searchable = 1 AND l.price_value >= ?', values: [params.priceMin] });
  }
  if (params.priceMax !== undefined) {
    conditions.push({ sql: 'l.price_searchable = 1 AND l.price_value <= ?', values: [params.priceMax] });
  }

  if (params.bedsMin !== undefined) {
    conditions.push({ sql: 'l.bedrooms >= ?', values: [params.bedsMin], dimension: 'bedrooms' });
  }
  if (params.bathsMin !== undefined) {
    conditions.push({ sql: 'l.bathrooms >= ?', values: [params.bathsMin] });
  }
  if (params.carsMin !== undefined) {
    conditions.push({ sql: 'l.carspaces >= ?', values: [params.carsMin] });
  }

  if (params.officeId) {
    conditions.push({ sql: 'l.office_id = ?', values: [params.officeId] });
  }

  const kept = conditions.filter((c) => omit === undefined || c.dimension !== omit);

  return {
    where: kept.map((c) => c.sql).join(' AND '),
    values: kept.flatMap((c) => c.values),
  };
}

function orderBy(sort: SearchSort): string {
  switch (sort) {
    // NULL prices sort last either way, rather than clumping at one end.
    case 'priceAsc':
      return 'ORDER BY l.price_value IS NULL, l.price_value ASC, l.listing_id ASC';
    case 'priceDesc':
      return 'ORDER BY l.price_value IS NULL, l.price_value DESC, l.listing_id ASC';
    case 'suburb':
      return 'ORDER BY l.suburb COLLATE NOCASE ASC, l.price_value DESC, l.listing_id ASC';
    case 'newest':
    default:
      // listing_id breaks ties so pagination is stable across pages.
      return 'ORDER BY l.listed_at IS NULL, l.listed_at DESC, l.listing_id ASC';
  }
}

interface ListingRow {
  listing_id: string;
  unique_id: string | null;
  slug: string;
  status: string;
  property_type: string;
  unit_number: string | null;
  street_number: string | null;
  street: string | null;
  suburb: string;
  state: string;
  postcode: string | null;
  display_address: string;
  price_value: number | null;
  price_display: string;
  price_searchable: number;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  office_id: string | null;
  listed_at: string | null;
  modified_at: string;
  photo_count: number;
  primary_image_url: string | null;
  agent_name: string | null;
  agent_phone: string | null;
}

/** Street-level address: what the card renders, with suburb shown separately. */
export function streetAddressOf(
  unitNumber: string | null,
  streetNumber: string | null,
  street: string | null,
): string {
  const number = unitNumber && streetNumber
    ? `${unitNumber}/${streetNumber}`
    : (unitNumber ?? streetNumber ?? '');
  return [number, street ?? ''].filter(Boolean).join(' ').trim();
}

function toSummary(row: ListingRow): ListingSummary {
  return {
    listingId: row.listing_id,
    uniqueId: row.unique_id,
    slug: row.slug,
    status: row.status as ListingStatus,
    propertyType: row.property_type,
    suburb: row.suburb,
    state: row.state,
    postcode: row.postcode,
    displayAddress: row.display_address,
    streetAddress: streetAddressOf(row.unit_number, row.street_number, row.street),
    priceValue: row.price_value,
    priceDisplay: row.price_display,
    priceSearchable: row.price_searchable === 1,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    carspaces: row.carspaces,
    officeId: row.office_id,
    listedAt: row.listed_at,
    modifiedAt: row.modified_at,
    photoCount: row.photo_count ?? 0,
    primaryImageUrl: row.primary_image_url,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
  };
}

function clampPage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function clampPerPage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PER_PAGE;
  return Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(value)));
}

async function facetFor(
  db: D1Database,
  params: SearchParams,
  dimension: keyof FacetCounts,
  column: string,
): Promise<Record<string, number>> {
  const { where, values } = buildConditions(params, dimension);
  const sql =
    `SELECT ${column} AS value, COUNT(*) AS n FROM listings l `
    + `WHERE ${where} AND ${column} IS NOT NULL `
    + `GROUP BY ${column} ORDER BY n DESC, value ASC LIMIT ${FACET_LIMIT}`;

  const { results } = await db.prepare(sql).bind(...values).all<{ value: string | number; n: number }>();

  const counts: Record<string, number> = {};
  for (const row of results ?? []) counts[String(row.value)] = row.n;
  return counts;
}

/**
 * Runs a search.
 *
 * Returns the page of results, the total across every page, and facet counts
 * for building the filter UI.
 */
export async function search(db: D1Database, params: SearchParams = {}): Promise<SearchOutcome> {
  const page = clampPage(params.page);
  const perPage = clampPerPage(params.perPage);
  const sort = SORT_OPTIONS.includes(params.sort as SearchSort) ? params.sort as SearchSort : 'newest';

  const { where, values } = buildConditions(params);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM listings l WHERE ${where}`)
    .bind(...values)
    .first<{ n: number }>();
  const total = totalRow?.n ?? 0;

  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  const offset = (page - 1) * perPage;

  const rowsSql =
    'SELECT l.listing_id, l.unique_id, l.slug, l.status, l.property_type, l.unit_number, '
    + 'l.street_number, l.street, l.suburb, l.state, l.postcode, l.display_address, '
    + 'l.price_value, l.price_display, l.price_searchable, l.bedrooms, l.bathrooms, '
    + 'l.carspaces, l.office_id, l.listed_at, l.modified_at, '
    + '(SELECT COUNT(*) FROM listing_images i WHERE i.listing_id = l.listing_id) AS photo_count, '
    + '(SELECT i.url FROM listing_images i WHERE i.listing_id = l.listing_id '
    + ' ORDER BY i.position ASC LIMIT 1) AS primary_image_url, '
    + 'a.full_name AS agent_name, a.phone AS agent_phone '
    + 'FROM listings l '
    + 'LEFT JOIN listing_agents la ON la.listing_id = l.listing_id AND la.position = 0 '
    + 'LEFT JOIN agents a ON a.agent_id = la.agent_id '
    + `WHERE ${where} ${orderBy(sort)} LIMIT ? OFFSET ?`;

  const { results } = await db
    .prepare(rowsSql)
    .bind(...values, perPage, offset)
    .all<ListingRow>();

  const [status, suburb, propertyType, bedrooms] = await Promise.all([
    facetFor(db, params, 'status', 'l.status'),
    facetFor(db, params, 'suburb', 'l.suburb'),
    facetFor(db, params, 'propertyType', 'l.property_type'),
    facetFor(db, params, 'bedrooms', 'l.bedrooms'),
  ]);

  return {
    results: (results ?? []).map(toSummary),
    total,
    facetCounts: { status, suburb, propertyType, bedrooms },
    page,
    perPage,
    totalPages,
  };
}

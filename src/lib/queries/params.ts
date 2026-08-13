import type { ListingStatus } from '../types/listing.ts';
import { SORT_OPTIONS, type SearchParams, type SearchSort } from './listings.ts';

/**
 * Translation between the URL and `SearchParams`.
 *
 * The parameter names are fixed by the current live site and must not drift:
 * these URLs are indexed, and organic search is the primary traffic channel.
 *
 *   keywords, property_type, price_min, price_max, bedrooms, bathrooms, carspaces
 *
 * `status`, `state`, `office`, `sort` and `page` are additions, not part of
 * that inherited contract.
 */

export const PARAM = {
  keywords: 'keywords',
  propertyType: 'property_type',
  priceMin: 'price_min',
  priceMax: 'price_max',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  carspaces: 'carspaces',
  status: 'status',
  state: 'state',
  office: 'office',
  sort: 'sort',
  page: 'page',
} as const;

const STATUSES: readonly ListingStatus[] = [
  'forSale', 'forRent', 'underOffer', 'sold', 'leased', 'withdrawn',
];

/** The filter values exactly as they came in, for round-tripping into the form. */
export interface RawFilters {
  keywords: string;
  property_type: string;
  price_min: string;
  price_max: string;
  bedrooms: string;
  bathrooms: string;
  carspaces: string;
  status: string;
  state: string;
  office: string;
  sort: string;
  page: string;
}

function text(value: string | null): string {
  return (value ?? '').trim();
}

function positiveInt(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function readRawFilters(url: URL): RawFilters {
  const get = (key: string) => text(url.searchParams.get(key));
  return {
    keywords: get(PARAM.keywords),
    property_type: get(PARAM.propertyType),
    price_min: get(PARAM.priceMin),
    price_max: get(PARAM.priceMax),
    bedrooms: get(PARAM.bedrooms),
    bathrooms: get(PARAM.bathrooms),
    carspaces: get(PARAM.carspaces),
    status: get(PARAM.status),
    state: get(PARAM.state),
    office: get(PARAM.office),
    sort: get(PARAM.sort),
    page: get(PARAM.page),
  };
}

/**
 * `keywords` maps onto the suburb filter. The field is labelled Suburb in the
 * UI; the parameter keeps its inherited name so existing URLs keep working.
 */
export function toSearchParams(raw: RawFilters): SearchParams {
  const params: SearchParams = {};

  if (raw.keywords) params.suburb = raw.keywords;
  if (raw.property_type) params.propertyType = raw.property_type;
  if (raw.state) params.state = raw.state;
  if (raw.office) params.officeId = raw.office;

  const priceMin = positiveInt(raw.price_min);
  if (priceMin !== undefined) params.priceMin = priceMin;
  const priceMax = positiveInt(raw.price_max);
  if (priceMax !== undefined) params.priceMax = priceMax;

  const beds = positiveInt(raw.bedrooms);
  if (beds !== undefined) params.bedsMin = beds;
  const baths = positiveInt(raw.bathrooms);
  if (baths !== undefined) params.bathsMin = baths;
  const cars = positiveInt(raw.carspaces);
  if (cars !== undefined) params.carsMin = cars;

  if (STATUSES.includes(raw.status as ListingStatus)) {
    params.status = raw.status as ListingStatus;
  }

  if (SORT_OPTIONS.includes(raw.sort as SearchSort)) {
    params.sort = raw.sort as SearchSort;
  }

  const page = positiveInt(raw.page);
  if (page !== undefined && page > 0) params.page = page;

  return params;
}

/**
 * Rebuilds the query string, dropping empties so that every distinct filter
 * combination has exactly one canonical URL rather than several that differ
 * only by trailing blanks.
 */
export function buildQueryString(
  raw: RawFilters,
  overrides: Partial<Record<keyof RawFilters, string | number | undefined>> = {},
): string {
  const merged: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value !== '') merged[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === '') delete merged[key];
    else merged[key] = String(value);
  }

  // Stable key order, so the same filters always produce the same URL.
  const search = new URLSearchParams();
  for (const key of Object.keys(PARAM) as (keyof typeof PARAM)[]) {
    const name = PARAM[key];
    if (merged[name] !== undefined) search.set(name, merged[name]);
  }

  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

export function hasAnyFilter(raw: RawFilters): boolean {
  return (['keywords', 'property_type', 'price_min', 'price_max', 'bedrooms',
    'bathrooms', 'carspaces', 'status', 'state', 'office'] as const)
    .some((key) => raw[key] !== '');
}

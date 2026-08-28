/**
 * ⚠️ PROVISIONAL — NOT VERIFIED AGAINST A REAL PAYLOAD ⚠️
 *
 * Every Agentbox → `Listing` field name in this file is a *guess*.
 *
 * The published Reapit Sales API reference documents the listing response
 * schema as an empty object (`{ "listings": [ {} ] }`). It never names a single
 * field of a listing record. What the reference *does* give is the filter and
 * `orderBy` vocabulary, and those names are the basis for the guesses below:
 *
 *   orderBy   soldPrice, searchPrice, address, lastModified, firstCreated,
 *             listedDate, nextInspectionDate
 *   filters   type, status, marketingStatus, propertyType, propertyCategory,
 *             suburb, region, state, latitude, longitude, priceFrom/To,
 *             bedroomsFrom/To, bathroomsFrom/To, totalParkingFrom/To,
 *             landAreaFrom/To, features, unitNum, lvNum, streetNum,
 *             streetName, streetType, officeId, memberId, hiddenListing
 *   include   images, relatedStaffMembers, relatedContacts
 *
 * Because it is guesswork, every field is read through `pick()`, which tries
 * several candidate paths and takes the first that exists. That is deliberately
 * loose: it buys tolerance to being wrong about *where* a value sits, at the
 * cost of being unable to prove any of it.
 *
 * ► To make this real, one authentic listing payload is enough. Run
 *   `node scripts/probe-agentbox.mjs` from a machine with network access to
 *   `api.agentboxcrm.com.au` (this container is firewalled off from it) and
 *   correct the paths below against what comes back. `collectUnmappedKeys()`
 *   reports which source keys the mapping ignored, which is the fastest way to
 *   spot what has been missed.
 *
 * Until that happens `createListingSource()` keeps returning `MockSource`.
 * Nothing in the app reads Agentbox data through this file yet.
 */

import type { Listing, ListingStatus } from '../types/listing.ts';

/* -------------------------------------------------------------- accessors -- */

type Raw = Record<string, unknown>;

/** Reads a dotted path, returning undefined at the first missing hop. */
function at(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Raw)[key];
  }

  return current;
}

/** First path that yields something other than undefined, null or ''. */
function pick(source: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    const value = at(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Numbers arrive as strings often enough that this has to cope with both.
 * Strips currency punctuation, which `searchPrice` may or may not carry.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(v)) return true;
    if (['false', 'no', '0', 'n'].includes(v)) return false;
  }
  return null;
}

/** ISO 8601, or null. Agentbox dates are `YYYY-MM-DD HH:MM:SS` as often as not. */
function asIsoDate(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;

  const parsed = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Arrays sometimes arrive as a single object when there is one element. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------ vocabulary -- */

/**
 * `status` is derived, not read.
 *
 * Agentbox splits what we call status across two fields: `type` says whether
 * the listing is a Sale or a Lease, and `marketingStatus` says where it is in
 * its lifecycle. Neither alone distinguishes `forSale` from `forRent`, or
 * `sold` from `leased`.
 */
export function mapStatus(rawType: unknown, rawMarketingStatus: unknown): ListingStatus {
  const type = (asString(rawType) ?? '').toLowerCase();
  const marketing = (asString(rawMarketingStatus) ?? '').toLowerCase();
  const isLease = type.includes('lease') || type.includes('rent');

  if (marketing.includes('sold')) return 'sold';
  if (marketing.includes('leased')) return 'leased';
  if (marketing.includes('under contract') || marketing.includes('under offer')) return 'underOffer';
  if (marketing.includes('withdrawn') || marketing.includes('not listed')) return 'withdrawn';

  return isLease ? 'forRent' : 'forSale';
}

/**
 * Agentbox's `propertyType` is the broad bucket (Residential, Commercial,
 * Rural, Land) and `propertyCategory` is the granular one (Apartment, House,
 * Factory). Our type names them the other way round: `category` is the bucket,
 * `propertyType` is the granular label. The mapping crosses over accordingly —
 * this is the single most likely thing to be wrong here, and the easiest to
 * confirm from one payload.
 */
export function mapCategory(rawPropertyType: unknown): Listing['category'] {
  const value = (asString(rawPropertyType) ?? '').toLowerCase();

  if (value.startsWith('comm')) return 'commercial';
  if (value.startsWith('rural')) return 'rural';
  if (value.startsWith('land') || value.startsWith('vacant')) return 'land';
  return 'residential';
}

function mapLandSizeUnit(value: unknown): Listing['landSizeUnit'] {
  const unit = (asString(value) ?? '').toLowerCase();

  if (unit.includes('ha') || unit.includes('hect')) return 'ha';
  if (unit.includes('m') || unit.includes('sq')) return 'sqm';
  return null;
}

/* ------------------------------------------------------------- the mapping -- */

/**
 * Top-level source keys this mapping consumes. Used only by
 * `collectUnmappedKeys` to report what a real payload carries that we ignore.
 */
const CONSUMED_KEYS = new Set([
  'id', 'listingId', 'externalId', 'uniqueId', 'uniqueID',
  'type', 'listingType', 'status', 'marketingStatus',
  'propertyType', 'propertyCategory', 'property',
  'displayAddress', 'address', 'suburb', 'state', 'postcode',
  'unitNum', 'unitNumber', 'streetNum', 'streetNumber', 'streetName', 'street', 'streetType',
  'latitude', 'longitude', 'location', 'geoLocation',
  'searchPrice', 'displayPrice', 'priceText', 'priceSearchable', 'hidePrice', 'displayPriceType',
  'bedrooms', 'bathrooms', 'totalParking', 'carspaces', 'landArea',
  'mainHeadline', 'headline', 'mainDescription', 'description',
  'features', 'media', 'images', 'mainImage', 'floorplans', 'videoLink', 'videoUrl',
  'office', 'officeId', 'relatedStaffMembers', 'members',
  'listedDate', 'soldDate', 'lastModified', 'firstCreated',
]);

/**
 * Turns one Agentbox listing record into a canonical `Listing`.
 *
 * The raw record is not stored here — the loader puts it in `raw_payload`, per
 * hard rule 6, so that a field this mapping gets wrong can be re-derived from
 * local data rather than re-fetched.
 *
 * Throws when there is no usable ID or address, because a `Listing` without
 * those cannot be keyed or rendered. Everything else degrades to a null.
 */
export function mapListing(raw: unknown): Listing {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('mapListing expected an object');
  }

  // Hard rule 1: identifiers are strings. `id` arrives as a JSON number in
  // plenty of CRMs; coercing here is what keeps a 6-digit ID from losing its
  // shape further down.
  const listingId = asString(pick(raw, 'id', 'listingId'));
  if (listingId === null) {
    throw new Error(`Agentbox listing has no id. Keys: ${Object.keys(raw).join(', ')}`);
  }

  const suburb = asString(pick(raw, 'property.suburb.name', 'property.suburb', 'suburb.name', 'suburb')) ?? '';
  const state = asString(pick(raw, 'property.suburb.state', 'property.state', 'suburb.state', 'state')) ?? '';
  const postcode = asString(pick(raw, 'property.suburb.postcode', 'property.postcode', 'suburb.postcode', 'postcode'));

  const unitNumber = asString(pick(raw, 'property.unitNum', 'unitNum', 'unitNumber'));
  const streetNumber = asString(pick(raw, 'property.streetNum', 'streetNum', 'streetNumber'));
  const streetName = asString(pick(raw, 'property.streetName', 'streetName'));
  const streetType = asString(pick(raw, 'property.streetType', 'streetType'));
  const street = [streetName, streetType].filter(Boolean).join(' ') || null;

  const displayAddress =
    asString(pick(raw, 'property.displayAddress', 'displayAddress', 'property.address', 'address')) ??
    buildAddress(unitNumber, streetNumber, street, suburb);

  if (displayAddress === '') {
    throw new Error(`Agentbox listing ${listingId} has no usable address`);
  }

  const priceValue = asNumber(pick(raw, 'searchPrice', 'property.searchPrice'));
  const priceDisplay = asString(pick(raw, 'displayPrice', 'priceText', 'property.displayPrice')) ?? '';

  // Two ways a vendor hides a price: an explicit flag, or no display text at
  // all. Treated as hidden either way — showing a bare number the vendor chose
  // not to publish is the failure mode that matters.
  const explicitHidden = asBoolean(pick(raw, 'hidePrice', 'property.hidePrice'));
  const explicitSearchable = asBoolean(pick(raw, 'priceSearchable', 'property.priceSearchable'));
  const priceSearchable =
    explicitSearchable ?? (explicitHidden === null ? priceValue !== null : !explicitHidden);

  const landSize = asNumber(pick(raw, 'property.landArea.value', 'landArea.value', 'property.landArea', 'landArea'));

  return {
    listingId,
    uniqueId: asString(pick(raw, 'externalId', 'uniqueId', 'uniqueID', 'property.externalId')),
    slug: `${slugify(displayAddress)}-${slugify(suburb)}-${listingId}`.replace(/-+/g, '-'),
    status: mapStatus(pick(raw, 'type', 'listingType'), pick(raw, 'marketingStatus', 'status')),

    // The crossover described on `mapCategory`.
    propertyType: asString(pick(raw, 'propertyCategory', 'property.type', 'property.propertyCategory')) ?? 'Unknown',
    category: mapCategory(pick(raw, 'propertyType', 'property.propertyType')),

    unitNumber,
    streetNumber,
    street,
    suburb,
    state,
    postcode,
    displayAddress,

    latitude: asNumber(pick(raw, 'property.location.lat', 'property.latitude', 'latitude', 'location.lat')),
    longitude: asNumber(pick(raw, 'property.location.long', 'property.longitude', 'longitude', 'location.long')),

    priceValue,
    priceDisplay,
    priceSearchable,

    bedrooms: asNumber(pick(raw, 'property.bedrooms', 'bedrooms')),
    bathrooms: asNumber(pick(raw, 'property.bathrooms', 'bathrooms')),
    carspaces: asNumber(pick(raw, 'property.totalParking', 'totalParking', 'carspaces')),
    landSize,
    landSizeUnit: landSize === null ? null : mapLandSizeUnit(pick(raw, 'property.landArea.unit', 'landArea.unit')),

    headline: asString(pick(raw, 'mainHeadline', 'headline')) ?? '',
    description: asString(pick(raw, 'mainDescription', 'description')) ?? '',
    features: mapFeatures(pick(raw, 'property.features', 'features')),

    images: mapImages(pick(raw, 'media', 'images')),
    floorplans: mapFloorplans(pick(raw, 'media', 'floorplans')),
    videoUrl: asString(pick(raw, 'videoLink', 'videoUrl', 'property.videoLink')),

    officeId: asString(pick(raw, 'office.id', 'officeId')) ?? '',
    agentIds: mapAgentIds(pick(raw, 'relatedStaffMembers', 'members')),

    listedAt: asIsoDate(pick(raw, 'listedDate', 'firstCreated')),
    soldAt: asIsoDate(pick(raw, 'soldDate', 'property.soldDate')),
    modifiedAt: asIsoDate(pick(raw, 'lastModified', 'firstCreated')) ?? new Date(0).toISOString(),
  };
}

function buildAddress(
  unitNumber: string | null,
  streetNumber: string | null,
  street: string | null,
  suburb: string,
): string {
  const number = [unitNumber, streetNumber].filter(Boolean).join('/');
  return [number, street, suburb].filter(Boolean).join(' ').trim();
}

function mapFeatures(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asString(typeof entry === 'object' ? pick(entry, 'name', 'label', 'value') : entry))
    .filter((entry): entry is string => entry !== null);
}

/**
 * Images require `include=images` on the request; without it this returns an
 * empty array rather than failing, so a listing still renders.
 *
 * Floorplans appear to live in the same `media` collection under a type
 * discriminator, so both mappers filter the same input.
 */
function mapImages(value: unknown): Listing['images'] {
  return asArray(value)
    .filter((entry) => !isFloorplan(entry))
    .map((entry, index) => ({
      url: asString(pick(entry, 'url', 'link', 'href', 'original')) ?? '',
      order: asNumber(pick(entry, 'order', 'position', 'sortOrder')) ?? index,
      caption: asString(pick(entry, 'caption', 'title', 'description')),
    }))
    .filter((image) => image.url !== '')
    .sort((a, b) => a.order - b.order);
}

function mapFloorplans(value: unknown): Listing['floorplans'] {
  return asArray(value)
    .filter(isFloorplan)
    .map((entry, index) => ({
      url: asString(pick(entry, 'url', 'link', 'href', 'original')) ?? '',
      order: asNumber(pick(entry, 'order', 'position', 'sortOrder')) ?? index,
    }))
    .filter((plan) => plan.url !== '')
    .sort((a, b) => a.order - b.order);
}

function isFloorplan(entry: unknown): boolean {
  const type = (asString(pick(entry, 'type', 'mediaType', 'category')) ?? '').toLowerCase();
  return type.includes('floor');
}

function mapAgentIds(value: unknown): string[] {
  const ids = asArray(value)
    .map((entry) => asString(typeof entry === 'object' ? pick(entry, 'id', 'staffId', 'memberId') : entry))
    .filter((id): id is string => id !== null);

  return [...new Set(ids)];
}

/**
 * Source keys the mapping does not read.
 *
 * A diagnostic, not part of the pipeline: point it at one real payload and it
 * names every field being dropped on the floor. That is the checklist for
 * turning this file from guesswork into fact.
 */
export function collectUnmappedKeys(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object') return [];

  return Object.keys(raw as Raw)
    .filter((key) => !CONSUMED_KEYS.has(key))
    .sort();
}

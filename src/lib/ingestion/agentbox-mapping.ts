/**
 * Agentbox listing record → canonical `Listing`.
 *
 * VERIFIED against live sandbox payloads (2,103 listings on sandbox1) via
 * `npm run agentbox:probe`. The paths below are what the API actually returns,
 * not inference from the filter vocabulary as they once were.
 *
 * Two shapes exist and this handles both:
 *
 *   /listings          thin. No `images`, no `searchPrice`. `mainDescription`
 *                      only when named in `include`.
 *   /listings/{id}     complete. Everything above, plus `images`.
 *
 * Anything the thin shape omits maps to null or an empty array rather than
 * throwing, so a list-only sync still produces renderable listings.
 *
 * Vocabulary observed across a 600-listing sample:
 *
 *   type               Sale (547), Lease (52), Sale/Lease (1)
 *   marketingStatus    Not Listed (421), Sold (76), Available (67),
 *                      Leased (25), Under Contract (11)
 *   property.type      Residential, Commercial, Holiday, Business, Rural
 *   property.category  House, Apartment, Land, Acreage, Unit, Semi/Duplex,
 *                      Office, Townhouse, Retail, Block Of Units, Warehouse,
 *                      Development, Car Space, Villa, Motel, …
 *
 * Note `marketingStatus` — roughly 70% of records on the instance are
 * appraisals and pre-listings marked "Not Listed". They are not publishable,
 * which is why `AgentboxSource` filters them out before they reach here.
 */

import type { Listing, ListingStatus } from '../types/listing.ts';
import type { SourceAgent, SourceOffice } from './source.ts';

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

/** Matches a trailing `Z` or `±HH:MM` / `±HHMM` offset. */
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * ISO 8601, or null.
 *
 * `lastModified` carries an offset (`2026-07-30T18:05:55+10:00`), but the other
 * date fields arrive as bare `YYYY-MM-DD HH:MM:SS`. A date-time with no zone is
 * parsed as *local* time by the ECMAScript spec, which would make `modifiedAt`
 * depend on the timezone of whichever machine ran the sync — the same record
 * would land 10 hours apart from a Sydney laptop and a UTC container, and
 * `modifiedAt` is what the loader dedupes on.
 *
 * A zone-less value is therefore read as UTC. That may be an hours-level offset
 * from what the CRM meant, but it is the same value everywhere, every run.
 */
function asIsoDate(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;

  const normalised = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const zoned = HAS_TIMEZONE.test(normalised) ? normalised : `${normalised}Z`;

  const parsed = Date.parse(zoned);
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
  // `Sale/Lease` is offered both ways. It reads as a sale, which is the
  // primary intent and what the display price is quoted against.
  const isLease = !type.includes('sale') && (type.includes('lease') || type.includes('rent'));

  if (marketing.includes('sold')) return 'sold';
  if (marketing.includes('leased')) return 'leased';
  if (marketing.includes('under contract') || marketing.includes('under offer')) return 'underOffer';
  if (marketing.includes('withdrawn') || marketing.includes('not listed')) return 'withdrawn';

  return isLease ? 'forRent' : 'forSale';
}

/**
 * `property.type` is the broad bucket, `property.category` the granular label.
 * Our type names them the other way round — `category` is the bucket,
 * `propertyType` the granular label — so the mapping crosses over. Confirmed
 * against the payload: `property.type` is "Residential", `property.category`
 * is "Apartment".
 *
 * `Business` buckets as commercial; `Holiday` as residential.
 */
export function mapCategory(rawPropertyType: unknown): Listing['category'] {
  const value = (asString(rawPropertyType) ?? '').toLowerCase();

  if (value.startsWith('comm') || value.startsWith('business')) return 'commercial';
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
  'id', 'externalId', 'type', 'status', 'marketingStatus',
  'property', 'officeId', 'officeName', 'relatedStaffMembers',
  'displayPrice', 'searchPrice', 'searchWeeklyRent', 'displayRent', 'listedRent',
  'mainHeadline', 'mainDescription', 'images', 'floorplans',
  'listedDate', 'soldDate', 'leasedDate', 'lastModified', 'firstCreated',
  'webLink', 'hiddenListing', 'offMarketListing',
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

  /*
   * Address lives under `property.address`, confirmed against the payload.
   * Nothing sits at the top level, and `property.suburb` does not exist — an
   * earlier guess that made every record throw "no usable address".
   */
  const address = at(raw, 'property.address');

  const suburb = asString(pick(address, 'suburb')) ?? '';
  const state = asString(pick(address, 'state')) ?? '';
  const postcode = asString(pick(address, 'postcode'));

  const unitNumber = asString(pick(address, 'unitNum'));
  const streetNumber = asString(pick(address, 'streetNum'));
  const streetName = asString(pick(address, 'streetName'));
  const streetType = asString(pick(address, 'streetType'));
  const street = [streetName, streetType].filter(Boolean).join(' ') || null;

  /*
   * `hideAddress` is the vendor withholding the street, not the listing. The
   * suburb still publishes — that is the whole point of an off-market-address
   * listing — so it degrades to the locality rather than being dropped.
   */
  const hideAddress = asBoolean(pick(address, 'hideAddress')) ?? false;
  const streetAddress = asString(pick(address, 'streetAddress'));

  const displayAddress = hideAddress
    ? [suburb, state].filter(Boolean).join(' ')
    : (streetAddress
        ? [streetAddress, suburb].filter(Boolean).join(', ')
        : buildAddress(unitNumber, streetNumber, street, suburb));

  if (displayAddress === '') {
    throw new Error(`Agentbox listing ${listingId} has no usable address`);
  }

  const status = mapStatus(pick(raw, 'type'), pick(raw, 'marketingStatus', 'status'));
  const isRental = status === 'forRent' || status === 'leased';

  /*
   * Sales quote `searchPrice`; rentals quote `searchWeeklyRent` and leave
   * `searchPrice` as the string "0". Reading the wrong one prices every rental
   * at zero, so the two are kept apart and a literal 0 is treated as absent.
   */
  const rawPrice = isRental
    ? pick(raw, 'searchWeeklyRent', 'listedRent.value')
    : pick(raw, 'searchPrice');
  const parsedPrice = asNumber(rawPrice);
  const priceValue = parsedPrice === 0 ? null : parsedPrice;

  const priceDisplay =
    asString(pick(raw, 'displayPrice', 'displayRent.value')) ?? '';

  /*
   * Display and filterability are separate concerns, and `searchPrice` is
   * Agentbox's answer to exactly that: `displayPrice` reads "confidential" or
   * "Over $635,000" while `searchPrice` carries the number the listing should
   * still be found by. So this tracks whether there is a usable figure, not
   * whether the vendor chose to print one.
   */
  const priceSearchable = priceValue !== null;

  const landSize = asNumber(pick(raw, 'property.landArea.value'));

  return {
    listingId,
    uniqueId: asString(pick(raw, 'externalId')),
    slug: `${slugify(displayAddress)}-${listingId}`.replace(/-+/g, '-'),
    status,

    // The crossover described on `mapCategory`.
    propertyType: asString(pick(raw, 'property.category')) ?? 'Unknown',
    category: mapCategory(pick(raw, 'property.type')),

    unitNumber,
    streetNumber,
    street,
    suburb,
    state,
    postcode,
    displayAddress,

    latitude: asNumber(pick(raw, 'property.location.lat')),
    longitude: asNumber(pick(raw, 'property.location.long')),

    priceValue,
    priceDisplay,
    priceSearchable,

    bedrooms: asNumber(pick(raw, 'property.bedrooms')),
    bathrooms: asNumber(pick(raw, 'property.bathrooms')),
    carspaces: asNumber(pick(raw, 'property.totalParking')),
    landSize,
    landSizeUnit: landSize === null ? null : mapLandSizeUnit(pick(raw, 'property.landArea.unit')),

    headline: asString(pick(raw, 'mainHeadline')) ?? '',
    // Present on /listings only when named in `include`; always on the detail
    // endpoint.
    description: asString(pick(raw, 'mainDescription')) ?? '',
    features: mapFeatures(pick(raw, 'property.features')),

    // `images` is absent from the list endpoint entirely — no `include` value
    // adds it. A list-only sync yields empty arrays here, by design.
    images: mapImages(pick(raw, 'images')),
    floorplans: mapFloorplans(pick(raw, 'floorplans')),
    videoUrl: asString(pick(raw, 'videoLink', 'videoUrl')),

    officeId: asString(pick(raw, 'officeId')) ?? '',
    agentIds: mapAgentIds(pick(raw, 'relatedStaffMembers')),

    listedAt: asIsoDate(pick(raw, 'listedDate', 'onMarketDate', 'firstCreated')),
    soldAt: asIsoDate(pick(raw, 'soldDate', 'leasedDate')),
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
 * Image records are `{ id, title, url, thumbnails[], order }`. `order` arrives
 * as a string ("1"), and the array is not guaranteed sorted.
 *
 * `thumbnails` carries pre-rendered sizes (a: 480², b/c/d: 800×600). Only the
 * full-size `url` is kept — the card renders one image and the schema has no
 * column for a size set. The untouched record survives in `raw_payload`, so
 * adding responsive sources later needs no re-fetch.
 */
function mapImages(value: unknown): Listing['images'] {
  return asArray(value)
    .filter((entry) => !isFloorplan(entry))
    .map((entry, index) => ({
      url: asString(pick(entry, 'url')) ?? '',
      order: asNumber(pick(entry, 'order')) ?? index,
      caption: asString(pick(entry, 'title', 'caption')),
    }))
    .filter((image) => image.url !== '')
    .sort((a, b) => a.order - b.order);
}

/**
 * No floorplan collection has appeared on any sampled payload — not on the
 * list endpoint, not on the detail endpoint. This stays wired to a `floorplans`
 * key and a type discriminator so an instance that does carry them maps
 * without a code change, and yields an empty array on one that does not.
 */
function mapFloorplans(value: unknown): Listing['floorplans'] {
  // Every entry under a dedicated `floorplans` key is one; no discriminator to
  // filter on, unlike the mixed-media collection this used to assume.
  return asArray(value)
    .map((entry, index) => ({
      url: asString(pick(entry, 'url')) ?? '',
      order: asNumber(pick(entry, 'order')) ?? index,
    }))
    .filter((plan) => plan.url !== '')
    .sort((a, b) => a.order - b.order);
}

function isFloorplan(entry: unknown): boolean {
  const type = (asString(pick(entry, 'type', 'mediaType', 'category')) ?? '').toLowerCase();
  return type.includes('floor');
}

/**
 * `relatedStaffMembers` entries wrap the person: `{ webDisplay, displayOrder,
 * role, staffMember: { id, … } }`. The ID is one level down — reading `id` off
 * the wrapper, as this once did, returns nothing at all.
 *
 * Ordered by `displayOrder`, so position 0 is the listing's lead agent, which
 * is the one the card renders.
 */
function mapAgentIds(value: unknown): string[] {
  const entries = asArray(value)
    .map((entry) => ({
      id: asString(pick(entry, 'staffMember.id', 'id')),
      order: asNumber(pick(entry, 'displayOrder')) ?? Number.MAX_SAFE_INTEGER,
      webDisplay: asBoolean(pick(entry, 'webDisplay')) ?? true,
    }))
    .filter((entry): entry is { id: string; order: number; webDisplay: boolean } => entry.id !== null)
    // A staff member flagged off the web is not published against the listing.
    .filter((entry) => entry.webDisplay)
    .sort((a, b) => a.order - b.order);

  return [...new Set(entries.map((entry) => entry.id))];
}

/**
 * The staff records embedded in a listing, as `agents` table rows.
 *
 * Agentbox returns the whole person inline with the listing, so a sync gets the
 * agent directory for free and never needs `/staff`. Without this the cards
 * render every listing as "Stone" with no phone — the query joins `agents` on
 * `listing_agents`, and IDs alone satisfy neither side.
 */
export function mapStaffMembers(raw: unknown): SourceAgent[] {
  return asArray(at(raw, 'relatedStaffMembers'))
    .map((entry): SourceAgent | null => {
      const member = at(entry, 'staffMember');
      const agentId = asString(pick(member, 'id'));
      if (agentId === null) return null;

      const firstName = asString(pick(member, 'firstName'));
      const lastName = asString(pick(member, 'lastName'));
      const hideMobile = asBoolean(pick(member, 'hideMobileOnWeb')) ?? false;

      const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

      return {
        agentId,
        slug: directorySlug(fullName, agentId),
        firstName,
        lastName,
        fullName,
        officeId: asString(pick(member, 'officeId')),
        // `hideMobileOnWeb` is a publication rule, so the mobile is dropped at
        // the mapping rather than filtered at render — it never reaches the
        // database to be leaked by a later query.
        phone: (hideMobile ? null : asString(pick(member, 'mobile'))) ?? asString(pick(member, 'phone')),
        email: asString(pick(member, 'email')),
        photoUrl: asString(pick(member, 'photo', 'photoUrl', 'imageUrl')),
        // The embedded staff record carries none of these. A `/staff` sync
        // fills them; until one runs, an agent has a name and a contact and is
        // not publishable by the directory rule, which is the safe default.
        jobTitle: asString(pick(member, 'jobTitle')),
        role: asString(pick(member, 'role')),
        status: asString(pick(member, 'status')),
        profile: null,
        specialistAreas: [],
        webDisplay: mapWebDisplay(pick(member, 'webDisplay')),
      };
    })
    .filter((staff): staff is SourceAgent => staff !== null);
}

/** The office a listing belongs to, as an `offices` table row. */
export function mapOffice(raw: unknown): SourceOffice | null {
  const officeId = asString(pick(raw, 'officeId'));
  if (officeId === null) return null;

  const name = asString(pick(raw, 'officeName')) ?? officeId;

  return {
    officeId,
    name,
    slug: directorySlug(name, officeId),
    // The listing payload names the office and nothing more. These columns
    // exist on the table and stay null until a `/offices` sync fills them.
    streetAddress: null,
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    phone: null,
    email: null,
    website: null,
    latitude: null,
    longitude: null,
    status: null,
  };
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

/* ------------------------------------------------------- directory records -- */

/*
 * The office and staff endpoints, mapped.
 *
 * These are separate from `mapOffice` and `mapStaffMembers` above, which read
 * what the *listing* payload embeds — an office name, and a staff member's
 * name, phone and email. `/offices` and `/staff` return substantially more, and
 * every field below was confirmed against the sandbox by
 * `scripts/probe-directory.ts` rather than guessed from the reference, which
 * documents both responses as empty objects.
 */

/**
 * Fields that must never leave the boundary.
 *
 * `/staff/{id}` returns an employee's date of birth and home address. Nothing
 * on a property website has any use for either, and the surest way to keep them
 * off a page is to never let them into the object that becomes a database row.
 * This is an allowlist by construction — `mapStaffRecord` names the fields it
 * wants, so a field added by Reapit later is dropped by default rather than
 * silently persisted.
 */
export const STAFF_FIELDS_NEVER_STORED = [
  'dateOfBirth', 'homeAddress', 'licenceNumber', 'corporateLicenceNumber',
  'licenceExpiryDate', 'corporateLicenceExpiryDate', 'startDate', 'financeId',
] as const;

/** A directory slug: readable, and suffixed with the ID so it stays unique. */
function directorySlug(name: string | null, id: string): string {
  const stem = slugify(name ?? '');
  return (stem === '' ? slugify(id) : `${stem}-${slugify(id)}`).replace(/-+/g, '-');
}

/**
 * One `/offices` record.
 *
 * The address arrives as a nested object rather than the flat fields the
 * listing payload uses, which is why this cannot reuse `mapOffice`.
 */
export function mapOfficeRecord(raw: unknown): SourceOffice | null {
  const officeId = asString(pick(raw, 'id', 'officeId'));
  if (officeId === null) return null;

  const name = asString(pick(raw, 'name', 'officeName', 'tradingName')) ?? officeId;

  return {
    officeId,
    name,
    slug: directorySlug(name, officeId),
    streetAddress: asString(at(raw, 'address.streetAddress')),
    suburb: asString(at(raw, 'address.suburb')),
    state: asString(at(raw, 'address.state')),
    postcode: asString(at(raw, 'address.postcode')),
    country: asString(at(raw, 'address.country')),
    phone: asString(pick(raw, 'phone')),
    email: asString(pick(raw, 'email')),
    website: asString(pick(raw, 'website')),
    latitude: asNumber(at(raw, 'location.lat')),
    longitude: asNumber(at(raw, 'location.long')),
    status: asString(pick(raw, 'status')),
  };
}

/**
 * `webDisplay` arrives as `[{"name":"Our Staff"}, …]`.
 *
 * Flattened to the names, because the shape carries nothing else and a plain
 * string array is what the publication rule actually asks questions of.
 */
function mapWebDisplay(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asString(pick(entry, 'name')) ?? asString(entry))
    .filter((name): name is string => name !== null && name !== '');
}

/**
 * One `/staff` or `/staff/{id}` record.
 *
 * Reads only the fields named here. Anything else the endpoint returns —
 * including the personal data in `STAFF_FIELDS_NEVER_STORED` — is dropped.
 */
export function mapStaffRecord(raw: unknown): SourceAgent | null {
  const agentId = asString(pick(raw, 'id', 'agentId'));
  if (agentId === null) return null;

  const firstName = asString(pick(raw, 'firstName'));
  const lastName = asString(pick(raw, 'lastName'));
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

  // `hideMobileOnWeb` is a publication rule, so the mobile is dropped here
  // rather than filtered at render — it never reaches the database to be
  // leaked by a later query.
  const hideMobile = asBoolean(pick(raw, 'hideMobileOnWeb')) ?? false;

  return {
    agentId,
    slug: directorySlug(fullName, agentId),
    firstName,
    lastName,
    fullName,
    officeId: asString(pick(raw, 'officeId')),
    phone: (hideMobile ? null : asString(pick(raw, 'mobile'))) ?? asString(pick(raw, 'phone')),
    email: asString(pick(raw, 'email')),
    // No photo field exists on either staff endpoint. Kept for the fixture
    // source, which does supply one.
    photoUrl: asString(pick(raw, 'photo', 'photoUrl', 'imageUrl')),
    jobTitle: asString(pick(raw, 'jobTitle')),
    role: asString(pick(raw, 'role')),
    status: asString(pick(raw, 'status')),
    profile: asString(pick(raw, 'profile')),
    specialistAreas: asArray(pick(raw, 'specialistAreas'))
      .map((entry) => asString(pick(entry, 'name')) ?? asString(entry))
      .filter((name): name is string => name !== null && name !== ''),
    webDisplay: mapWebDisplay(pick(raw, 'webDisplay')),
  };
}

/**
 * The canonical Listing type. Treat as the contract.
 *
 * Identifiers are strings, never numbers: listing IDs are mostly 7 digits but
 * some are 6, and the second identifier appears in `100P######` and `IRE#######`
 * forms. Numeric types corrupt these silently.
 */

/** One open-home window, ISO 8601 in UTC (render in the listing's own timezone). */
export interface ListingInspection {
  startsAt: string;
  endsAt: string | null;
}

/**
 * A document cleared for the website.
 *
 * Agentbox returns every file on the listing, including the agency agreement
 * (`private: true`), so only `webDisplay` documents that are not private get
 * this far. Some URLs are signed and expire; `urlExpiresAt` says when.
 */
export interface ListingDocument {
  title: string;
  type: string | null;
  url: string;
  order: number;
  urlExpiresAt: string | null;
}

export type ListingStatus =
  | 'forSale' | 'forRent' | 'underOffer' | 'sold' | 'leased' | 'withdrawn';

export interface Listing {
  listingId: string;
  uniqueId: string | null;
  slug: string;
  status: ListingStatus;
  propertyType: string;
  category: 'residential' | 'commercial' | 'rural' | 'land';
  unitNumber: string | null;
  streetNumber: string | null;
  street: string | null;
  suburb: string;
  state: string;
  postcode: string | null;
  displayAddress: string;
  latitude: number | null;
  longitude: number | null;
  /** Filters on this. Never render it. */
  priceValue: number | null;
  /** Renders this. Never filter on it. */
  priceDisplay: string;
  /** False when the vendor hides the price. */
  priceSearchable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  landSize: number | null;
  landSizeUnit: 'sqm' | 'ha' | null;
  headline: string;
  description: string;
  features: string[];
  images: { url: string; order: number; caption: string | null }[];
  floorplans: { url: string; order: number }[];
  videoUrl: string | null;
  /**
   * How the property is being sold: "Auction", "Private Treaty", "Offers to
   * Purchase", or null. Agentbox keeps a stale `auctionDate` on listings that
   * switched away from auction, so render an auction only when this says so.
   */
  saleMethod: string | null;
  auctionAt: string | null;
  auctionVenue: string | null;
  /** Upcoming and past open homes. Only the detail endpoint returns them. */
  inspections: ListingInspection[];
  documents: ListingDocument[];
  officeId: string;
  agentIds: string[];
  listedAt: string | null;
  soldAt: string | null;
  modifiedAt: string;
}

/** The fields added on 23 Nov 2026, which the committed fixtures predate. */
type LaterListingFields = 'saleMethod' | 'auctionAt' | 'auctionVenue' | 'inspections' | 'documents';

/**
 * Widens a listing that may predate the auction, open-home and document fields.
 *
 * The seed fixtures were generated before those fields existed. Defaulting them
 * here, at the loader boundary, keeps a fresh checkout working without
 * regenerating thousands of synthetic records.
 */
export function withListingDefaults(
  listing: Omit<Listing, LaterListingFields> & Partial<Pick<Listing, LaterListingFields>>,
): Listing {
  return {
    ...listing,
    saleMethod: listing.saleMethod ?? null,
    auctionAt: listing.auctionAt ?? null,
    auctionVenue: listing.auctionVenue ?? null,
    inspections: listing.inspections ?? [],
    documents: listing.documents ?? [],
  };
}

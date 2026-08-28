/**
 * The canonical Listing type. Treat as the contract.
 *
 * Identifiers are strings, never numbers: listing IDs are mostly 7 digits but
 * some are 6, and the second identifier appears in `100P######` and `IRE#######`
 * forms. Numeric types corrupt these silently.
 */

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
  officeId: string;
  agentIds: string[];
  listedAt: string | null;
  soldAt: string | null;
  modifiedAt: string;
}

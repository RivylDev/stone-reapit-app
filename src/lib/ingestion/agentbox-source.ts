/**
 * A `ListingSource` backed by the Reapit Sales (Agentbox) API.
 *
 * The request side of this is documented and solid. The *response* side runs
 * through `agentbox-mapping.ts`, whose field names are unverified guesses — see
 * the banner on that file. Until one real payload confirms them,
 * `createListingSource()` continues to return `MockSource`, so nothing in the
 * app reads through here.
 *
 * Nothing outside `src/lib/ingestion/` imports this (hard rule 3).
 */

import type { Listing } from '../types/listing.ts';
import { AgentboxClient, type AgentboxClientOptions } from './agentbox-client.ts';
import { collectUnmappedKeys, mapListing } from './agentbox-mapping.ts';
import type { ListingSource } from './source.ts';

/** Documented maximum-ish page size. 20 is the API default; 100 is the usual cap. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * `images` is required for photos to appear at all, and `relatedStaffMembers`
 * for `agentIds`. Without them a listing comes back with empty arrays rather
 * than an error, which is a quiet way to ship a site with no pictures on it.
 */
const LISTING_INCLUDES = 'images,relatedStaffMembers';

export interface AgentboxSourceOptions extends AgentboxClientOptions {
  pageSize?: number;
  /**
   * Called for each record that fails to map, instead of aborting the run. One
   * malformed listing should not stop a 5,000-record sync.
   */
  onMappingError?: (error: Error, raw: unknown) => void;
}

export class AgentboxSource implements ListingSource {
  readonly #client: AgentboxClient;
  readonly #pageSize: number;
  readonly #onMappingError: (error: Error, raw: unknown) => void;

  constructor(options: AgentboxSourceOptions) {
    this.#client = new AgentboxClient(options);
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#onMappingError =
      options.onMappingError ??
      ((error) => {
        console.warn(`[agentbox] skipped a listing: ${error.message}`);
      });
  }

  /**
   * One page per call. The cursor is the API's 1-based page number as a string,
   * matching `MockSource`'s opaque-offset contract; `nextCursor` is absent on
   * the last page.
   */
  async fetchAll(cursor?: string): Promise<{ listings: Listing[]; nextCursor?: string }> {
    const page = cursor === undefined ? 1 : Number.parseInt(cursor, 10);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`Invalid cursor: ${cursor}`);
    }

    const result = await this.#client.getPage<unknown>('/listings', 'listings', {
      page,
      limit: this.#pageSize,
      include: LISTING_INCLUDES,
      // Without a stable order, paging a live feed silently skips and repeats
      // records as listings are edited mid-sync.
      orderBy: 'firstCreated',
      order: 'ASC',
    });

    const listings = this.#mapAll(result.records);

    return result.current < result.last
      ? { listings, nextCursor: String(result.current + 1) }
      : { listings };
  }

  /**
   * Everything modified after `since`, across every page.
   *
   * `filter[modifiedAfter]` is documented as inclusive ("modified on/after"),
   * where the interface asks for strictly after. The boundary is re-checked
   * locally so a repeated sync does not keep re-fetching the same record.
   */
  async fetchSince(since: Date): Promise<Listing[]> {
    const cutoff = since.getTime();
    if (Number.isNaN(cutoff)) throw new Error('fetchSince requires a valid Date');

    const listings: Listing[] = [];

    const pages = this.#client.paginate<unknown>('/listings', 'listings', {
      limit: this.#pageSize,
      include: LISTING_INCLUDES,
      'filter[modifiedAfter]': since.toISOString(),
      orderBy: 'lastModified',
      order: 'ASC',
    });

    for await (const page of pages) {
      for (const listing of this.#mapAll(page.records)) {
        const modified = Date.parse(listing.modifiedAt);
        if (!Number.isNaN(modified) && modified > cutoff) listings.push(listing);
      }
    }

    return listings;
  }

  /** A missing listing is a 404, which is an answer rather than a failure. */
  async fetchOne(listingId: string): Promise<Listing | null> {
    let body: unknown;

    try {
      body = await this.#client.get<unknown>(`/listings/${encodeURIComponent(listingId)}`, {
        include: LISTING_INCLUDES,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    const record = unwrapSingle(body);
    return record === null ? null : mapListing(record);
  }

  /**
   * Reads one listing and reports which of its keys the mapping ignores.
   *
   * This exists to close out the unverified mapping: run it against the
   * sandbox, and whatever it lists is a field we are dropping.
   */
  async describeOne(listingId: string): Promise<{ raw: unknown; unmappedKeys: string[] }> {
    const body = await this.#client.get<unknown>(`/listings/${encodeURIComponent(listingId)}`, {
      include: LISTING_INCLUDES,
    });
    const raw = unwrapSingle(body);

    return { raw, unmappedKeys: collectUnmappedKeys(raw) };
  }

  #mapAll(records: unknown[]): Listing[] {
    const listings: Listing[] = [];

    for (const record of records) {
      try {
        listings.push(mapListing(record));
      } catch (error) {
        this.#onMappingError(error instanceof Error ? error : new Error(String(error)), record);
      }
    }

    return listings;
  }
}

/**
 * The single-listing endpoint is documented with two different envelopes in
 * two places — a bare array, and a `{ listing: {} }` object. This accepts
 * either, plus the plain object.
 */
function unwrapSingle(body: unknown): unknown {
  if (Array.isArray(body)) return body[0] ?? null;

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.listing) return record.listing;
    if (Array.isArray(record.listings)) return record.listings[0] ?? null;
    return record;
  }

  return null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

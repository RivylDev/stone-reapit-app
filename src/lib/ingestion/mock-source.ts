import type { Listing } from '../types/listing.ts';
import type { ListingSource } from './source.ts';

/**
 * A ListingSource backed by the seed JSON.
 *
 * This is the only source that exists. There are no Agentbox credentials, so
 * nothing here touches a real endpoint.
 *
 * The source is a faithful mirror of the feed, including its warts: the feed
 * contains genuine duplicate listing IDs, and `fetchAll` returns them as-is
 * rather than quietly de-duplicating. Collapsing duplicates is the loader's
 * job, via upsert — if the source hid them, the idempotency gate would pass
 * for the wrong reason.
 */
export class MockSource implements ListingSource {
  readonly #listings: readonly Listing[];
  readonly #pageSize: number;

  constructor(listings: readonly Listing[], pageSize = 200) {
    if (pageSize < 1) throw new Error('pageSize must be at least 1');
    this.#listings = listings;
    this.#pageSize = pageSize;
  }

  /**
   * Cursor is an opaque offset. Absent cursor starts at the beginning;
   * `nextCursor` is omitted on the final page.
   */
  async fetchAll(cursor?: string): Promise<{ listings: Listing[]; nextCursor?: string }> {
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Invalid cursor: ${cursor}`);
    }

    const listings = this.#listings.slice(offset, offset + this.#pageSize) as Listing[];
    const next = offset + listings.length;

    return next < this.#listings.length
      ? { listings, nextCursor: String(next) }
      : { listings };
  }

  /** Everything modified strictly after `since`, by `modifiedAt`. */
  async fetchSince(since: Date): Promise<Listing[]> {
    const cutoff = since.getTime();
    if (Number.isNaN(cutoff)) throw new Error('fetchSince requires a valid Date');

    return this.#listings.filter((listing) => {
      const modified = Date.parse(listing.modifiedAt);
      return !Number.isNaN(modified) && modified > cutoff;
    }) as Listing[];
  }

  /**
   * Where the feed carries the same ID more than once, the most recently
   * modified record wins — the same rule the loader's upsert applies.
   */
  async fetchOne(listingId: string): Promise<Listing | null> {
    let found: Listing | null = null;

    for (const listing of this.#listings) {
      if (listing.listingId !== listingId) continue;
      if (found === null || Date.parse(listing.modifiedAt) > Date.parse(found.modifiedAt)) {
        found = listing;
      }
    }

    return found;
  }
}

import type { Listing } from '../types/listing';

/**
 * The only listing-source contract consumers may depend on.
 *
 * Nothing outside `src/lib/ingestion/` may import a concrete source. Consumers
 * depend on this interface, never on `MockSource` or a future `AgentboxSource`,
 * which is what makes the eventual swap a non-event.
 */
export interface ListingSource {
  fetchAll(cursor?: string): Promise<{ listings: Listing[]; nextCursor?: string }>;
  fetchSince(since: Date): Promise<Listing[]>;
  fetchOne(listingId: string): Promise<Listing | null>;
}

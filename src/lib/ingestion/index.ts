import { MockSource } from './mock-source.ts';
import { loadSeedListings } from './seed-data.ts';
import type { ListingSource } from './source.ts';

export type { ListingSource } from './source.ts';

/**
 * The only supported way to obtain a source.
 *
 * Nothing outside this directory imports `MockSource` — callers take the
 * `ListingSource` interface and get whatever this factory hands them. Swapping
 * in an `AgentboxSource` later is a change to this one function, which is the
 * entire point of the arrangement.
 */
export function createListingSource(rootDir?: string): ListingSource {
  return new MockSource(loadSeedListings(rootDir));
}

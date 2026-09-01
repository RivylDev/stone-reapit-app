import { AgentboxSource } from './agentbox-source.ts';
import { MockSource } from './mock-source.ts';
import { loadSeedListings } from './seed-data.ts';
import type { ListingSource } from './source.ts';

export type { ListingSource } from './source.ts';

export interface CreateListingSourceOptions {
  /** Where `MockSource` reads its seed JSON from. Ignored by the Agentbox source. */
  rootDir?: string;
  /**
   * Credentials and switch for the Agentbox source. Absent, or with
   * `enabled` false, the factory returns `MockSource`.
   */
  agentbox?: {
    enabled?: boolean;
    clientId?: string;
    apiKey?: string;
    /** The client ID must decode to a sandbox instance unless this is set. */
    allowProduction?: boolean;
    /**
     * Follow each listing with a detail fetch. Only the detail endpoint carries
     * `images` and a numeric price, so this is on unless speed matters more
     * than completeness. Costs one request per listing.
     */
    hydrate?: boolean;
    /** Detail fetches in flight at once while hydrating. */
    concurrency?: number;
    /**
     * `marketingStatus` values to accept. Defaults to the on-market set —
     * most of an Agentbox instance is unpublishable appraisal records. An
     * empty array takes the instance unfiltered.
     */
    marketingStatuses?: string[];
    /** Progress callback for the hydration walk. */
    onProgress?: (done: number, total: number) => void;
  };
}

/**
 * The only supported way to obtain a source.
 *
 * Nothing outside this directory imports `MockSource` or `AgentboxSource` —
 * callers take the `ListingSource` interface and get whatever this factory
 * hands them. Swapping sources is a change to this one function, which is the
 * entire point of the arrangement.
 *
 * **It returns `MockSource` unless Agentbox is explicitly switched on.** The
 * mapping is now verified against real payloads, so this is no longer about
 * trust — it is that the fixture source needs no credentials and no network,
 * which is what keeps tests and a fresh checkout working. Opting in is a
 * deliberate act with credentials in hand.
 */
export function createListingSource(options: CreateListingSourceOptions | string = {}): ListingSource {
  // Kept callable as `createListingSource('/some/dir')`, which is how the seed
  // script and the tests use it.
  const resolved: CreateListingSourceOptions =
    typeof options === 'string' ? { rootDir: options } : options;

  const agentbox = resolved.agentbox;

  if (agentbox?.enabled) {
    if (!agentbox.clientId || !agentbox.apiKey) {
      throw new Error(
        'Agentbox source requested but AGENTBOX_CLIENT_ID / AGENTBOX_API_KEY are not set.',
      );
    }

    return new AgentboxSource({
      credentials: { clientId: agentbox.clientId, apiKey: agentbox.apiKey },
      allowProduction: agentbox.allowProduction ?? false,
      hydrate: agentbox.hydrate,
      concurrency: agentbox.concurrency,
      marketingStatuses: agentbox.marketingStatuses,
      onProgress: agentbox.onProgress,
    });
  }

  return new MockSource(loadSeedListings(resolved.rootDir));
}

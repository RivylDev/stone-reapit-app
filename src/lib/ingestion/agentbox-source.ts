/**
 * A `ListingSource` backed by the Reapit Sales (Agentbox) API.
 *
 * Verified against the sandbox instance. Three things the API's shape forces
 * on this class, none of them obvious from the reference:
 *
 * 1. **`images` is not available on `/listings`.** No `include` value adds it —
 *    `include=images` is accepted and silently ignored. Photos exist only on
 *    `/listings/{id}`. So a complete sync is a list walk followed by one detail
 *    fetch per listing (`hydrate`, on by default).
 *
 * 2. **Most records are not publishable.** Around 70% of the instance is
 *    appraisals and pre-listings carrying `marketingStatus: "Not Listed"`.
 *    They are filtered out server-side by default; `marketingStatuses` opts
 *    back in.
 *
 * 3. **Staff arrive embedded in every listing.** They are collected as they go
 *    and offered through `ReferenceDataSource`, so a sync fills the `agents`
 *    and `offices` tables without touching `/staff`.
 *
 * Nothing outside `src/lib/ingestion/` imports this (hard rule 3).
 */

import type { Listing } from '../types/listing.ts';
import { AgentboxClient, type AgentboxClientOptions } from './agentbox-client.ts';
import {
  collectUnmappedKeys,
  mapListing,
  mapOffice,
  mapOfficeRecord,
  mapStaffMembers,
  mapStaffRecord,
} from './agentbox-mapping.ts';
import { isPublishableStaff } from '../directory-policy.ts';
import type {
  DirectorySource,
  ListingSource,
  ReferenceDataSource,
  SourceAgent,
  SourceOffice,
} from './source.ts';

/** Documented maximum-ish page size. 20 is the API default; 100 is the usual cap. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * The two endpoints take different includes, and the difference is load-bearing.
 *
 * `/listings` honours `relatedStaffMembers` and `mainDescription` and silently
 * ignores `images` — no error, just no photos.
 *
 * `/listings/{id}` returns images, but only when `images` is named here.
 * Omitting it costs every photo on the site while everything else still looks
 * correct, which is exactly the kind of failure that ships.
 */
const LIST_INCLUDES = 'relatedStaffMembers,mainDescription';
const DETAIL_INCLUDES = 'images,relatedStaffMembers,mainDescription';

/** Detail fetches in flight at once during hydration. */
const DEFAULT_CONCURRENCY = 6;

/**
 * The marketing states that mean "this listing is on the market".
 *
 * Everything else on the instance — Not Listed, and the appraisal pipeline
 * behind it — is internal CRM state that has no business on a public site.
 */
const ON_MARKET_STATUSES = ['Available', 'Sold', 'Leased', 'Under Contract'];

export interface AgentboxSourceOptions extends AgentboxClientOptions {
  pageSize?: number;
  /**
   * Follow each listing with a detail fetch, which is the only way to get
   * `images` and a numeric price. Costs one request per listing. Default true;
   * turn it off for a fast structural check.
   */
  hydrate?: boolean;
  /** Detail fetches in flight at once while hydrating. Default 6. */
  concurrency?: number;
  /**
   * `marketingStatus` values to accept. Defaults to the on-market set. Pass an
   * empty array to take the instance unfiltered, appraisals and all.
   */
  marketingStatuses?: string[];
  /** Reports hydration progress, so a 900-listing walk is not a silent wait. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Called for each record that fails to map, instead of aborting the run. One
   * malformed listing should not stop a 5,000-record sync.
   */
  onMappingError?: (error: Error, raw: unknown) => void;
}

export class AgentboxSource implements ListingSource, ReferenceDataSource, DirectorySource {
  readonly #client: AgentboxClient;
  readonly #pageSize: number;
  readonly #hydrate: boolean;
  readonly #concurrency: number;
  readonly #marketingStatuses: string[];
  readonly #onProgress: (done: number, total: number) => void;
  readonly #onMappingError: (error: Error, raw: unknown) => void;

  /*
   * Reference data accumulates across every page. Maps rather than arrays: the
   * same agent fronts many listings, and the last record seen wins, which
   * matches the upsert the loader performs anyway.
   */
  readonly #offices = new Map<string, SourceOffice>();
  readonly #agents = new Map<string, SourceAgent>();

  /** Cumulative across pages, so progress does not restart on every page. */
  #hydrated = 0;

  constructor(options: AgentboxSourceOptions) {
    this.#client = new AgentboxClient(options);
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#hydrate = options.hydrate ?? true;
    this.#concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.#marketingStatuses = options.marketingStatuses ?? ON_MARKET_STATUSES;
    this.#onProgress = options.onProgress ?? (() => {});
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
   *
   * With `hydrate` on, each listing on the page is then re-read from the detail
   * endpoint, because that is the only place `images` and `searchPrice` exist.
   */
  async fetchAll(cursor?: string): Promise<{ listings: Listing[]; nextCursor?: string }> {
    const page = cursor === undefined ? 1 : Number.parseInt(cursor, 10);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`Invalid cursor: ${cursor}`);
    }

    const result = await this.#client.getPage<unknown>('/listings', 'listings', {
      page,
      limit: this.#pageSize,
      include: LIST_INCLUDES,
      ...this.#statusFilter(),
      // Without a stable order, paging a live feed silently skips and repeats
      // records as listings are edited mid-sync.
      orderBy: 'firstCreated',
      order: 'ASC',
    });

    const listings = this.#hydrate
      ? await this.#hydrateAll(result.records, result.items)
      : this.#mapAll(result.records);

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
      include: LIST_INCLUDES,
      ...this.#statusFilter(),
      'filter[modifiedAfter]': since.toISOString(),
      orderBy: 'lastModified',
      order: 'ASC',
    });

    for await (const page of pages) {
      const mapped = this.#hydrate
        ? await this.#hydrateAll(page.records, page.items)
        : this.#mapAll(page.records);

      for (const listing of mapped) {
        const modified = Date.parse(listing.modifiedAt);
        if (!Number.isNaN(modified) && modified > cutoff) listings.push(listing);
      }
    }

    return listings;
  }

  /** A missing listing is a 404, which is an answer rather than a failure. */
  async fetchOne(listingId: string): Promise<Listing | null> {
    const record = await this.#fetchDetail(listingId);
    if (record === null) return null;

    this.#collectReferenceData(record);
    return mapListing(record);
  }

  /**
   * Reads one listing and reports which of its keys the mapping ignores.
   *
   * This exists to close out the unverified mapping: run it against the
   * sandbox, and whatever it lists is a field we are dropping.
   */
  async describeOne(listingId: string): Promise<{ raw: unknown; unmappedKeys: string[] }> {
    const body = await this.#client.get<unknown>(`/listings/${encodeURIComponent(listingId)}`, {
      include: DETAIL_INCLUDES,
    });
    const raw = unwrapSingle(body);

    return { raw, unmappedKeys: collectUnmappedKeys(raw) };
  }

  /** Offices seen so far. Meaningful once the feed has been drained. */
  collectedOffices(): SourceOffice[] {
    return [...this.#offices.values()];
  }

  /** Staff seen so far, deduplicated by ID. */
  collectedAgents(): SourceAgent[] {
    return [...this.#agents.values()];
  }

  /**
   * The office directory, from `/offices`.
   *
   * Worth its own call rather than reusing `collectedOffices()`: the listing
   * payload names an office and nothing else, while this returns the street
   * address, phone, email, website and coordinates that make an office page
   * worth having.
   */
  async fetchOffices(): Promise<SourceOffice[]> {
    const offices: SourceOffice[] = [];

    for await (const page of this.#client.paginate<unknown>('/offices', 'offices', {
      limit: this.#pageSize,
    })) {
      for (const record of page.records) {
        const office = mapOfficeRecord(record);
        if (office !== null) offices.push(office);
      }
    }

    return offices;
  }

  /**
   * The staff directory, from `/staff`.
   *
   * Two passes, for a reason. The list route carries everything the directory
   * needs to decide who is public — role, status, `webDisplay` — but not the
   * biography or specialist areas, which live only on `/staff/{id}`. Fetching
   * detail for all 837 production staff to publish a fraction of them would be
   * wasteful, so only those the policy will actually publish are hydrated.
   *
   * Everyone is returned regardless. The non-public accounts still front
   * listings and their rows are what a property page joins to; it is the query
   * layer that decides who appears in the directory.
   */
  async fetchStaff(): Promise<SourceAgent[]> {
    const staff: SourceAgent[] = [];

    for await (const page of this.#client.paginate<unknown>('/staff', 'staffMembers', {
      limit: this.#pageSize,
    })) {
      for (const record of page.records) {
        const member = mapStaffRecord(record);
        if (member !== null) staff.push(member);
      }
    }

    if (!this.#hydrate) return staff;

    const publishable = staff.filter((member) => isPublishableStaff(member));
    this.#onProgress(0, publishable.length);

    // `concurrency` at a time, matching #hydrateAll rather than flooding the
    // API with one request per staff member at once.
    for (let i = 0; i < publishable.length; i += this.#concurrency) {
      const slice = publishable.slice(i, i + this.#concurrency);

      await Promise.all(slice.map(async (member) => {
        try {
          const body = await this.#client.get<Record<string, unknown>>(
            `/staff/${encodeURIComponent(member.agentId)}`,
          );
          const detail = mapStaffRecord(body?.staffMember ?? body);

          // Merge, do not replace: a null on the detail route must not blank a
          // value the list route supplied.
          if (detail !== null) {
            member.profile = detail.profile ?? member.profile;
            member.jobTitle = detail.jobTitle ?? member.jobTitle;
            if (detail.specialistAreas.length > 0) {
              member.specialistAreas = detail.specialistAreas;
            }
          }
        } catch (error) {
          // A directory that loses one biography is still a directory. Failing
          // the whole sync over it would be a worse outcome.
          this.#onMappingError(
            error instanceof Error ? error : new Error(String(error)),
            { agentId: member.agentId },
          );
        }
      }));

      this.#onProgress(Math.min(i + slice.length, publishable.length), publishable.length);
    }

    return staff;
  }

  /** Empty when the caller has asked for the instance unfiltered. */
  #statusFilter(): Record<string, string> {
    return this.#marketingStatuses.length === 0
      ? {}
      : { 'filter[marketingStatus]': this.#marketingStatuses.join(',') };
  }

  /**
   * Re-reads each listing from the detail endpoint, `concurrency` at a time.
   *
   * A listing whose detail fetch fails falls back to its thin list record
   * rather than vanishing. Losing the photos on one listing is a smaller
   * failure than dropping the listing from the site.
   */
  async #hydrateAll(records: unknown[], total: number): Promise<Listing[]> {
    const listings: Listing[] = [];

    for (let i = 0; i < records.length; i += this.#concurrency) {
      const slice = records.slice(i, i + this.#concurrency);

      const settled = await Promise.all(slice.map(async (record) => {
        const id = readListingId(record);
        if (id === null) return record;

        try {
          return (await this.#fetchDetail(id)) ?? record;
        } catch {
          return record;
        }
      }));

      for (const record of settled) {
        this.#collectReferenceData(record);

        try {
          listings.push(mapListing(record));
        } catch (error) {
          this.#onMappingError(error instanceof Error ? error : new Error(String(error)), record);
        }
      }

      this.#hydrated += slice.length;
      this.#onProgress(this.#hydrated, total);
    }

    return listings;
  }

  async #fetchDetail(listingId: string): Promise<unknown> {
    try {
      const body = await this.#client.get<unknown>(
        `/listings/${encodeURIComponent(listingId)}`,
        { include: DETAIL_INCLUDES },
      );
      return unwrapSingle(body);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  #collectReferenceData(record: unknown): void {
    const office = mapOffice(record);
    if (office !== null) this.#offices.set(office.officeId, office);

    for (const agent of mapStaffMembers(record)) {
      this.#agents.set(agent.agentId, agent);
    }
  }

  #mapAll(records: unknown[]): Listing[] {
    const listings: Listing[] = [];

    for (const record of records) {
      this.#collectReferenceData(record);

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

/** The listing ID off a raw list record, for the detail fetch that follows. */
function readListingId(record: unknown): string | null {
  if (record === null || typeof record !== 'object') return null;

  const id = (record as { id?: unknown }).id;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

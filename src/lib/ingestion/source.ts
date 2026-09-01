import type { Listing } from '../types/listing.ts';

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

/** An `offices` row, as a source can supply it. */
export interface SourceOffice {
  officeId: string;
  name: string;
  /** Null when the office came from a listing payload, which carries no slug. */
  slug: string | null;
  streetAddress: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
}

/**
 * An `agents` row, as a source can supply it.
 *
 * Note what is absent. `/staff/{id}` also returns `dateOfBirth` and
 * `homeAddress`; they are employee personal data and are dropped at the mapping
 * boundary, so they cannot reach this type, the database, or a page. There is
 * no `photo` field on the Agentbox staff endpoints at all — `photoUrl` exists
 * for the fixture source and stays null against a real feed.
 */
export interface SourceAgent {
  agentId: string;
  slug: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officeId: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  jobTitle: string | null;
  /** CRM role: Admin, Sales Representative, Principal, Property Management. */
  role: string | null;
  status: string | null;
  /** Biography. Present on `/staff/{id}` only, and empty across the sandbox. */
  profile: string | null;
  specialistAreas: string[];
  /** Agentbox's publication flags, e.g. `['Our Staff', 'My Listings']`. */
  webDisplay: string[];
}

/**
 * Optional companion to `ListingSource`, for feeds that carry their own
 * reference data.
 *
 * Agentbox embeds the whole staff record inside each listing, so a sync gets
 * the agent and office directories for free. The fixture source reads its
 * equivalents from separate files instead. Rather than force one shape on both,
 * a consumer asks whether the source it was handed happens to supply them.
 *
 * Both methods report what has been seen *so far* — they are only meaningful
 * once the feed has been drained.
 */
export interface ReferenceDataSource {
  collectedOffices(): SourceOffice[];
  collectedAgents(): SourceAgent[];
}

/** Narrows a source to one that carries reference data. */
export function hasReferenceData(
  source: ListingSource,
): source is ListingSource & ReferenceDataSource {
  return (
    typeof (source as Partial<ReferenceDataSource>).collectedOffices === 'function'
    && typeof (source as Partial<ReferenceDataSource>).collectedAgents === 'function'
  );
}

/**
 * A source that can fetch the directory in its own right.
 *
 * `ReferenceDataSource` reports what fell out of the listing feed, which for
 * Agentbox is an office's name and nothing else, and only those staff who
 * happen to front a listing. The dedicated endpoints return far more — a full
 * office address, phone, email and coordinates; a staff member's role, job
 * title and biography — and return people the listing feed never mentions
 * (108 staff against the 59 the feed yields).
 *
 * Separate from `ReferenceDataSource` because these cost network calls, where
 * the collected variety is free. A caller should prefer these and fall back.
 */
export interface DirectorySource {
  fetchOffices(): Promise<SourceOffice[]>;
  fetchStaff(): Promise<SourceAgent[]>;
}

/** Narrows a source to one that can fetch the directory. */
export function hasDirectory(
  source: ListingSource,
): source is ListingSource & DirectorySource {
  return (
    typeof (source as Partial<DirectorySource>).fetchOffices === 'function'
    && typeof (source as Partial<DirectorySource>).fetchStaff === 'function'
  );
}

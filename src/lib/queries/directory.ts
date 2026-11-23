import { NON_PUBLIC_ROLES, PUBLIC_STAFF_SECTION } from '../directory-policy.ts';
import { PUBLIC_STATUSES } from './sections.ts';

/**
 * The office and agent directory.
 *
 * Sits beside `search()` in listings.ts and follows the same rules: reads D1,
 * never a source, and excludes soft-deleted rows.
 *
 * The one thing to understand before changing anything here is the
 * publishability filter. The sandbox holds 119 agent rows of which 102 are
 * `role: Admin`, most of them integration and test accounts, and 47 of those
 * front a live listing. So every query that feeds a public page filters on the
 * policy in `src/lib/directory-policy.ts` — never on "has listings", which
 * would publish "Atomix Sandbox" and "Birdeye Test".
 */

export interface OfficeSummary {
  officeId: string;
  slug: string;
  name: string;
  streetAddress: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Live listings at this office, across every public section. */
  listingCount: number;
  /** Publishable agents at this office. */
  agentCount: number;
}

export interface AgentSummary {
  agentId: string;
  slug: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  officeId: string | null;
  officeName: string | null;
  officeSlug: string | null;
  listingCount: number;
}

export interface AgentDetail extends AgentSummary {
  profile: string | null;
  specialistAreas: string[];
}

/**
 * SQL for the publishability rule, mirroring `isPublishableStaff`.
 *
 * The values come from the policy module rather than being retyped, so the two
 * expressions cannot drift on the thing that matters — which roles are private,
 * and which flag overrides that.
 */
function publishable(alias = 'a'): { sql: string; values: string[] } {
  const placeholders = NON_PUBLIC_ROLES.map(() => '?').join(', ');
  return {
    sql:
      `${alias}.deleted_at IS NULL `
      + `AND (${alias}.status IS NULL OR LOWER(${alias}.status) = 'active') `
      + `AND ((${alias}.role IS NOT NULL AND ${alias}.role NOT IN (${placeholders})) `
      + `     OR ${alias}.web_display LIKE ?)`,
    // web_display is a JSON array of names; matching the quoted name avoids a
    // substring hit on a longer section name that merely contains this one.
    values: [...NON_PUBLIC_ROLES, `%"${PUBLIC_STAFF_SECTION}"%`],
  };
}

/** Live listings only: the same public status set the sections are built from. */
const PUBLIC_STATUS_SQL = PUBLIC_STATUSES.map(() => '?').join(', ');

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const OFFICE_COLUMNS =
  'o.office_id, o.slug, o.name, o.street_address, o.suburb, o.state, o.postcode, '
  + 'o.phone, o.email, o.website, o.latitude, o.longitude';

function toOffice(row: any, listingCount = 0, agentCount = 0): OfficeSummary {
  return {
    officeId: String(row.office_id),
    // A row synced before the directory migration has no slug; fall back to the
    // ID so the page is still addressable rather than 404ing.
    slug: (row.slug as string | null) ?? String(row.office_id),
    name: row.name as string,
    streetAddress: row.street_address ?? null,
    suburb: row.suburb ?? null,
    state: row.state ?? null,
    postcode: row.postcode ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    listingCount: Number(row.listing_count ?? listingCount),
    agentCount: Number(row.agent_count ?? agentCount),
  };
}

const AGENT_COLUMNS =
  'a.agent_id, a.slug, a.full_name, a.first_name, a.last_name, a.job_title, '
  + 'a.role, a.phone, a.email, a.photo_url, a.office_id, '
  + 'o.name AS office_name, o.slug AS office_slug';

function toAgent(row: any): AgentSummary {
  return {
    agentId: String(row.agent_id),
    slug: (row.slug as string | null) ?? String(row.agent_id),
    fullName: (row.full_name as string | null) ?? 'Stone',
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    jobTitle: row.job_title ?? null,
    role: row.role ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    photoUrl: row.photo_url ?? null,
    officeId: row.office_id ?? null,
    officeName: row.office_name ?? null,
    officeSlug: row.office_slug ?? null,
    listingCount: Number(row.listing_count ?? 0),
  };
}

/**
 * Counts live listings per office and publishable agents per office.
 *
 * A correlated subquery per office would be fine at 76 offices, but two grouped
 * queries keep it to three statements regardless of how many offices exist.
 */
export async function listOffices(db: D1Database): Promise<OfficeSummary[]> {
  const pub = publishable();

  const [officeResult, listingResult, agentResult] = await db.batch<any>([
    db.prepare(
      `SELECT ${OFFICE_COLUMNS} FROM offices o `
      + 'WHERE o.deleted_at IS NULL ORDER BY o.name COLLATE NOCASE ASC',
    ),
    db.prepare(
      'SELECT office_id, COUNT(*) AS n FROM listings '
      + `WHERE deleted_at IS NULL AND status IN (${PUBLIC_STATUS_SQL}) `
      + 'GROUP BY office_id',
    ).bind(...PUBLIC_STATUSES),
    db.prepare(
      `SELECT a.office_id, COUNT(*) AS n FROM agents a WHERE ${pub.sql} GROUP BY a.office_id`,
    ).bind(...pub.values),
  ]);

  const listingCounts = new Map<string, number>();
  for (const row of listingResult.results ?? []) {
    listingCounts.set(String(row.office_id), Number(row.n));
  }

  const agentCounts = new Map<string, number>();
  for (const row of agentResult.results ?? []) {
    agentCounts.set(String(row.office_id), Number(row.n));
  }

  return (officeResult.results ?? []).map((row: any) =>
    toOffice(
      row,
      listingCounts.get(String(row.office_id)) ?? 0,
      agentCounts.get(String(row.office_id)) ?? 0,
    ));
}

export interface OfficeDetail extends OfficeSummary {
  agents: AgentSummary[];
}

/** One office, with the agents who may be published from it. */
export async function findOfficeBySlug(
  db: D1Database,
  slug: string,
): Promise<OfficeDetail | null> {
  const row = await db
    .prepare(
      `SELECT ${OFFICE_COLUMNS} FROM offices o `
      + 'WHERE (o.slug = ? OR o.office_id = ?) AND o.deleted_at IS NULL',
    )
    .bind(slug, slug)
    .first<any>();

  if (!row) return null;

  const officeId = String(row.office_id);
  const pub = publishable();

  const [listingResult, agentResult] = await db.batch<any>([
    db.prepare(
      'SELECT COUNT(*) AS n FROM listings WHERE office_id = ? AND deleted_at IS NULL '
      + `AND status IN (${PUBLIC_STATUS_SQL})`,
    ).bind(officeId, ...PUBLIC_STATUSES),
    db.prepare(
      `SELECT ${AGENT_COLUMNS}, `
      + '(SELECT COUNT(*) FROM listing_agents la JOIN listings l '
      + '   ON l.listing_id = la.listing_id AND l.deleted_at IS NULL '
      + `   WHERE la.agent_id = a.agent_id AND l.status IN (${PUBLIC_STATUS_SQL})) AS listing_count `
      + 'FROM agents a LEFT JOIN offices o ON o.office_id = a.office_id '
      + `WHERE a.office_id = ? AND ${pub.sql} `
      + 'ORDER BY a.full_name COLLATE NOCASE ASC',
    ).bind(...PUBLIC_STATUSES, officeId, ...pub.values),
  ]);

  const listingCount = Number((listingResult.results ?? [])[0]?.n ?? 0);
  const agents = (agentResult.results ?? []).map(toAgent);

  return {
    ...toOffice(row, listingCount, agents.length),
    listingCount,
    agentCount: agents.length,
    agents,
  };
}

/** Every agent who may be published, with their live listing count. */
export async function listAgents(db: D1Database): Promise<AgentSummary[]> {
  const pub = publishable();

  const { results } = await db
    .prepare(
      `SELECT ${AGENT_COLUMNS}, `
      + '(SELECT COUNT(*) FROM listing_agents la JOIN listings l '
      + '   ON l.listing_id = la.listing_id AND l.deleted_at IS NULL '
      + `   WHERE la.agent_id = a.agent_id AND l.status IN (${PUBLIC_STATUS_SQL})) AS listing_count `
      + 'FROM agents a LEFT JOIN offices o ON o.office_id = a.office_id '
      + `WHERE ${pub.sql} `
      + 'ORDER BY a.full_name COLLATE NOCASE ASC',
    )
    .bind(...PUBLIC_STATUSES, ...pub.values)
    .all<any>();

  return (results ?? []).map(toAgent);
}

/**
 * One agent by slug.
 *
 * Returns null for an agent who may not be published, so a back-office account
 * has no reachable page even if someone guesses the URL — the filter is in the
 * query, not in the template.
 */
export async function findAgentBySlug(
  db: D1Database,
  slug: string,
): Promise<AgentDetail | null> {
  const pub = publishable();

  const row = await db
    .prepare(
      `SELECT ${AGENT_COLUMNS}, a.profile, a.specialist_areas, `
      + '(SELECT COUNT(*) FROM listing_agents la JOIN listings l '
      + '   ON l.listing_id = la.listing_id AND l.deleted_at IS NULL '
      + `   WHERE la.agent_id = a.agent_id AND l.status IN (${PUBLIC_STATUS_SQL})) AS listing_count `
      + 'FROM agents a LEFT JOIN offices o ON o.office_id = a.office_id '
      + `WHERE (a.slug = ? OR a.agent_id = ?) AND ${pub.sql}`,
    )
    .bind(...PUBLIC_STATUSES, slug, slug, ...pub.values)
    .first<any>();

  if (!row) return null;

  return {
    ...toAgent(row),
    profile: row.profile ?? null,
    specialistAreas: parseJsonArray(row.specialist_areas ?? null),
  };
}

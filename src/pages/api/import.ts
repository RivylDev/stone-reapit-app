import { env } from 'cloudflare:workers';

import type { APIRoute } from 'astro';
import { withListingDefaults, type Listing } from '../../lib/types/listing.ts';
import type { SourceAgent, SourceOffice } from '../../lib/ingestion/source.ts';

/**
 * Loads real records into a deployed environment's D1, pushed from a machine
 * that can reach Agentbox.
 *
 * Why this exists: Webflow Cloud's D1 is reachable only from inside the Worker,
 * and the Agentbox key is IP-locked, so the Worker cannot fetch the feed itself.
 * The machine on an allowlisted IP fetches and maps (the same `AgentboxSource`
 * a sync uses) and posts the mapped records here. Added 23 Nov 2026 so the
 * staging demo could show real listings (Eugene: "replace it with the current
 * data"). The same shape suits the fixed-IP relay later.
 *
 * Protected exactly like /api/seed: SEED_TOKEN, fails closed, POST only.
 *
 *   POST /<mount>/api/import   header x-seed-token
 *   { "kind": "offices" | "agents" | "listings", "records": [...] }
 *   { "kind": "retire-fixtures" }
 *
 * Upserts only, and every upsert clears `deleted_at`. "retire-fixtures"
 * soft-deletes the synthetic seed rows by their exact IDs (hard rule 5: nothing
 * is ever deleted from listings), so real and fake data never mix on a page.
 */

export const prerender = false;

/** D1 caps bound parameters per statement at 100. */
const ID_CHUNK = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Length-independent comparison, so a wrong token leaks nothing by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function upsertSql(table: string, columns: string[], conflictKeys: string[]): string {
  const updates = columns
    .filter((c) => !conflictKeys.includes(c))
    .map((c) => `${c}=excluded.${c}`)
    .join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) `
    + `VALUES (${columns.map(() => '?').join(', ')}) `
    + `ON CONFLICT(${conflictKeys.join(', ')}) DO UPDATE SET ${updates}`;
}

const OFFICE_COLUMNS = [
  'office_id', 'name', 'slug', 'street_address', 'suburb', 'state', 'postcode',
  'country', 'phone', 'email', 'website', 'latitude', 'longitude', 'status',
  'raw_payload', 'last_seen_at', 'deleted_at',
];

const AGENT_COLUMNS = [
  'agent_id', 'slug', 'first_name', 'last_name', 'full_name', 'office_id',
  'phone', 'email', 'photo_url', 'job_title', 'role', 'status', 'profile',
  'specialist_areas', 'web_display', 'raw_payload', 'last_seen_at', 'deleted_at',
];

const LISTING_COLUMNS = [
  'listing_id', 'unique_id', 'slug', 'status', 'property_type', 'category',
  'unit_number', 'street_number', 'street', 'suburb', 'state', 'postcode',
  'display_address', 'latitude', 'longitude', 'price_value', 'price_display',
  'price_searchable', 'bedrooms', 'bathrooms', 'carspaces', 'land_size',
  'land_size_unit', 'headline', 'description', 'features', 'floorplans',
  'video_url', 'sale_method', 'auction_at', 'auction_venue', 'inspections',
  'documents', 'links', 'available_from', 'bond', 'project_id', 'project_name',
  'auction_venue_details', 'sold_price_confidential', 'office_id',
  'listed_at', 'sold_at', 'modified_at', 'raw_payload', 'last_seen_at', 'deleted_at',
];

function listingStatements(db: D1Database, l: Listing, seenAt: string): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [
    db.prepare(upsertSql('listings', LISTING_COLUMNS, ['listing_id'])).bind(
      l.listingId, l.uniqueId, l.slug, l.status, l.propertyType, l.category,
      l.unitNumber, l.streetNumber, l.street, l.suburb, l.state, l.postcode,
      l.displayAddress, l.latitude, l.longitude, l.priceValue, l.priceDisplay,
      l.priceSearchable ? 1 : 0, l.bedrooms, l.bathrooms, l.carspaces,
      l.landSize, l.landSizeUnit, l.headline, l.description,
      JSON.stringify(l.features), JSON.stringify(l.floorplans),
      l.videoUrl, l.saleMethod, l.auctionAt, l.auctionVenue,
      JSON.stringify(l.inspections), JSON.stringify(l.documents),
      JSON.stringify(l.links), l.availableFrom, l.bond, l.projectId, l.projectName,
      l.auctionVenueDetails === null ? null : JSON.stringify(l.auctionVenueDetails),
      l.soldPriceConfidential ? 1 : 0,
      l.officeId, l.listedAt, l.soldAt, l.modifiedAt,
      JSON.stringify(l), seenAt, null,
    ),
    // Child rows are replaced, not merged (child tables only; never listings).
    db.prepare('DELETE FROM listing_images WHERE listing_id = ?').bind(l.listingId),
    db.prepare('DELETE FROM listing_agents WHERE listing_id = ?').bind(l.listingId),
  ];
  const imageSql = upsertSql('listing_images', ['listing_id', 'position', 'url', 'caption'], ['listing_id', 'position']);
  for (const image of l.images) out.push(db.prepare(imageSql).bind(l.listingId, image.order, image.url, image.caption));
  const linkSql = upsertSql('listing_agents', ['listing_id', 'agent_id', 'position'], ['listing_id', 'agent_id']);
  l.agentIds.forEach((agentId, position) => out.push(db.prepare(linkSql).bind(l.listingId, agentId, position)));
  return out;
}

async function retireFixtures(db: D1Database, retiredAt: string): Promise<Record<string, number>> {
  const ids = async (file: Promise<{ default: unknown }>, key: string): Promise<string[]> => {
    const records = ((await file).default as { records: Record<string, unknown>[] }).records;
    return records.map((r) => String(r[key]));
  };
  const sets: [string, string, string[]][] = [
    ['listings', 'listing_id', await ids(import('../../../seed-listings.dev.json'), 'listingId')],
    ['agents', 'agent_id', await ids(import('../../../seed-agents.dev.json'), 'agentId')],
    ['offices', 'office_id', await ids(import('../../../seed-offices.dev.json'), 'officeId')],
  ];
  const counts: Record<string, number> = {};
  for (const [table, key, list] of sets) {
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < list.length; i += ID_CHUNK) {
      const slice = list.slice(i, i + ID_CHUNK);
      statements.push(db.prepare(
        `UPDATE ${table} SET deleted_at = ? WHERE deleted_at IS NULL AND ${key} IN (${slice.map(() => '?').join(', ')})`,
      ).bind(retiredAt, ...slice));
    }
    const results = await db.batch(statements);
    counts[table] = results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  }
  return counts;
}

export const POST: APIRoute = async ({ request }) => {
  const expected = env.SEED_TOKEN;
  if (!expected) return json({ error: 'SEED_TOKEN is not configured for this environment.' }, 503);
  const provided = request.headers.get('x-seed-token') ?? '';
  if (!tokensMatch(provided, expected)) return json({ error: 'Bad or missing token.' }, 401);

  const db = env.DB;
  if (!db) return json({ error: 'No D1 binding named DB on this environment.' }, 500);

  let body: { kind?: string; records?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const seenAt = new Date().toISOString();
  const records = Array.isArray(body.records) ? body.records : [];

  switch (body.kind) {
    case 'retire-fixtures':
      return json({ kind: body.kind, retired: await retireFixtures(db, seenAt) });

    case 'offices': {
      const sql = upsertSql('offices', OFFICE_COLUMNS, ['office_id']);
      await db.batch((records as SourceOffice[]).map((o) => db.prepare(sql).bind(
        o.officeId, o.name, o.slug, o.streetAddress, o.suburb, o.state, o.postcode,
        o.country, o.phone, o.email, o.website, o.latitude, o.longitude, o.status,
        JSON.stringify(o), seenAt, null,
      )));
      return json({ kind: body.kind, upserted: records.length });
    }

    case 'agents': {
      const sql = upsertSql('agents', AGENT_COLUMNS, ['agent_id']);
      await db.batch((records as SourceAgent[]).map((a) => db.prepare(sql).bind(
        a.agentId, a.slug, a.firstName, a.lastName, a.fullName, a.officeId,
        a.phone, a.email, a.photoUrl, a.jobTitle, a.role, a.status, a.profile,
        JSON.stringify(a.specialistAreas), JSON.stringify(a.webDisplay),
        JSON.stringify(a), seenAt, null,
      )));
      return json({ kind: body.kind, upserted: records.length });
    }

    case 'listings': {
      const listings = (records as Parameters<typeof withListingDefaults>[0][]).map(withListingDefaults);
      const bad = listings.find((l) => typeof l.listingId !== 'string' || typeof l.slug !== 'string');
      if (bad) return json({ error: 'Every listing needs a string listingId and slug.' }, 400);
      await db.batch(listings.flatMap((l) => listingStatements(db, l, seenAt)));
      return json({ kind: body.kind, upserted: listings.length });
    }

    default:
      return json({ error: 'kind must be offices, agents, listings or retire-fixtures.' }, 400);
  }
};

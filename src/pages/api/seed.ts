import { env } from 'cloudflare:workers';

import type { APIRoute } from 'astro';
import type { Listing } from '../../lib/types/listing.ts';
import type { SeedOffice, SeedAgent } from '../../lib/ingestion/seed-data.ts';

/**
 * One-time seed endpoint.
 *
 * The migration creates the tables; it does not fill them. Locally that is what
 * `npm run db:seed` is for, but that script drives the wrangler CLI and needs
 * Cloudflare account access. On Webflow Cloud the database is provisioned for
 * us and there is no such access, so the load has to happen from inside the
 * Worker, through the binding it already holds.
 *
 * Protected, and fails closed: with no SEED_TOKEN configured it refuses to run
 * at all rather than defaulting to open. POST only, so nothing reaches it by
 * being crawled or prefetched.
 *
 *   POST /<mount>/api/seed?token=...&from=0
 *
 * Writes are the same upserts the offline loader uses, so re-running is safe
 * and interrupting it half-way is recoverable — call again with the `nextFrom`
 * value it returns.
 */

export const prerender = false;

/** Listings per D1 batch. Each one also carries its images and agent links. */
const CHUNK = 25;

/**
 * Stop and report progress rather than risk the platform's execution limit.
 * The caller resumes from `nextFrom`.
 */
const TIME_BUDGET_MS = 15_000;

const LISTING_COLUMNS = [
  'listing_id', 'unique_id', 'slug', 'status', 'property_type', 'category',
  'unit_number', 'street_number', 'street', 'suburb', 'state', 'postcode',
  'display_address', 'latitude', 'longitude', 'price_value', 'price_display',
  'price_searchable', 'bedrooms', 'bathrooms', 'carspaces', 'land_size',
  'land_size_unit', 'headline', 'description', 'features', 'floorplans',
  'video_url', 'office_id', 'listed_at', 'sold_at', 'modified_at',
  'raw_payload', 'last_seen_at', 'deleted_at',
];

function upsertSql(table: string, columns: string[], conflictKeys: string[]): string {
  const updates = columns
    .filter((c) => !conflictKeys.includes(c))
    .map((c) => `${c}=excluded.${c}`)
    .join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) `
    + `VALUES (${columns.map(() => '?').join(', ')}) `
    + `ON CONFLICT(${conflictKeys.join(', ')}) DO UPDATE SET ${updates}`;
}

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

export const POST: APIRoute = async ({ request }) => {
  const startedAt = Date.now();

  const expected = env.SEED_TOKEN;
  if (!expected) {
    return json({
      error: 'SEED_TOKEN is not configured for this environment.',
      fix: 'Add SEED_TOKEN as a Secret variable in Webflow Cloud, redeploy, then retry.',
    }, 503);
  }

  const url = new URL(request.url);
  const provided = request.headers.get('x-seed-token') ?? url.searchParams.get('token') ?? '';
  if (!tokensMatch(provided, expected)) {
    return json({ error: 'Bad or missing token.' }, 401);
  }

  const db = env.DB;
  if (!db) return json({ error: 'No D1 binding named DB on this environment.' }, 500);

  const from = Math.max(0, Number.parseInt(url.searchParams.get('from') ?? '0', 10) || 0);

  /*
   * Imported inside the handler so the fixture JSON is code-split into this
   * route's chunk. Every other route stays free of ~2MB of listing data.
   */
  const listingsFile = await import('../../../seed-listings.dev.json');
  const officesFile = await import('../../../seed-offices.dev.json');
  const agentsFile = await import('../../../seed-agents.dev.json');

  const feed = (listingsFile.default as { records: Listing[] }).records;
  const offices = (officesFile.default as { records: SeedOffice[] }).records;
  const agents = (agentsFile.default as { records: SeedAgent[] }).records;

  // Collapse duplicate IDs newest-wins, exactly as the offline loader does.
  const ordered = [...feed].sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
  const byId = new Map<string, Listing>();
  for (const listing of ordered) byId.set(listing.listingId, listing);
  const listings = [...byId.values()];

  const seenAt = new Date().toISOString();
  let wrote = 0;

  // Reference data first, and only on the opening call.
  if (from === 0) {
    const officeCols = ['office_id', 'name', 'suburb', 'state', 'postcode', 'phone', 'email', 'raw_payload', 'last_seen_at'];
    const officeSql = upsertSql('offices', officeCols, ['office_id']);
    await db.batch(offices.map((o) => db.prepare(officeSql).bind(
      o.officeId, o.name, o.suburb, o.state, o.postcode, o.phone, o.email,
      JSON.stringify(o), seenAt,
    )));

    const agentCols = ['agent_id', 'first_name', 'last_name', 'full_name', 'office_id', 'phone', 'email', 'photo_url', 'raw_payload', 'last_seen_at'];
    const agentSql = upsertSql('agents', agentCols, ['agent_id']);
    for (let i = 0; i < agents.length; i += 200) {
      await db.batch(agents.slice(i, i + 200).map((a) => db.prepare(agentSql).bind(
        a.agentId, a.firstName, a.lastName, a.fullName, a.officeId, a.phone,
        a.email, a.photoUrl, JSON.stringify(a), seenAt,
      )));
    }
    wrote += offices.length + agents.length;
  }

  const listingSql = upsertSql('listings', LISTING_COLUMNS, ['listing_id']);
  const imageSql = upsertSql('listing_images', ['listing_id', 'position', 'url', 'caption'], ['listing_id', 'position']);
  const agentLinkSql = upsertSql('listing_agents', ['listing_id', 'agent_id', 'position'], ['listing_id', 'agent_id']);

  let cursor = from;
  while (cursor < listings.length) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const slice = listings.slice(cursor, cursor + CHUNK);
    const statements: D1PreparedStatement[] = [];

    for (const l of slice) {
      statements.push(db.prepare(listingSql).bind(
        l.listingId, l.uniqueId, l.slug, l.status, l.propertyType, l.category,
        l.unitNumber, l.streetNumber, l.street, l.suburb, l.state, l.postcode,
        l.displayAddress, l.latitude, l.longitude, l.priceValue, l.priceDisplay,
        l.priceSearchable ? 1 : 0, l.bedrooms, l.bathrooms, l.carspaces,
        l.landSize, l.landSizeUnit, l.headline, l.description,
        JSON.stringify(l.features), JSON.stringify(l.floorplans),
        l.videoUrl, l.officeId, l.listedAt, l.soldAt, l.modifiedAt,
        JSON.stringify(l), seenAt, null,
      ));

      // Child rows are replaced, not merged, so a shrinking image set cannot
      // leave orphans behind and drift the counts on a re-run.
      statements.push(db.prepare('DELETE FROM listing_images WHERE listing_id = ?').bind(l.listingId));
      statements.push(db.prepare('DELETE FROM listing_agents WHERE listing_id = ?').bind(l.listingId));

      for (const image of l.images) {
        statements.push(db.prepare(imageSql).bind(l.listingId, image.order, image.url, image.caption));
      }
      l.agentIds.forEach((agentId, position) => {
        statements.push(db.prepare(agentLinkSql).bind(l.listingId, agentId, position));
      });
    }

    await db.batch(statements);
    wrote += statements.length;
    cursor += slice.length;
  }

  const done = cursor >= listings.length;

  if (done) {
    await db.prepare(
      'INSERT INTO sync_runs (run_id, source, started_at, finished_at, status, records_seen, records_upserted) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING',
    ).bind(
      `seed-${seenAt}`, 'MockSource (seed endpoint)', seenAt,
      new Date().toISOString(), 'success', feed.length, listings.length,
    ).run();
  }

  const total = await db.prepare('SELECT COUNT(*) AS n FROM listings').first<{ n: number }>();

  return json({
    done,
    seededThisCall: cursor - from,
    statementsWritten: wrote,
    listingsInDatabase: total?.n ?? 0,
    totalListings: listings.length,
    nextFrom: done ? null : cursor,
    note: done
      ? 'Seeding complete. This endpoint is idempotent — re-running changes nothing.'
      : `Stopped at the time budget. POST again with ?from=${cursor} to continue.`,
    elapsedMs: Date.now() - startedAt,
  });
};

/** A GET here is almost always someone expecting this to be clickable. */
export const GET: APIRoute = () =>
  json({
    error: 'Use POST.',
    why: 'This endpoint writes to the database, so it does not respond to GET.',
    usage: 'POST /api/seed?token=YOUR_SEED_TOKEN',
  }, 405);

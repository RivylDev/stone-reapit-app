/**
 * Pushes real Agentbox data into a deployed environment through /api/import.
 *
 *   node --experimental-strip-types scripts/import-remote.ts \
 *     --base https://stone-6adb3b.webflow.io/staging --allow-production \
 *     [--available N] [--sold 300] [--leased 150] [--retire-fixtures] [--dry-run]
 *
 * Run from a machine on Agentbox's IP allowlist (the key is IP-locked). Reads
 * the Agentbox credentials and SEED_TOKEN from the environment or `.dev.vars`;
 * nothing here prints a credential.
 *
 * Loads: the office and staff directory, every Available and Under Contract
 * listing, and the newest --sold sold and --leased leased listings, each
 * hydrated through AgentboxSource exactly as a sync would. Read-only against
 * Agentbox. Added 23 Nov 2026 for the staging demo on real data.
 */

import { AgentboxClient } from '../src/lib/ingestion/agentbox-client.ts';
import { AgentboxSource } from '../src/lib/ingestion/agentbox-source.ts';
import type { Listing } from '../src/lib/types/listing.ts';
import { readDevVars, requireAgentboxCredentials } from './agentbox-credentials.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const base = (arg('base') ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('--base is required, e.g. https://stone-6adb3b.webflow.io/staging');
const soldCount = Number.parseInt(arg('sold') ?? '300', 10);
const leasedCount = Number.parseInt(arg('leased') ?? '150', 10);
/** Cap on Available listings; for a quick test. Default: all of them. */
const availableCount = Number.parseInt(arg('available') ?? '10000', 10);
const dryRun = flag('dry-run');

const token = process.env.SEED_TOKEN ?? readDevVars().SEED_TOKEN;
if (!dryRun && !token) throw new Error('SEED_TOKEN missing: add it to .dev.vars (never commit it).');

const credentials = requireAgentboxCredentials();
const options = {
  credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
  allowProduction: credentials.allowProduction,
};
const client = new AgentboxClient(options);
const source = new AgentboxSource({
  ...options,
  onProgress: (done, total) => process.stdout.write(`\r  staff ${done}/${total}   `),
});

async function post(kind: string, records?: unknown[]): Promise<unknown> {
  if (dryRun) return { dryRun: true, kind, count: records?.length };
  const response = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-seed-token': token as string },
    body: JSON.stringify({ kind, records }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${kind}: ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function idsFor(query: Record<string, string>, max: number): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ids.length < max; page++) {
    const p = await client.getPage<{ id: string }>('/listings', 'listings', { ...query, limit: 100, page });
    ids.push(...p.records.map((r) => r.id));
    if (p.current >= p.last) break;
  }
  return ids.slice(0, max);
}

// 1. Directory.
const offices = await source.fetchOffices();
console.log(`offices: ${offices.length}`, await post('offices', offices));
const staff = await source.fetchStaff();
process.stdout.write('\n');
for (let i = 0; i < staff.length; i += 200) await post('agents', staff.slice(i, i + 200));
console.log(`agents: ${staff.length} sent`);

// 2. Which listings.
const ids = [
  ...await idsFor({ 'filter[marketingStatus]': 'Available', orderBy: 'listedDate', order: 'DESC' }, availableCount),
  ...await idsFor({ 'filter[marketingStatus]': 'Under Contract', orderBy: 'listedDate', order: 'DESC' }, 1_000),
  ...await idsFor({ 'filter[marketingStatus]': 'Sold', orderBy: 'soldDate', order: 'DESC' }, soldCount),
  ...await idsFor({ 'filter[marketingStatus]': 'Leased', orderBy: 'leasedDate', order: 'DESC' }, leasedCount),
];
const unique = [...new Set(ids)];
console.log(`listings to load: ${unique.length}`);

// 3. Hydrate five at a time (Reapit's concurrency limit) and post in batches.
let batch: Listing[] = [];
let sent = 0;
let failed = 0;
for (let i = 0; i < unique.length; i += 5) {
  const got = await Promise.all(unique.slice(i, i + 5).map((id) => source.fetchOne(id).catch(() => null)));
  for (const listing of got) {
    if (listing) batch.push(listing); else failed++;
  }
  if (batch.length >= 20 || i + 5 >= unique.length) {
    if (batch.length) await post('listings', batch);
    sent += batch.length;
    batch = [];
    process.stdout.write(`\r  listings ${sent}/${unique.length} (failed ${failed})   `);
  }
}
process.stdout.write('\n');

// 4. Hide the synthetic seed rows, last, so the site is never empty mid-load.
if (flag('retire-fixtures')) console.log('retire-fixtures', await post('retire-fixtures'));
console.log('done');

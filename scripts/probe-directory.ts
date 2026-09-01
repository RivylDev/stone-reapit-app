/**
 * Probes the Agentbox office and staff endpoints and reports their real shape.
 *
 * The published reference documents these responses as empty objects, so every
 * field name we might use for office and agent pages is a guess until one
 * authentic payload settles it. This is the office/staff counterpart to
 * `probe-agentbox.ts`, which does the same job for listings.
 *
 *   node --experimental-strip-types scripts/probe-directory.ts
 *   node --experimental-strip-types scripts/probe-directory.ts --save probe.json
 *
 * Read-only: it issues GETs and writes nothing back. Credentials come from the
 * environment or `.dev.vars`, both gitignored, and nothing here prints one.
 * `AgentboxClient` still refuses a non-sandbox client ID on its own.
 *
 * ⚠️ The API key is IP-allowlisted. From an address that is not on the list
 * every request returns 401 "The IP is not allowed" — which reads like a bad
 * credential but is not one.
 */

import { writeFileSync } from 'node:fs';

import { AgentboxClient, AgentboxError } from '../src/lib/ingestion/agentbox-client.ts';
import { requireAgentboxCredentials, describeInstance } from './agentbox-credentials.ts';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const credentials = requireAgentboxCredentials();

const client = new AgentboxClient({
  credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
  allowProduction: credentials.allowProduction,
});

console.log(`Instance: ${describeInstance(credentials)}\n`);

/** Keys the current mapping reads, so the report can show what is left over. */
const CONSUMED = {
  office: new Set(['id', 'officeId', 'name', 'officeName']),
  staff: new Set([
    'id', 'firstName', 'lastName', 'officeId', 'mobile', 'phone', 'email',
    'photo', 'photoUrl', 'imageUrl', 'hideMobileOnWeb',
  ]),
};

/** A value's shape, without dumping the value itself. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'array (empty)' : `array[${value.length}] of ${typeof value[0]}`;
  }
  if (typeof value === 'object') {
    return `object {${Object.keys(value as object).join(', ')}}`;
  }
  if (typeof value === 'string') {
    return value === '' ? 'string (empty)' : `string "${value.slice(0, 60)}"`;
  }
  return `${typeof value} ${String(value)}`;
}

/**
 * Fetches one collection and reports every key across the sample, so a field
 * that is null on the first record but populated on the third still shows up.
 */
async function probe(
  path: string,
  collection: string,
  consumed: Set<string>,
  query: Record<string, string | number> = {},
): Promise<unknown[]> {
  console.log(`${'='.repeat(70)}\nGET ${path}\n${'='.repeat(70)}`);

  let records: unknown[] = [];

  try {
    const page = await client.getPage<Record<string, unknown>>(path, collection, {
      limit: 20,
      ...query,
    });
    records = page.records;
    console.log(`ok — ${page.items} total, ${page.records.length} in this sample\n`);
  } catch (error) {
    if (error instanceof AgentboxError) {
      console.log(`FAILED  status ${error.status}`);
      console.log(`${error.message}\n`);
      return [];
    }
    throw error;
  }

  if (records.length === 0) {
    console.log('(no records)\n');
    return records;
  }

  // Union of keys across the sample, not just the first record.
  const keys = new Set<string>();
  for (const record of records) {
    if (record && typeof record === 'object') {
      for (const key of Object.keys(record as object)) keys.add(key);
    }
  }

  const first = records[0] as Record<string, unknown>;

  console.log('field                          used?  first record');
  console.log('-'.repeat(70));
  for (const key of [...keys].sort()) {
    const used = consumed.has(key) ? ' yes ' : ' NO  ';
    // How many of the sample actually carry a value — a field that is null on
    // every record is not worth building a page around.
    const filled = records.filter((r) => {
      const v = (r as Record<string, unknown>)?.[key];
      return v !== null && v !== undefined && v !== '';
    }).length;
    console.log(
      `${key.padEnd(30)} ${used}  ${String(filled).padStart(2)}/${records.length}  ${describe(first[key])}`,
    );
  }
  console.log();

  return records;
}

const offices = await probe('/offices', 'offices', CONSUMED.office);
const staff = await probe('/staff', 'staffMembers', CONSUMED.staff);

const save = arg('save');
if (save) {
  writeFileSync(save, JSON.stringify({ offices, staff }, null, 2));
  console.log(`Saved the sample payloads to ${save}`);
}

/**
 * Fetches one real listing from Agentbox and reports what the mapping misses.
 *
 * This exists for one reason: the published API reference documents the
 * listing response as an empty object, so every field name in
 * `src/lib/ingestion/agentbox-mapping.ts` is a guess. One authentic payload
 * settles all of them.
 *
 *   node --experimental-strip-types scripts/probe-agentbox.ts
 *   node --experimental-strip-types scripts/probe-agentbox.ts --id 1234567
 *   node --experimental-strip-types scripts/probe-agentbox.ts --save probe.json
 *
 * Credentials come from the environment, or from `.dev.vars` if it is present.
 * Both files are gitignored. Nothing here prints a credential, and `--save`
 * writes the listing payload only.
 *
 * ⚠️ Run this from a machine that can reach `api.agentboxcrm.com.au`. The
 * development container this was written in is firewalled off from that host.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { AgentboxClient, isSandboxClientId } from '../src/lib/ingestion/agentbox-client.ts';
import { collectUnmappedKeys, mapListing } from '../src/lib/ingestion/agentbox-mapping.ts';

// ------------------------------------------------------------------ config --

function readDevVars(): Record<string, string> {
  if (!existsSync('.dev.vars')) return {};

  const vars: Record<string, string> = {};

  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }

  return vars;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const devVars = readDevVars();
const clientId = process.env.AGENTBOX_CLIENT_ID ?? devVars.AGENTBOX_CLIENT_ID;
const apiKey = process.env.AGENTBOX_API_KEY ?? devVars.AGENTBOX_API_KEY;

if (!clientId || !apiKey) {
  console.error(
    'Missing credentials.\n\n' +
      'Create a .dev.vars file in the project root containing:\n\n' +
      '  AGENTBOX_CLIENT_ID=...\n' +
      '  AGENTBOX_API_KEY=...\n\n' +
      '.dev.vars is gitignored and will not be committed.',
  );
  process.exit(1);
}

// ------------------------------------------------------------------- probe --

const client = new AgentboxClient({
  credentials: { clientId, apiKey },
  allowProduction: process.argv.includes('--allow-production'),
});

console.log(`Instance: ${isSandboxClientId(clientId) ? 'sandbox' : 'NOT a sandbox'}`);

const explicitId = arg('id');
let raw: unknown;

if (explicitId) {
  console.log(`Fetching /listings/${explicitId} …\n`);
  const body = await client.get<Record<string, unknown>>(`/listings/${explicitId}`, {
    include: 'images,relatedStaffMembers',
  });
  raw = Array.isArray(body) ? body[0] : (body?.listing ?? body);
} else {
  console.log('Fetching /listings?limit=1 …\n');
  const page = await client.getPage<unknown>('/listings', 'listings', {
    limit: 1,
    include: 'images,relatedStaffMembers',
  });
  console.log(`Total listings on this instance: ${page.items}\n`);
  raw = page.records[0] ?? null;
}

if (raw === null || raw === undefined) {
  console.error('No listing returned. The instance may be empty.');
  process.exit(1);
}

// ----------------------------------------------------------------- report --

console.log('--- raw payload ---------------------------------------------');
console.log(JSON.stringify(raw, null, 2));

console.log('\n--- top-level keys ------------------------------------------');
console.log(Object.keys(raw as object).sort().join('\n'));

const unmapped = collectUnmappedKeys(raw);
console.log('\n--- keys the mapping ignores --------------------------------');
console.log(unmapped.length === 0 ? '(none)' : unmapped.join('\n'));

console.log('\n--- mapped Listing ------------------------------------------');
try {
  const listing = mapListing(raw);
  console.log(JSON.stringify(listing, null, 2));

  const empty = Object.entries(listing)
    .filter(([, value]) => value === null || value === '' || (Array.isArray(value) && value.length === 0))
    .map(([key]) => key);

  console.log('\n--- fields the mapping could not fill ------------------------');
  console.log(empty.length === 0 ? '(none)' : empty.join('\n'));
  console.log(
    '\nEach one is either genuinely absent on this listing, or a wrong guess ' +
      'in agentbox-mapping.ts. Cross-check against the raw payload above.',
  );
} catch (error) {
  console.error(`mapListing threw: ${(error as Error).message}`);
}

const savePath = arg('save');
if (savePath) {
  writeFileSync(savePath, JSON.stringify(raw, null, 2));
  console.log(`\nPayload written to ${savePath}`);
}

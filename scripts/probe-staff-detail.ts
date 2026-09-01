/**
 * Second-pass probe of the staff endpoint.
 *
 * Answers three questions the list probe raised:
 *
 *   1. Does `/staff/{id}` return more than `/staff` does? `/listings` behaves
 *      that way — images exist only on the detail route — so the same may hold
 *      for a headshot or a bio.
 *   2. What separates a public-facing agent from a back-office account? The
 *      sandbox has 108 staff and the first twenty are `role: Admin`, so an
 *      unfiltered directory would publish admin and test accounts.
 *   3. Is `webDisplay` the publication control it looks like?
 *
 * Read-only. Credentials come from the environment or `.dev.vars`; nothing here
 * prints one.
 */

import { AgentboxClient, AgentboxError } from '../src/lib/ingestion/agentbox-client.ts';
import { requireAgentboxCredentials, describeInstance } from './agentbox-credentials.ts';

const credentials = requireAgentboxCredentials();
const client = new AgentboxClient({
  credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
  allowProduction: credentials.allowProduction,
});

console.log(`Instance: ${describeInstance(credentials)}\n`);

type Staff = Record<string, unknown>;

// ---------------------------------------------- 1. every staff member, once --

const all: Staff[] = [];
for await (const page of client.paginate<Staff>('/staff', 'staffMembers', { limit: 100 })) {
  all.push(...page.records);
}
console.log(`Walked /staff — ${all.length} records\n`);

function tally(key: string): void {
  const counts = new Map<string, number>();
  for (const record of all) {
    const value = record[key];
    const label = value === null || value === undefined || value === ''
      ? '(empty)'
      : String(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${key}:`);
  for (const [label, n] of rows.slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${label}`);
  }
  console.log();
}

console.log('='.repeat(70));
console.log('What distinguishes a public agent from a back-office account');
console.log('='.repeat(70));
tally('role');
tally('status');
tally('officeName');

// `webDisplay` is an array, so it needs its own count rather than a tally.
const withWebDisplay = all.filter((s) => Array.isArray(s.webDisplay) && s.webDisplay.length > 0);
console.log(`webDisplay non-empty: ${withWebDisplay.length}/${all.length}`);
if (withWebDisplay.length > 0) {
  console.log(`  sample: ${JSON.stringify(withWebDisplay[0].webDisplay)}`);
}
console.log();

// ------------------------------------- 2. does the detail route carry more? --

console.log('='.repeat(70));
console.log('GET /staff/{id} — does the detail route return more than the list?');
console.log('='.repeat(70));

// Prefer someone who actually fronts listings: they are the realistic case.
const candidate = all.find((s) => s.role !== 'Admin') ?? all[0];
const id = String(candidate.id);

const listKeys = new Set(Object.keys(candidate));

try {
  const body = await client.get<Record<string, unknown>>(`/staff/${id}`);
  const detail = (body?.staffMember ?? body) as Staff;
  const detailKeys = Object.keys(detail);

  console.log(`id ${id} (role: ${String(candidate.role)})`);
  console.log(`list route:   ${listKeys.size} fields`);
  console.log(`detail route: ${detailKeys.length} fields\n`);

  const extra = detailKeys.filter((k) => !listKeys.has(k));
  if (extra.length === 0) {
    console.log('No extra fields. The detail route adds nothing over the list.');
  } else {
    console.log('Fields the detail route adds:');
    for (const key of extra.sort()) {
      const value = detail[key];
      const shape = value === null ? 'null'
        : Array.isArray(value) ? `array[${value.length}]`
        : typeof value === 'object' ? `object {${Object.keys(value as object).join(', ')}}`
        : `${typeof value} ${JSON.stringify(value)?.slice(0, 70)}`;
      console.log(`  ${key.padEnd(24)} ${shape}`);
    }
  }
} catch (error) {
  if (error instanceof AgentboxError) {
    console.log(`FAILED  status ${error.status}\n${error.message}`);
  } else {
    throw error;
  }
}

/**
 * Which staff should a public agent directory actually publish?
 *
 * The sandbox holds 108 staff, 98 of them `role: Admin` and many of them test
 * accounts. Publishing the lot would put back-office and test users on a public
 * website, so the directory needs a rule. This scores the candidate rules
 * against the real data and against who already fronts a listing.
 *
 * Read-only, and prints no personal data beyond a name and role.
 */

import { DatabaseSync } from 'node:sqlite';

import { AgentboxClient } from '../src/lib/ingestion/agentbox-client.ts';
import { requireAgentboxCredentials } from './agentbox-credentials.ts';

const credentials = requireAgentboxCredentials();
const client = new AgentboxClient({
  credentials: { clientId: credentials.clientId, apiKey: credentials.apiKey },
  allowProduction: credentials.allowProduction,
});

type Staff = Record<string, unknown>;

const all: Staff[] = [];
for await (const page of client.paginate<Staff>('/staff', 'staffMembers', { limit: 100 })) {
  all.push(...page.records);
}

// Who already appears publicly: anyone attached to a live listing is on a
// property page today, so a directory that excluded them would contradict it.
const db = new DatabaseSync(
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/'
  + 'bde76e6898f3690928a64ba7d2b2f4f401890171ab6ae6b30971b12661b4b718.sqlite',
);
const fronting = new Set(
  db.prepare(
    'SELECT DISTINCT la.agent_id AS id FROM listing_agents la '
    + 'JOIN listings l ON l.listing_id = la.listing_id WHERE l.deleted_at IS NULL',
  ).all().map((r) => String(r.id)),
);

const showsIn = (s: Staff, section: string): boolean =>
  Array.isArray(s.webDisplay)
  && (s.webDisplay as { name?: string }[]).some((w) => w?.name === section);

const rules: Record<string, (s: Staff) => boolean> = {
  'everyone (no filter)': () => true,
  'status = Active': (s) => s.status === 'Active',
  'role != Admin': (s) => s.role !== 'Admin',
  'webDisplay has "Our Staff"': (s) => showsIn(s, 'Our Staff'),
  'fronts a live listing': (s) => fronting.has(String(s.id)),
  'Our Staff OR fronts a listing': (s) => showsIn(s, 'Our Staff') || fronting.has(String(s.id)),
};

console.log(`${all.length} staff in the sandbox, ${fronting.size} fronting a live listing\n`);
console.log('rule                              publishes');
console.log('-'.repeat(50));
for (const [label, predicate] of Object.entries(rules)) {
  console.log(`${label.padEnd(34)} ${String(all.filter(predicate).length).padStart(3)}`);
}

console.log('\nWho each rule would publish, by role:');
for (const [label, predicate] of Object.entries(rules)) {
  const kept = all.filter(predicate);
  const byRole = new Map<string, number>();
  for (const s of kept) {
    const role = String(s.role ?? '(none)');
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }
  const summary = [...byRole.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${role} ${n}`)
    .join(', ');
  console.log(`  ${label.padEnd(34)} ${summary}`);
}

// The overlap is the interesting part: someone who fronts a listing but is not
// flagged for the staff page is already public whether the directory lists them
// or not.
const frontingNotFlagged = all.filter(
  (s) => fronting.has(String(s.id)) && !showsIn(s, 'Our Staff'),
);
console.log(`\nFronts a listing but not flagged "Our Staff": ${frontingNotFlagged.length}`);
for (const s of frontingNotFlagged.slice(0, 10)) {
  console.log(`  ${String(s.id).padEnd(10)} ${String(s.role).padEnd(22)} ${s.firstName} ${s.lastName}`);
}

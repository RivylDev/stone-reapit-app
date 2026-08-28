/**
 * Checks the query layer's filters against the fixture.
 *
 * Counts are computed twice: once in SQL against D1, once in plain JS over the
 * fixture file. If the two disagree the filter is wrong. Both sides collapse
 * duplicate IDs the same way the loader does, newest-wins, or the totals would
 * differ for an uninteresting reason.
 *
 *   node --experimental-strip-types scripts/verify-search.ts
 */

import { execFileSync } from 'node:child_process';

import { loadSeedListings } from '../src/lib/ingestion/seed-data.ts';
import type { Listing } from '../src/lib/types/listing.ts';

function queryD1(sql: string): number {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'stone-listings', '--local', '--json', '--command', sql],
    { encoding: 'utf8', env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as
    { results: { n: number }[] }[];
  return parsed[0]!.results[0]!.n;
}

// Same collapse the loader applies, so both sides describe the same 500 rows.
const feed = loadSeedListings();
const ordered = [...feed].sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt));
const byId = new Map<string, Listing>();
for (const listing of ordered) byId.set(listing.listingId, listing);
const listings = [...byId.values()];

interface Case {
  name: string;
  sql: string;
  expected: () => number;
}

const cases: Case[] = [
  {
    name: 'every live listing',
    sql: 'SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL',
    expected: () => listings.length,
  },
  {
    name: "suburb LIKE '%Manly%'",
    sql: "SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL AND l.suburb LIKE '%Manly%' COLLATE NOCASE",
    expected: () => listings.filter((l) => l.suburb.toLowerCase().includes('manly')).length,
  },
  {
    name: 'bedrooms >= 3',
    sql: 'SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL AND l.bedrooms >= 3',
    expected: () => listings.filter((l) => (l.bedrooms ?? -1) >= 3).length,
  },
  {
    name: 'suburb Manly AND bedrooms >= 3',
    sql: "SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL AND l.suburb LIKE '%Manly%' COLLATE NOCASE AND l.bedrooms >= 3",
    expected: () => listings.filter(
      (l) => l.suburb.toLowerCase().includes('manly') && (l.bedrooms ?? -1) >= 3,
    ).length,
  },
  {
    name: 'status forSale AND bedrooms >= 4',
    sql: "SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL AND l.status IN ('forSale') AND l.bedrooms >= 4",
    expected: () => listings.filter((l) => l.status === 'forSale' && (l.bedrooms ?? -1) >= 4).length,
  },
  {
    name: 'price 500k-1.5m, searchable only',
    sql: 'SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL '
      + 'AND l.price_searchable = 1 AND l.price_value >= 500000 '
      + 'AND l.price_searchable = 1 AND l.price_value <= 1500000',
    expected: () => listings.filter(
      (l) => l.priceSearchable && l.priceValue !== null
        && l.priceValue >= 500000 && l.priceValue <= 1500000,
    ).length,
  },
  {
    name: 'NSW houses with >= 2 bathrooms and >= 1 carspace',
    sql: "SELECT COUNT(*) AS n FROM listings l WHERE l.deleted_at IS NULL "
      + "AND l.state = 'NSW' COLLATE NOCASE AND l.property_type = 'House' COLLATE NOCASE "
      + 'AND l.bathrooms >= 2 AND l.carspaces >= 1',
    expected: () => listings.filter(
      (l) => l.state === 'NSW' && l.propertyType === 'House'
        && (l.bathrooms ?? -1) >= 2 && (l.carspaces ?? -1) >= 1,
    ).length,
  },
  {
    name: 'image rows match the fixture',
    sql: 'SELECT COUNT(*) AS n FROM listing_images',
    expected: () => listings.reduce((sum, l) => sum + l.images.length, 0),
  },
];

let failures = 0;
for (const testCase of cases) {
  const actual = queryD1(testCase.sql);
  const expected = testCase.expected();
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${testCase.name.padEnd(46)} `
    + `sql=${String(actual).padStart(5)}  fixture=${String(expected).padStart(5)}`,
  );
}

console.log(
  failures === 0
    ? `\nAll ${cases.length} checks agree.`
    : `\n${failures} of ${cases.length} checks disagree.`,
);
process.exit(failures === 0 ? 0 : 1);

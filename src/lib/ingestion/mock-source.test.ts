import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockSource } from './mock-source.ts';
import { loadSeedListings } from './seed-data.ts';
import type { Listing } from '../types/listing.ts';

const listings = loadSeedListings();

test('fetchAll paginates through every record in the feed', async () => {
  const source = new MockSource(listings);

  const collected: Listing[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = await source.fetchAll(cursor);
    collected.push(...page.listings);
    cursor = page.nextCursor;
    pages += 1;
    assert.ok(pages < 1000, 'pagination failed to terminate');
  } while (cursor !== undefined);

  assert.equal(collected.length, listings.length);
  assert.ok(pages > 1, 'expected the fixture to span more than one page');
});

test('duplicate listing IDs are preserved, not silently collapsed', () => {
  const distinct = new Set(listings.map((l) => l.listingId));
  assert.ok(
    distinct.size < listings.length,
    'fixture must contain duplicate IDs or the idempotency gate proves nothing',
  );
});

test('every identifier is a string', () => {
  for (const listing of listings) {
    assert.equal(typeof listing.listingId, 'string');
    assert.equal(typeof listing.officeId, 'string');
    assert.ok(listing.uniqueId === null || typeof listing.uniqueId === 'string');
    for (const agentId of listing.agentIds) assert.equal(typeof agentId, 'string');
  }
});

test('six-digit and seven-digit listing IDs both survive', () => {
  const lengths = new Set(listings.map((l) => l.listingId.length));
  assert.ok(lengths.has(6), 'expected some 6-digit IDs');
  assert.ok(lengths.has(7), 'expected some 7-digit IDs');
});

test('fetchSince filters on modifiedAt, exclusive of the cutoff', async () => {
  const source = new MockSource(listings);

  const all = await source.fetchSince(new Date('1970-01-01T00:00:00Z'));
  assert.equal(all.length, listings.length);

  const none = await source.fetchSince(new Date('2999-01-01T00:00:00Z'));
  assert.equal(none.length, 0);

  const cutoff = new Date('2026-07-01T00:00:00Z');
  const recent = await source.fetchSince(cutoff);
  assert.ok(recent.length > 0 && recent.length < listings.length, 'expected a partial slice');
  for (const listing of recent) {
    assert.ok(Date.parse(listing.modifiedAt) > cutoff.getTime());
  }
});

test('fetchSince rejects an invalid date', async () => {
  const source = new MockSource(listings);
  await assert.rejects(() => source.fetchSince(new Date('nonsense')));
});

test('fetchOne returns the most recently modified record for a duplicated ID', async () => {
  const source = new MockSource(listings);

  const counts = new Map<string, Listing[]>();
  for (const listing of listings) {
    const bucket = counts.get(listing.listingId);
    if (bucket) bucket.push(listing);
    else counts.set(listing.listingId, [listing]);
  }

  const duplicated = [...counts.values()].find((bucket) => bucket.length > 1);
  assert.ok(duplicated, 'fixture should contain at least one duplicated ID');

  const newest = duplicated.reduce((a, b) =>
    Date.parse(a.modifiedAt) >= Date.parse(b.modifiedAt) ? a : b);

  const found = await source.fetchOne(duplicated[0]!.listingId);
  assert.equal(found?.modifiedAt, newest.modifiedAt);
});

test('fetchOne returns null for an unknown ID', async () => {
  const source = new MockSource(listings);
  assert.equal(await source.fetchOne('does-not-exist'), null);
});

test('fetchAll rejects a malformed cursor', async () => {
  const source = new MockSource(listings);
  await assert.rejects(() => source.fetchAll('not-a-number'));
  await assert.rejects(() => source.fetchAll('-5'));
});

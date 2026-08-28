/**
 * Tests for the Agentbox source.
 *
 * These verify the half that is knowable: auth headers, query construction,
 * pagination, retry, and the `ListingSource` contract. They run against a fake
 * fetch and never touch the network.
 *
 * They deliberately do **not** claim the field mapping is right. The payloads
 * below use the guessed field names from `agentbox-mapping.ts`, so they prove
 * the mapping is self-consistent, not that it matches Agentbox. Only a real
 * payload can do that — see `scripts/probe-agentbox.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentboxClient, AgentboxError, isSandboxClientId } from './agentbox-client.ts';
import { AgentboxSource } from './agentbox-source.ts';
import { mapListing, mapStatus, mapCategory } from './agentbox-mapping.ts';

const SANDBOX_CLIENT_ID = btoa('https://sandbox.example.agentboxcrm.com.au/admin/');
const CREDENTIALS = { clientId: SANDBOX_CLIENT_ID, apiKey: 'test-key' };

/** Records every request, replies from a queue of handlers. */
function fakeFetch(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: URL; init: RequestInit }[] = [];

  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });

    const { status = 200, body } = handler(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function listingPayload(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'Sale',
    marketingStatus: 'Available',
    propertyType: 'Residential',
    propertyCategory: 'House',
    searchPrice: 1250000,
    displayPrice: '$1,250,000',
    lastModified: '2026-08-01 09:30:00',
    property: {
      streetNum: '12',
      streetName: 'Ocean',
      streetType: 'Street',
      suburb: { name: 'Manly', state: 'NSW', postcode: '2095' },
      bedrooms: 3,
      bathrooms: 2,
      totalParking: 1,
    },
    ...overrides,
  };
}

describe('isSandboxClientId', () => {
  it('recognises a sandbox client ID', () => {
    assert.equal(isSandboxClientId(SANDBOX_CLIENT_ID), true);
  });

  it('rejects a production client ID', () => {
    assert.equal(isSandboxClientId(btoa('https://stone.agentboxcrm.com.au/admin/')), false);
  });

  it('fails closed on an undecodable value', () => {
    assert.equal(isSandboxClientId('!!!not base64!!!'), false);
  });
});

describe('AgentboxClient', () => {
  it('refuses a non-sandbox client ID unless allowed', () => {
    assert.throws(
      () =>
        new AgentboxClient({
          credentials: { clientId: btoa('https://live.agentboxcrm.com.au/admin/'), apiKey: 'k' },
        }),
      /non-sandbox/,
    );
  });

  it('sends the documented auth headers', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { items: 0, current: 1, last: 1, listings: [] } }));
    const client = new AgentboxClient({ credentials: CREDENTIALS, fetchImpl: impl });

    await client.getPage('/listings', 'listings');

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers['X-Client-ID'], SANDBOX_CLIENT_ID);
    assert.equal(headers['X-API-Key'], 'test-key');
  });

  it('unwraps a { response: … } envelope', async () => {
    const { impl } = fakeFetch(() => ({
      body: { response: { items: 1, current: 1, last: 1, listings: [listingPayload('1234567')] } },
    }));
    const client = new AgentboxClient({ credentials: CREDENTIALS, fetchImpl: impl });

    const page = await client.getPage('/listings', 'listings');
    assert.equal(page.records.length, 1);
  });

  it('retries a 500 and then succeeds', async () => {
    let attempts = 0;
    const { impl } = fakeFetch(() => {
      attempts += 1;
      return attempts === 1
        ? { status: 500, body: 'upstream error' }
        : { body: { items: 0, current: 1, last: 1, listings: [] } };
    });

    const client = new AgentboxClient({ credentials: CREDENTIALS, fetchImpl: impl, retryBaseMs: 1 });
    await client.getPage('/listings', 'listings');

    assert.equal(attempts, 2);
  });

  it('does not retry a 404', async () => {
    let attempts = 0;
    const { impl } = fakeFetch(() => {
      attempts += 1;
      return { status: 404, body: { error: 'not found' } };
    });

    const client = new AgentboxClient({ credentials: CREDENTIALS, fetchImpl: impl, retryBaseMs: 1 });
    await assert.rejects(() => client.get('/listings/nope'), AgentboxError);
    assert.equal(attempts, 1);
  });

  it('names the keys it did find when the collection is missing', async () => {
    const { impl } = fakeFetch(() => ({ body: { items: 0, current: 1, last: 1, properties: [] } }));
    const client = new AgentboxClient({ credentials: CREDENTIALS, fetchImpl: impl });

    await assert.rejects(
      () => client.getPage('/listings', 'listings'),
      /Keys present: items, current, last, properties/,
    );
  });
});

describe('AgentboxSource.fetchAll', () => {
  it('pages with a cursor and stops on the last page', async () => {
    const { impl, calls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get('page'));
      return { body: { items: 3, current: page, last: 2, listings: [listingPayload(`100000${page}`)] } };
    });

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });

    const first = await source.fetchAll();
    assert.equal(first.listings.length, 1);
    assert.equal(first.nextCursor, '2');

    const second = await source.fetchAll(first.nextCursor);
    assert.equal(second.nextCursor, undefined);

    assert.equal(calls[0].url.searchParams.get('include'), 'images,relatedStaffMembers');
    assert.equal(calls[0].url.searchParams.get('limit'), '100');
  });

  it('rejects a malformed cursor', async () => {
    const { impl } = fakeFetch(() => ({ body: { items: 0, current: 1, last: 1, listings: [] } }));
    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });

    await assert.rejects(() => source.fetchAll('banana'), /Invalid cursor/);
  });

  it('skips an unmappable record rather than failing the page', async () => {
    const errors: Error[] = [];
    const { impl } = fakeFetch(() => ({
      body: {
        items: 2,
        current: 1,
        last: 1,
        listings: [{ noIdHere: true }, listingPayload('1234567')],
      },
    }));

    const source = new AgentboxSource({
      credentials: CREDENTIALS,
      fetchImpl: impl,
      onMappingError: (error) => errors.push(error),
    });

    const { listings } = await source.fetchAll();
    assert.equal(listings.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /has no id/);
  });
});

describe('AgentboxSource.fetchSince', () => {
  it('sends filter[modifiedAfter] and re-checks the boundary locally', async () => {
    const since = new Date('2026-08-01T00:00:00.000Z');

    const { impl, calls } = fakeFetch(() => ({
      body: {
        items: 2,
        current: 1,
        last: 1,
        listings: [
          // Exactly on the boundary: the API filter is inclusive, the
          // interface is not, so this must be dropped.
          listingPayload('1000001', { lastModified: '2026-08-01T00:00:00Z' }),
          listingPayload('1000002', { lastModified: '2026-08-02T00:00:00Z' }),
        ],
      },
    }));

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });
    const listings = await source.fetchSince(since);

    assert.equal(calls[0].url.searchParams.get('filter[modifiedAfter]'), since.toISOString());
    assert.deepEqual(listings.map((l) => l.listingId), ['1000002']);
  });

  it('walks every page', async () => {
    const { impl } = fakeFetch((url) => {
      const page = Number(url.searchParams.get('page'));
      return {
        body: {
          items: 3,
          current: page,
          last: 3,
          listings: [listingPayload(`200000${page}`, { lastModified: '2026-08-10T00:00:00Z' })],
        },
      };
    });

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });
    const listings = await source.fetchSince(new Date('2026-01-01T00:00:00Z'));

    assert.equal(listings.length, 3);
  });
});

describe('AgentboxSource.fetchOne', () => {
  it('returns null on a 404 instead of throwing', async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });

    assert.equal(await source.fetchOne('9999999'), null);
  });

  it('accepts either documented single-listing envelope', async () => {
    for (const body of [
      [listingPayload('1234567')],
      { listing: listingPayload('1234567') },
      { response: { listing: listingPayload('1234567') } },
    ]) {
      const { impl } = fakeFetch(() => ({ body }));
      const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });

      const listing = await source.fetchOne('1234567');
      assert.equal(listing?.listingId, '1234567');
    }
  });
});

describe('mapping vocabulary', () => {
  it('derives status from type and marketing status together', () => {
    assert.equal(mapStatus('Sale', 'Available'), 'forSale');
    assert.equal(mapStatus('Lease', 'Available'), 'forRent');
    assert.equal(mapStatus('Sale', 'Under Contract'), 'underOffer');
    assert.equal(mapStatus('Sale', 'Sold'), 'sold');
    assert.equal(mapStatus('Lease', 'Leased'), 'leased');
    assert.equal(mapStatus('Sale', 'Not Listed'), 'withdrawn');
  });

  it('crosses Agentbox propertyType over to our category', () => {
    assert.equal(mapCategory('Residential'), 'residential');
    assert.equal(mapCategory('Commercial'), 'commercial');
    assert.equal(mapCategory('Rural'), 'rural');
    assert.equal(mapCategory('Land'), 'land');
  });

  it('keeps identifiers as strings even when the payload sends numbers', () => {
    const listing = mapListing(listingPayload('1234567' as unknown as string, { id: 123456 }));
    assert.equal(listing.listingId, '123456');
    assert.equal(typeof listing.listingId, 'string');
  });

  it('treats a listing with no display price as price-hidden', () => {
    const listing = mapListing(
      listingPayload('1234567', { displayPrice: null, searchPrice: 900000, hidePrice: true }),
    );

    assert.equal(listing.priceSearchable, false);
    assert.equal(listing.priceValue, 900000);
  });

  it('builds a display address when the payload has no assembled one', () => {
    const listing = mapListing(listingPayload('1234567'));

    assert.equal(listing.displayAddress, '12 Ocean Street Manly');
    assert.equal(listing.slug, '12-ocean-street-manly-manly-1234567');
  });

  it('separates floorplans from photographs in the media collection', () => {
    const listing = mapListing(
      listingPayload('1234567', {
        media: [
          { type: 'Photo', url: 'https://example.com/b.jpg', order: 2 },
          { type: 'Floorplan', url: 'https://example.com/plan.jpg', order: 1 },
          { type: 'Photo', url: 'https://example.com/a.jpg', order: 1 },
        ],
      }),
    );

    assert.deepEqual(listing.images.map((i) => i.url), [
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
    assert.deepEqual(listing.floorplans.map((f) => f.url), ['https://example.com/plan.jpg']);
  });

  it('normalises a space-separated timestamp to ISO 8601', () => {
    const listing = mapListing(listingPayload('1234567'));
    assert.equal(listing.modifiedAt, '2026-08-01T09:30:00.000Z');
  });
});

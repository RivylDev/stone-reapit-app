/**
 * Tests for the Agentbox source.
 *
 * `listingPayload` is cut down from a real sandbox response — the field names
 * and their nesting are what the API returns, not inference. So these now cover
 * the mapping as well as the mechanics: auth headers, query construction,
 * pagination, retry, hydration, and the `ListingSource` contract.
 *
 * They run against a fake fetch and never touch the network. To re-confirm the
 * shape against a live instance, run `npm run agentbox:probe`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentboxClient, AgentboxError, isSandboxClientId } from './agentbox-client.ts';
import { AgentboxSource } from './agentbox-source.ts';
import { mapListing, mapStatus, mapCategory, mapStaffMembers } from './agentbox-mapping.ts';

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

/**
 * One listing as `/listings/{id}` returns it, trimmed to the fields the mapping
 * reads. Nesting matters: address sits under `property.address`, and staff are
 * wrapped one level deep under `relatedStaffMembers[].staffMember`.
 */
function listingPayload(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    externalId: '',
    officeId: '1',
    officeName: 'Stone Manly',
    type: 'Sale',
    status: 'Available',
    marketingStatus: 'Available',
    searchPrice: '1250000',
    displayPrice: '$1,250,000',
    mainHeadline: 'Ocean views',
    mainDescription: 'A house.',
    lastModified: '2026-08-01 09:30:00',
    property: {
      id: '15',
      type: 'Residential',
      category: 'House',
      address: {
        streetAddress: '12 Ocean Street',
        unitNum: '',
        streetNum: '12',
        streetName: 'Ocean',
        streetType: 'Street',
        suburb: 'Manly',
        state: 'NSW',
        postcode: '2095',
        hideAddress: false,
      },
      location: { lat: '-33.79', long: '151.28' },
      bedrooms: '3',
      bathrooms: '2',
      totalParking: '1',
      landArea: { value: '450', unit: 'sqm' },
    },
    relatedStaffMembers: [
      {
        webDisplay: true,
        displayOrder: '1',
        role: 'Sales',
        staffMember: {
          id: '1stf0016',
          officeId: '1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          mobile: '0400 000 000',
          phone: '02 9999 9999',
          hideMobileOnWeb: false,
        },
      },
    ],
    ...overrides,
  };
}

/** A list-endpoint page wrapping the given records. */
function page(records: unknown[], current = 1, last = 1) {
  return { items: records.length, current, last, listings: records };
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

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl, hydrate: false });

    const first = await source.fetchAll();
    assert.equal(first.listings.length, 1);
    assert.equal(first.nextCursor, '2');

    const second = await source.fetchAll(first.nextCursor);
    assert.equal(second.nextCursor, undefined);

    // `images` is deliberately absent — the list endpoint ignores it.
    assert.equal(calls[0].url.searchParams.get('include'), 'relatedStaffMembers,mainDescription');
    assert.equal(calls[0].url.searchParams.get('limit'), '100');
    assert.equal(calls[0].url.searchParams.get('version'), '2');
  });

  it('filters to on-market listings by default', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: page([]) }));
    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl, hydrate: false });

    await source.fetchAll();

    assert.equal(
      calls[0].url.searchParams.get('filter[marketingStatus]'),
      'Available,Sold,Leased,Under Contract',
    );
  });

  it('takes the instance unfiltered when asked', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: page([]) }));
    const source = new AgentboxSource({
      credentials: CREDENTIALS,
      fetchImpl: impl,
      hydrate: false,
      marketingStatuses: [],
    });

    await source.fetchAll();

    assert.equal(calls[0].url.searchParams.get('filter[marketingStatus]'), null);
  });

  it('hydrates each listing from the detail endpoint', async () => {
    // The list endpoint never returns images; the detail endpoint does. The
    // fake mirrors that, so a listing with photos proves hydration ran.
    const { impl, calls } = fakeFetch((url) => {
      if (url.pathname.startsWith('/listings/')) {
        return {
          body: {
            listing: listingPayload('1000001', {
              images: [{ id: '1', url: 'https://example.com/a.jpg', order: '1', title: 'Front' }],
            }),
          },
        };
      }
      return { body: page([listingPayload('1000001')]) };
    });

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });
    const { listings } = await source.fetchAll();

    assert.deepEqual(listings[0].images, [
      { url: 'https://example.com/a.jpg', order: 1, caption: 'Front' },
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.pathname, '/listings/1000001');

    // The list call must not ask for images, and the detail call must.
    assert.equal(calls[0].url.searchParams.get('include'), 'relatedStaffMembers,mainDescription');
    assert.equal(
      calls[1].url.searchParams.get('include'),
      'images,relatedStaffMembers,mainDescription',
    );
  });

  it('keeps the thin record when a detail fetch fails', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.pathname.startsWith('/listings/')) return { status: 404, body: {} };
      return { body: page([listingPayload('1000001')]) };
    });

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl });
    const { listings } = await source.fetchAll();

    assert.equal(listings.length, 1);
    assert.deepEqual(listings[0].images, []);
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
      hydrate: false,
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

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl, hydrate: false });
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

    const source = new AgentboxSource({ credentials: CREDENTIALS, fetchImpl: impl, hydrate: false });
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

  it('reads Sale/Lease as a sale', () => {
    assert.equal(mapStatus('Sale/Lease', 'Available'), 'forSale');
  });

  it('crosses property.type over to our category', () => {
    assert.equal(mapCategory('Residential'), 'residential');
    assert.equal(mapCategory('Commercial'), 'commercial');
    assert.equal(mapCategory('Business'), 'commercial');
    assert.equal(mapCategory('Holiday'), 'residential');
    assert.equal(mapCategory('Rural'), 'rural');
    assert.equal(mapCategory('Land'), 'land');
  });

  it('takes the granular label from property.category', () => {
    const listing = mapListing(listingPayload('1234567'));

    assert.equal(listing.propertyType, 'House');
    assert.equal(listing.category, 'residential');
  });

  it('keeps identifiers as strings even when the payload sends numbers', () => {
    const listing = mapListing(listingPayload('1234567', { id: 123456 }));

    assert.equal(listing.listingId, '123456');
    assert.equal(typeof listing.listingId, 'string');
  });

  it('reads the address from property.address', () => {
    const listing = mapListing(listingPayload('1234567'));

    assert.equal(listing.suburb, 'Manly');
    assert.equal(listing.state, 'NSW');
    assert.equal(listing.postcode, '2095');
    assert.equal(listing.street, 'Ocean Street');
    assert.equal(listing.streetNumber, '12');
    assert.equal(listing.displayAddress, '12 Ocean Street, Manly');
  });

  it('drops the street but keeps the locality when the vendor hides the address', () => {
    const listing = mapListing(
      listingPayload('1234567', {
        property: {
          ...listingPayload('1234567').property,
          address: { ...listingPayload('1234567').property.address, hideAddress: true },
        },
      }),
    );

    assert.equal(listing.displayAddress, 'Manly NSW');
  });

  it('parses numeric fields that arrive as strings', () => {
    const listing = mapListing(listingPayload('1234567'));

    assert.equal(listing.bedrooms, 3);
    assert.equal(listing.bathrooms, 2);
    assert.equal(listing.carspaces, 1);
    assert.equal(listing.landSize, 450);
    assert.equal(listing.landSizeUnit, 'sqm');
    assert.equal(listing.latitude, -33.79);
    assert.equal(listing.priceValue, 1250000);
  });

  /*
   * The failure this guards against: rentals carry `searchPrice: "0"` and put
   * the real figure in `searchWeeklyRent`. Reading the wrong field prices every
   * rental on the site at zero.
   */
  it('prices a rental from searchWeeklyRent, not searchPrice', () => {
    const listing = mapListing(
      listingPayload('1234567', {
        type: 'Lease',
        searchPrice: '0',
        searchWeeklyRent: '1400',
        displayPrice: '$1,400',
      }),
    );

    assert.equal(listing.status, 'forRent');
    assert.equal(listing.priceValue, 1400);
  });

  it('treats a zero search price as no price at all', () => {
    const listing = mapListing(listingPayload('1234567', { searchPrice: '0' }));

    assert.equal(listing.priceValue, null);
    assert.equal(listing.priceSearchable, false);
  });

  /*
   * A vendor withholding the printed price does not withhold the search price.
   * Excluding these from price filters would hide them from the band they
   * actually sit in, which is the opposite of what `searchPrice` is for.
   */
  it('keeps a listing filterable when the display price is withheld', () => {
    const listing = mapListing(listingPayload('1234567', { displayPrice: 'confidential' }));

    assert.equal(listing.priceDisplay, 'confidential');
    assert.equal(listing.priceValue, 1250000);
    assert.equal(listing.priceSearchable, true);
  });

  /*
   * The staff record is wrapped: `relatedStaffMembers[].staffMember.id`.
   * Reading `id` off the wrapper returns undefined, which is what once left
   * every listing with no agents at all.
   */
  it('reads agent IDs from the wrapped staff member', () => {
    const listing = mapListing(listingPayload('1234567'));

    assert.deepEqual(listing.agentIds, ['1stf0016']);
  });

  it('orders agents by displayOrder and drops those hidden from the web', () => {
    const base = listingPayload('1234567');
    const listing = mapListing(
      listingPayload('1234567', {
        relatedStaffMembers: [
          { webDisplay: true, displayOrder: '2', staffMember: { id: 'second' } },
          { webDisplay: false, displayOrder: '1', staffMember: { id: 'hidden' } },
          ...base.relatedStaffMembers,
        ],
      }),
    );

    assert.deepEqual(listing.agentIds, ['1stf0016', 'second']);
  });

  it('extracts the embedded staff record as an agents row', () => {
    const [agent] = mapStaffMembers(listingPayload('1234567'));

    assert.equal(agent.agentId, '1stf0016');
    assert.equal(agent.fullName, 'Ada Lovelace');
    assert.equal(agent.officeId, '1');
    assert.equal(agent.phone, '0400 000 000');
    assert.equal(agent.email, 'ada@example.com');
  });

  it('withholds the mobile when the staff member hides it from the web', () => {
    const base = listingPayload('1234567');
    const [agent] = mapStaffMembers(
      listingPayload('1234567', {
        relatedStaffMembers: [
          {
            ...base.relatedStaffMembers[0],
            staffMember: { ...base.relatedStaffMembers[0].staffMember, hideMobileOnWeb: true },
          },
        ],
      }),
    );

    assert.equal(agent.phone, '02 9999 9999');
  });

  it('sorts images by order and keeps the title as the caption', () => {
    const listing = mapListing(
      listingPayload('1234567', {
        images: [
          { id: '2', url: 'https://example.com/b.jpg', order: '2', title: 'Rear' },
          { id: '1', url: 'https://example.com/a.jpg', order: '1', title: '' },
        ],
      }),
    );

    assert.deepEqual(listing.images, [
      { url: 'https://example.com/a.jpg', order: 1, caption: null },
      { url: 'https://example.com/b.jpg', order: 2, caption: 'Rear' },
    ]);
  });

  it('normalises a space-separated timestamp to ISO 8601', () => {
    const listing = mapListing(listingPayload('1234567'));
    assert.equal(listing.modifiedAt, '2026-08-01T09:30:00.000Z');
  });
});

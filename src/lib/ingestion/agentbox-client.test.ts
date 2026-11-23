import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentboxClient } from './agentbox-client.ts';

const SANDBOX_ID = btoa('https://sandbox1.agentboxcrm.com.au/admin/');

/*
 * The Workers runtime refuses to run `fetch` unless `this` is the global object:
 * "Illegal invocation: function called with incorrect `this` reference". Node
 * does not enforce that, which is how the client shipped with the bug — every
 * caller ran under Node, in `scripts/`, until the enquiry form made the first
 * call from inside a Worker.
 *
 * So these tests put that rule back. They swap in a global fetch that throws
 * exactly as workerd does, and build the client *without* a `fetchImpl`, which
 * is the only path the bug lived on. Tests that inject their own fetch never
 * exercised it.
 */
function workerdLikeFetch(onCall: (receiver: unknown) => void): typeof fetch {
  return function (this: unknown) {
    onCall(this);
    if (this !== globalThis && this !== undefined) {
      throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    }
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'success', enquiry: { id: 1 }, listings: [] }), { status: 200 }),
    );
  } as typeof fetch;
}

test('post() calls the global fetch with globalThis as `this`, as Workers require', async () => {
  const original = globalThis.fetch;
  const receivers: unknown[] = [];
  globalThis.fetch = workerdLikeFetch((r) => receivers.push(r));

  try {
    // No fetchImpl: the default is the path the bug lived on.
    const client = new AgentboxClient({ credentials: { clientId: SANDBOX_ID, apiKey: 'k' } });
    await client.post('/enquiries', { enquiry: {} });

    assert.equal(receivers.length, 1);
    assert.equal(receivers[0], globalThis);
  } finally {
    globalThis.fetch = original;
  }
});

test('get() is held to the same rule', async () => {
  const original = globalThis.fetch;
  const receivers: unknown[] = [];
  globalThis.fetch = workerdLikeFetch((r) => receivers.push(r));

  try {
    const client = new AgentboxClient({
      credentials: { clientId: SANDBOX_ID, apiKey: 'k' },
      maxRetries: 0,
    });
    await client.get('/listings');

    assert.equal(receivers[0], globalThis);
  } finally {
    globalThis.fetch = original;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEnquiryForm, HONEYPOT_FIELD } from './enquiry.ts';
import {
  createEnquirySink,
  toAgentboxEnquiry,
  NullEnquirySink,
  AgentboxEnquirySink,
} from './sink.ts';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const GOOD = {
  firstName: 'Alex',
  lastName: 'Citizen',
  email: 'alex@example.com',
  mobile: '0400 000 000',
  message: 'Do you have anything in Manly under $1.5m?',
};

/* Base64 of the admin URL is what selects the instance — see agentbox-client. */
const SANDBOX_ID = btoa('https://sandbox1.agentboxcrm.com.au/admin/');
const LIVE_ID = btoa('https://stone.agentboxcrm.com.au/admin/');

// ─── validation ───────────────────────────────────────────────────────────

test('accepts a complete enquiry', () => {
  const parsed = parseEnquiryForm(form(GOOD));

  assert.equal(parsed.kind, 'valid');
  if (parsed.kind !== 'valid') return;
  assert.equal(parsed.enquiry.firstName, 'Alex');
  assert.equal(parsed.enquiry.email, 'alex@example.com');
  assert.equal(parsed.enquiry.mobile, '0400 000 000');
});

test('names every missing required field at once', () => {
  const parsed = parseEnquiryForm(form({}));

  assert.equal(parsed.kind, 'invalid');
  if (parsed.kind !== 'invalid') return;
  assert.ok(parsed.errors.firstName);
  assert.ok(parsed.errors.email);
  assert.ok(parsed.errors.message);
  // Optional fields are never reported as missing.
  assert.equal(parsed.errors.lastName, undefined);
  assert.equal(parsed.errors.mobile, undefined);
});

test('rejects an address that is plainly not one, but not a plus-addressed one', () => {
  const bad = parseEnquiryForm(form({ ...GOOD, email: 'alex at example' }));
  assert.equal(bad.kind, 'invalid');

  const plus = parseEnquiryForm(form({ ...GOOD, email: 'alex+homes@example.com.au' }));
  assert.equal(plus.kind, 'valid');
});

test('rejects a mobile with letters in it', () => {
  const parsed = parseEnquiryForm(form({ ...GOOD, mobile: 'call me' }));
  assert.equal(parsed.kind, 'invalid');
  if (parsed.kind === 'invalid') assert.ok(parsed.errors.mobile);
});

test('keeps what was typed, so a rejected form is re-shown intact', () => {
  const parsed = parseEnquiryForm(form({ ...GOOD, email: 'nope' }));

  assert.equal(parsed.kind, 'invalid');
  assert.equal(parsed.values.message, GOOD.message);
  assert.equal(parsed.values.firstName, 'Alex');
});

test('trims, and turns blank optionals into null rather than empty strings', () => {
  const parsed = parseEnquiryForm(form({ ...GOOD, firstName: '  Alex  ', lastName: '   ', mobile: '' }));

  assert.equal(parsed.kind, 'valid');
  if (parsed.kind !== 'valid') return;
  assert.equal(parsed.enquiry.firstName, 'Alex');
  assert.equal(parsed.enquiry.lastName, null);
  assert.equal(parsed.enquiry.mobile, null);
});

test('caps the message length', () => {
  const parsed = parseEnquiryForm(form({ ...GOOD, message: 'x'.repeat(2001) }));
  assert.equal(parsed.kind, 'invalid');
});

test('a filled honeypot is spam, whatever else is valid', () => {
  const parsed = parseEnquiryForm(form({ ...GOOD, [HONEYPOT_FIELD]: 'https://spam.example' }));
  assert.equal(parsed.kind, 'spam');
});

// ─── payload ──────────────────────────────────────────────────────────────

test('builds the payload POST /enquiries takes, and nothing it would reject', () => {
  const parsed = parseEnquiryForm(form(GOOD));
  assert.equal(parsed.kind, 'valid');
  if (parsed.kind !== 'valid') return;

  const body = toAgentboxEnquiry(parsed.enquiry) as {
    enquiry: Record<string, unknown> & { attachedContact: Record<string, unknown> };
  };

  assert.equal(body.enquiry.comment, GOOD.message);
  assert.equal(body.enquiry.attachedContact.email, 'alex@example.com');
  // type and source must be lookup values and a wrong one is rejected.
  assert.equal('type' in body.enquiry, false);
  assert.equal('source' in body.enquiry, false);
  // A home-page enquiry is not about a property.
  assert.equal('attachedListing' in body.enquiry, false);
});

test('leaves out optional contact fields rather than sending empty strings', () => {
  const body = toAgentboxEnquiry({
    firstName: 'Alex', lastName: null, email: 'a@b.co', mobile: null, message: 'hi',
  }) as { enquiry: { attachedContact: Record<string, unknown> } };

  assert.equal('lastName' in body.enquiry.attachedContact, false);
  assert.equal('mobile' in body.enquiry.attachedContact, false);
});

// ─── the switch ───────────────────────────────────────────────────────────

test('sends nothing unless explicitly switched on', () => {
  assert.ok(createEnquirySink({}) instanceof NullEnquirySink);
  assert.ok(createEnquirySink({ AGENTBOX_CLIENT_ID: SANDBOX_ID, AGENTBOX_API_KEY: 'k' }) instanceof NullEnquirySink);
});

test('a switch without credentials falls back rather than throwing', () => {
  assert.ok(createEnquirySink({ AGENTBOX_ENQUIRIES: 'true' }) instanceof NullEnquirySink);
});

test('refuses a live instance unless production is allowed deliberately', () => {
  const sink = createEnquirySink({
    AGENTBOX_ENQUIRIES: 'true', AGENTBOX_CLIENT_ID: LIVE_ID, AGENTBOX_API_KEY: 'k',
  });
  assert.ok(sink instanceof NullEnquirySink);
});

test('switched on against a sandbox, it is the Agentbox sink', () => {
  const sink = createEnquirySink({
    AGENTBOX_ENQUIRIES: 'true', AGENTBOX_CLIENT_ID: SANDBOX_ID, AGENTBOX_API_KEY: 'k',
  });
  assert.ok(sink instanceof AgentboxEnquirySink);
});

// ─── sending ──────────────────────────────────────────────────────────────

const ENABLED = { AGENTBOX_ENQUIRIES: 'true', AGENTBOX_CLIENT_ID: SANDBOX_ID, AGENTBOX_API_KEY: 'k' };

test('POSTs to /enquiries and returns the id the CRM assigned', async () => {
  // An array rather than a `let`: TypeScript cannot see an assignment made
  // inside a callback, and narrows a `let` initialised to null down to `never`.
  const seen: { url: string; method: string }[] = [];

  const sink = createEnquirySink(ENABLED, async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ status: 'success', enquiry: { id: 91234 } }), { status: 200 });
  });

  const outcome = await sink.submit({
    firstName: 'Alex', lastName: null, email: 'a@b.co', mobile: null, message: 'hi',
  });

  assert.deepEqual(outcome, { status: 'sent', reference: '91234' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.match(seen[0].url, /\/enquiries\?version=2$/);
});

test('does NOT retry a failed POST — a 502 may have landed, and a retry duplicates it', async () => {
  let calls = 0;

  const sink = createEnquirySink(ENABLED, async () => {
    calls += 1;
    return new Response('Bad Gateway', { status: 502 });
  });

  const outcome = await sink.submit({
    firstName: 'Alex', lastName: null, email: 'a@b.co', mobile: null, message: 'hi',
  });

  assert.equal(calls, 1);
  assert.equal(outcome.status, 'failed');
});

test('reports a refusal with the CRM\'s own reason', async () => {
  const sink = createEnquirySink(ENABLED, async () =>
    new Response(JSON.stringify({ message: 'Missing scope enquiries:write' }), { status: 403 }));

  const outcome = await sink.submit({
    firstName: 'Alex', lastName: null, email: 'a@b.co', mobile: null, message: 'hi',
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.match(outcome.error, /403/);
});

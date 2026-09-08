import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapBlogPost, fetchBlogPosts, type BlogEnv } from './cms.ts';

/*
 * Captured from the live Blogs collection on 8 September 2026, unedited.
 * Real payloads rather than invented ones, so a field renamed in the Designer
 * shows up here as a failure instead of an empty section in production.
 */
const REAL_ITEM = {
  id: '6a9f5ef9da3cb06dec32228c',
  cmsLocaleId: '6a9f5ee9493ae9b8aec18045',
  lastPublished: '2026-09-08T01:07:16.836Z',
  lastUpdated: '2026-09-08T01:03:53.445Z',
  createdOn: '2026-09-08T01:03:53.445Z',
  isArchived: false,
  isDraft: false,
  fieldData: {
    excerpt:
      'Real-world examples of successful content management system implementations and their outcomes.',
    date: '2023-10-20',
    author: 'Steven Wright',
    name: 'Case Studies of Successful CMS Implementations',
    slug: 'cms-case-studies',
  },
};

test('maps a real Webflow item onto a flat post', () => {
  const post = mapBlogPost(REAL_ITEM);

  assert.ok(post);
  assert.equal(post.id, '6a9f5ef9da3cb06dec32228c');
  assert.equal(post.name, 'Case Studies of Successful CMS Implementations');
  assert.equal(post.slug, 'cms-case-studies');
  assert.equal(post.author, 'Steven Wright');
  assert.equal(post.date, '2023-10-20');
  assert.equal(post.lastPublished, '2026-09-08T01:07:16.836Z');
  assert.match(post.excerpt ?? '', /^Real-world examples/);
});

test('drops a record with no usable identity rather than emitting an unlinkable post', () => {
  assert.equal(mapBlogPost({ fieldData: { name: 'No slug or id' } }), null);
  assert.equal(mapBlogPost({ id: 'x', fieldData: { slug: 'no-name' } }), null);
  assert.equal(mapBlogPost(null), null);
  assert.equal(mapBlogPost('not an object'), null);
});

test('treats blank optional fields as absent, not as empty strings', () => {
  const post = mapBlogPost({
    id: 'a',
    fieldData: { name: 'Title', slug: 'title', excerpt: '   ', author: '' },
  });

  assert.ok(post);
  assert.equal(post.excerpt, null);
  assert.equal(post.author, null);
});

test('no token means not configured, not an error', async () => {
  const result = await fetchBlogPosts({} as BlogEnv, 6, async () => {
    throw new Error('must not be called without a token');
  });

  assert.equal(result.posts, null);
  assert.equal(result.error, null);
});

test('surfaces the scope message verbatim, because it is the whole diagnosis', async () => {
  const body = JSON.stringify({
    message: "OAuthForbidden: You are missing the following scopes - 'cms:read'",
    code: 'missing_scopes',
  });

  const result = await fetchBlogPosts({ WEBFLOW_API_TOKEN: 't' }, 6, async () =>
    new Response(body, { status: 403 }));

  assert.equal(result.posts, null);
  assert.match(result.error ?? '', /cms:read/);
});

test('requests live items from the CDN host, within the limit cap', async () => {
  let seen = '';

  await fetchBlogPosts({ WEBFLOW_API_TOKEN: 't' }, 999, async (input) => {
    seen = String(input);
    return new Response(JSON.stringify({ items: [REAL_ITEM] }), { status: 200 });
  });

  assert.match(seen, /^https:\/\/api-cdn\.webflow\.com\//);
  assert.match(seen, /\/items\/live\?/);
  // Webflow caps limit at 100; 999 must not be sent through.
  assert.match(seen, /limit=100/);
});

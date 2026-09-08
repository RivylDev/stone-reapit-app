/**
 * Reading Webflow CMS content from the app.
 *
 * Two data sources feed this site and they are not interchangeable. Listings
 * come from Agentbox into D1 — that is the whole point of the ingestion layer.
 * This file is for the other kind: content whose only author is Webflow, with
 * no upstream system behind it. Blog posts, editorial pages, office copy.
 *
 * Do not route listings through here. It would mean writing 5,376 records into
 * Webflow CMS first (the sync writer, which is out of scope), keeping two
 * sources of truth for the same data, and paying a CMS round trip to read back
 * something D1 already holds one hop away.
 *
 * Requests go to `api-cdn.webflow.com`, not `api.webflow.com`. The CDN host
 * serves cached published content, and Webflow's docs are explicit that cached
 * responses do not count against the rate limit — which matters when every
 * render of a public page reads from it.
 */

/** The Blogs collection on the Stone site. Overridable for another environment. */
const DEFAULT_BLOG_COLLECTION = '6a9f5ee9da3cb06dec321c53';

const CDN_HOST = 'https://api-cdn.webflow.com';

/** Webflow caps this at 100. */
const MAX_LIMIT = 100;

/**
 * One published post, flattened.
 *
 * Webflow nests the authored values under `fieldData` and keeps the record
 * metadata beside it. Callers should not have to know that, so the shape below
 * is flat and the field slugs are resolved once, here.
 */
export interface BlogPost {
  id: string;
  /** The post title. Webflow calls the title field `name`. */
  name: string;
  slug: string;
  excerpt: string | null;
  author: string | null;
  /** As authored. The field is PlainText in Webflow, not a real date. */
  date: string | null;
  lastPublished: string | null;
}

/** What the caller gets back. `null` posts means "not configured", not "empty". */
export interface BlogResult {
  posts: BlogPost[] | null;
  /** Set when the fetch was attempted and failed. */
  error: string | null;
  /** How many the collection holds, regardless of how many were asked for. */
  total: number | null;
}

interface WebflowItem {
  id?: unknown;
  lastPublished?: unknown;
  fieldData?: Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * One API item to one `BlogPost`.
 *
 * Exported so it can be tested against a real captured payload without a
 * network call — the mapping is the part that breaks when a field is renamed
 * in the Designer, and it is the part worth a test.
 *
 * Returns null for a record with no usable identity rather than emitting a post
 * that cannot be linked to.
 */
export function mapBlogPost(raw: unknown): BlogPost | null {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw as WebflowItem;
  const fields = (item.fieldData ?? {}) as Record<string, unknown>;

  const id = text(item.id);
  const name = text(fields.name);
  const slug = text(fields.slug);

  if (!id || !name || !slug) return null;

  return {
    id,
    name,
    slug,
    excerpt: text(fields.excerpt),
    author: text(fields.author),
    date: text(fields.date),
    lastPublished: text(item.lastPublished),
  };
}

export interface BlogEnv {
  WEBFLOW_API_TOKEN?: string;
  WEBFLOW_BLOG_COLLECTION_ID?: string;
}

/**
 * Published blog posts, newest first as Webflow returns them.
 *
 * Absent a token this returns `{ posts: null }` rather than throwing. A fresh
 * checkout has no Webflow credentials and must still render every page — the
 * same reason `createListingSource()` defaults to fixtures. A page that wants
 * the section hidden checks for `null`; one that wants to say so can.
 */
export async function fetchBlogPosts(
  env: BlogEnv,
  limit = 6,
  fetchImpl: typeof fetch = fetch,
  offset = 0,
): Promise<BlogResult> {
  const token = env.WEBFLOW_API_TOKEN;
  if (!token) return { posts: null, error: null, total: null };

  const collection = env.WEBFLOW_BLOG_COLLECTION_ID || DEFAULT_BLOG_COLLECTION;
  const url = new URL(`${CDN_HOST}/v2/collections/${collection}/items/live`);
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), MAX_LIMIT)));
  if (offset > 0) url.searchParams.set('offset', String(offset));

  try {
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });

    if (!response.ok) {
      /*
       * The message is worth surfacing verbatim. A token missing `cms:read`
       * answers 403 with exactly which scope it lacks, and that sentence is
       * the whole diagnosis — far more use than "request failed".
       */
      const body = await response.text();
      return {
        posts: null,
        error: `Webflow CMS ${response.status}: ${body.slice(0, 200)}`,
        total: null,
      };
    }

    const body = (await response.json()) as {
      items?: unknown[];
      pagination?: { total?: unknown };
    };
    const items = Array.isArray(body.items) ? body.items : [];
    const total = typeof body.pagination?.total === 'number' ? body.pagination.total : null;

    return {
      posts: items.map(mapBlogPost).filter((p): p is BlogPost => p !== null),
      error: null,
      total,
    };
  } catch (error) {
    return {
      posts: null,
      error: error instanceof Error ? error.message : String(error),
      total: null,
    };
  }
}

/**
 * Every published post, paging past the API's 100-per-request cap.
 *
 * `fetchBlogPosts` is one request and is what a page with a fixed count should
 * use. This is for "all of them", which today is 20 and one request — but a
 * collection that grows past 100 would silently truncate without the loop, and
 * that is the kind of bug nobody notices until a post goes missing.
 *
 * `max` is a stop, not a target: it bounds a runaway collection rather than
 * setting how many to show. Leave it alone unless the collection is enormous.
 */
export async function fetchAllBlogPosts(
  env: BlogEnv,
  max = 500,
  fetchImpl: typeof fetch = fetch,
): Promise<BlogResult> {
  const collected: BlogPost[] = [];
  let offset = 0;
  let total: number | null = null;

  // Bounded rather than `while (true)`: a wrong `total` cannot spin forever.
  for (let page = 0; page < Math.ceil(max / MAX_LIMIT) + 1; page += 1) {
    const remaining = max - collected.length;
    if (remaining <= 0) break;

    const result = await fetchBlogPosts(
      env,
      Math.min(remaining, MAX_LIMIT),
      fetchImpl,
      offset,
    );

    // Not configured, or failed. Either way, hand back what the caller needs.
    if (result.posts === null) {
      return collected.length > 0
        ? { posts: collected, error: result.error, total }
        : result;
    }

    collected.push(...result.posts);
    if (result.total !== null) total = result.total;

    // A short page is the last page, whatever the total claims.
    if (result.posts.length < MAX_LIMIT) break;
    offset += result.posts.length;
  }

  return { posts: collected, error: null, total };
}

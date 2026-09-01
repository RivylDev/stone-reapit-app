/**
 * A thin HTTP client for the Reapit Sales (Agentbox) API.
 *
 * Everything in this file is derived from the published API reference and is
 * safe to rely on: base URL, auth headers, pagination shape, filter names.
 * The *listing field names* are not in that reference — the response schemas
 * are published as empty objects — so none of that lives here. See
 * `agentbox-mapping.ts`.
 *
 * Nothing outside `src/lib/ingestion/` imports this.
 */

export const AGENTBOX_BASE_URL = 'https://api.agentboxcrm.com.au';

/**
 * Every request must carry a `version` in the query string. Omitting it is not
 * a default — the API answers HTTP 300 "Invalid Version" and names the versions
 * it accepts, currently 1 and 2. 2 is the current one.
 */
export const AGENTBOX_API_VERSION = 2;

export interface AgentboxCredentials {
  /** Sent as `X-Client-ID`. Base64 of the Agentbox admin URL — it selects the environment. */
  clientId: string;
  /** Sent as `X-API-Key`. */
  apiKey: string;
}

export interface AgentboxClientOptions {
  credentials: AgentboxCredentials;
  baseUrl?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Query-string API version. Defaults to `AGENTBOX_API_VERSION`. */
  version?: number;
  /** Retries on 429 and 5xx only. Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in ms, doubled per attempt. Defaults to 500. */
  retryBaseMs?: number;
  /**
   * The client ID encodes which Agentbox instance is being addressed. This
   * client refuses one that does not look like a sandbox unless you say so
   * explicitly, so a production credential cannot be reached for by accident.
   */
  allowProduction?: boolean;
}

/** A non-2xx response, or a body that did not parse. */
export class AgentboxError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'AgentboxError';
    this.status = status;
    this.body = body;
  }
}

/** Query values as the API takes them, e.g. `{ 'filter[suburb]': 'Manly', limit: 50 }`. */
export type AgentboxQuery = Record<string, string | number | boolean | undefined>;

/**
 * The documented list envelope: `{ items, current, last, <collection>: [] }`.
 * `items` is the total record count, `current` and `last` are 1-based pages.
 */
export interface AgentboxPage<T> {
  items: number;
  current: number;
  last: number;
  records: T[];
}

/**
 * Decodes the client ID and reports whether it addresses a sandbox instance.
 *
 * The ID is base64 of the admin URL, e.g. `https://sandbox1.agentboxcrm.com.au/admin/`.
 * A value that does not decode is treated as *not* a sandbox — fail closed.
 */
export function isSandboxClientId(clientId: string): boolean {
  try {
    return /sandbox/i.test(atob(clientId));
  } catch {
    return false;
  }
}

export class AgentboxClient {
  readonly #credentials: AgentboxCredentials;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #version: number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;

  constructor(options: AgentboxClientOptions) {
    const { credentials, allowProduction = false } = options;

    if (!credentials?.clientId || !credentials?.apiKey) {
      throw new Error('AgentboxClient requires both a clientId and an apiKey');
    }
    if (!allowProduction && !isSandboxClientId(credentials.clientId)) {
      throw new Error(
        'Refusing to use a non-sandbox Agentbox client ID. Pass allowProduction: true ' +
          'to address a live instance deliberately.',
      );
    }

    this.#credentials = credentials;
    this.#baseUrl = (options.baseUrl ?? AGENTBOX_BASE_URL).replace(/\/$/, '');
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#version = options.version ?? AGENTBOX_API_VERSION;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#retryBaseMs = options.retryBaseMs ?? 500;

    if (typeof this.#fetch !== 'function') {
      throw new Error('No fetch implementation available');
    }
  }

  /**
   * One GET, JSON in hand.
   *
   * Responses arrive in one of two envelopes depending on the endpoint —
   * bare, or wrapped in `{ "response": ... }`. This unwraps both so callers
   * see one shape.
   */
  async get<T = unknown>(path: string, query: AgentboxQuery = {}): Promise<T> {
    const url = this.#buildUrl(path, query);
    const response = await this.#fetchWithRetry(url);
    const text = await response.text();

    if (!response.ok) {
      throw new AgentboxError(
        `Agentbox ${response.status} for ${path}`,
        response.status,
        text.slice(0, 2000),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AgentboxError(`Agentbox returned non-JSON for ${path}`, response.status, text.slice(0, 2000));
    }

    return unwrapEnvelope(parsed) as T;
  }

  /**
   * One page of a collection.
   *
   * `collection` is the key the records sit under — `listings`, `offices`,
   * `staff`. The API names it after the resource rather than using a generic
   * `data` key.
   */
  async getPage<T = unknown>(
    path: string,
    collection: string,
    query: AgentboxQuery = {},
  ): Promise<AgentboxPage<T>> {
    const body = await this.get<Record<string, unknown>>(path, query);
    const records = body?.[collection];

    if (!Array.isArray(records)) {
      throw new AgentboxError(
        `Expected an array at "${collection}" in the ${path} response, got ${typeof records}. ` +
          `Keys present: ${Object.keys(body ?? {}).join(', ') || '(none)'}`,
        200,
        JSON.stringify(body ?? null).slice(0, 2000),
      );
    }

    return {
      items: toInt(body.items) ?? records.length,
      current: toInt(body.current) ?? 1,
      last: toInt(body.last) ?? 1,
      records: records as T[],
    };
  }

  /**
   * Every page of a collection, walked in order.
   *
   * Yields page by page rather than accumulating, so a caller syncing 5,000
   * listings can write each page as it lands instead of holding the lot.
   */
  async *paginate<T = unknown>(
    path: string,
    collection: string,
    query: AgentboxQuery = {},
    startPage = 1,
  ): AsyncGenerator<AgentboxPage<T>, void, undefined> {
    let page = startPage;

    // Bounded so a malformed `last` cannot spin forever.
    for (let guard = 0; guard < 10_000; guard += 1) {
      const result = await this.getPage<T>(path, collection, { ...query, page });
      yield result;

      if (result.records.length === 0) return;
      if (result.current >= result.last) return;

      page = result.current + 1;
    }

    throw new AgentboxError(`Pagination of ${path} exceeded 10,000 pages`, 200, '');
  }

  #buildUrl(path: string, query: AgentboxQuery): string {
    const url = new URL(`${this.#baseUrl}/${path.replace(/^\//, '')}`);

    // Set before the caller's query, so an explicit `version` still wins.
    url.searchParams.set('version', String(this.#version));

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  async #fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(this.#retryBaseMs * 2 ** (attempt - 1));

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: 'GET',
          headers: {
            'X-Client-ID': this.#credentials.clientId,
            'X-API-Key': this.#credentials.apiKey,
            accept: 'application/json',
          },
        });
      } catch (error) {
        // Network-level failure. Worth another go; a 4xx is not.
        lastError = error;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new AgentboxError(`Agentbox ${response.status}`, response.status, '');
        continue;
      }

      return response;
    }

    throw lastError instanceof Error
      ? lastError
      : new AgentboxError('Agentbox request failed', 0, String(lastError));
  }
}

/** `{ "response": X }` → `X`. Anything else passes through untouched. */
function unwrapEnvelope(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'response' in value) {
    return (value as { response: unknown }).response;
  }
  return value;
}

function toInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

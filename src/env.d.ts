/* eslint-disable @typescript-eslint/no-empty-interface */
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

/**
 * Set in the Webflow Cloud dashboard rather than wrangler.json, so `wrangler
 * types` cannot see it. Declared here by interface merging.
 *
 * Optional on purpose: the seed endpoint refuses to run when it is absent,
 * which is the behaviour we want on any environment that has not opted in.
 */
declare namespace Cloudflare {
  interface Env {
    SEED_TOKEN?: string;
  }
}

declare namespace App {
  interface Locals extends Runtime {}
}

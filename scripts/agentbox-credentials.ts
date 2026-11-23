/**
 * Where the Agentbox credentials come from, for every script that needs them.
 *
 * One reader, so the probe and the seed loader cannot drift on which files they
 * look at or what they do when a production client ID turns up.
 *
 * Resolution order: real environment first, then `.dev.vars`. Both are
 * gitignored. Nothing here prints a credential.
 */

import { readFileSync, existsSync } from 'node:fs';

import { isSandboxClientId } from '../src/lib/ingestion/agentbox-client.ts';

export interface AgentboxCredentialsResult {
  clientId: string;
  apiKey: string;
  /** False for a client ID that does not decode to a sandbox admin URL. */
  sandbox: boolean;
  /** True once the caller has deliberately opted in to a live instance. */
  allowProduction: boolean;
}

/** `KEY=value` lines from `.dev.vars`, comments and blanks skipped. */
export function readDevVars(path = '.dev.vars'): Record<string, string> {
  if (!existsSync(path)) return {};

  const vars: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }

  return vars;
}

/**
 * Whether the caller has asked for a live instance.
 *
 * Two ways in, because the two contexts differ: `--allow-production` for a
 * hand-run command, `AGENTBOX_ALLOW_PRODUCTION=true` for CI or a shell that
 * already carries production credentials. Absent both, production is refused —
 * the sandbox is the default the whole way down.
 */
export function productionAllowed(argv: string[] = process.argv): boolean {
  if (argv.includes('--allow-production')) return true;
  const flag = process.env.AGENTBOX_ALLOW_PRODUCTION ?? readDevVars().AGENTBOX_ALLOW_PRODUCTION;
  return flag === 'true' || flag === '1';
}

/**
 * Credentials, or a message explaining what is missing and exiting non-zero.
 *
 * Exits rather than throwing: every caller is a top-level script, and a stack
 * trace over a missing key helps nobody.
 */
export function requireAgentboxCredentials(argv: string[] = process.argv): AgentboxCredentialsResult {
  const devVars = readDevVars();
  const clientId = process.env.AGENTBOX_CLIENT_ID ?? devVars.AGENTBOX_CLIENT_ID;
  const apiKey = process.env.AGENTBOX_API_KEY ?? devVars.AGENTBOX_API_KEY;

  if (!clientId || !apiKey) {
    console.error(
      'Missing Agentbox credentials.\n\n'
      + 'Create a .dev.vars file in the project root containing:\n\n'
      + '  AGENTBOX_CLIENT_ID=...\n'
      + '  AGENTBOX_API_KEY=...\n\n'
      + '.dev.vars is gitignored and will not be committed.',
    );
    process.exit(1);
  }

  const sandbox = isSandboxClientId(clientId);
  const allowProduction = productionAllowed(argv);

  if (!sandbox && !allowProduction) {
    console.error(
      'That client ID does not decode to a sandbox admin URL.\n\n'
      + 'Live data is not reached for by accident. To address a production\n'
      + 'instance deliberately, re-run with --allow-production, or set\n'
      + 'AGENTBOX_ALLOW_PRODUCTION=true in the environment or .dev.vars.',
    );
    process.exit(1);
  }

  return { clientId, apiKey, sandbox, allowProduction };
}

/** `sandbox` / `PRODUCTION`, for logging before anything is written. */
export function describeInstance(result: AgentboxCredentialsResult): string {
  return result.sandbox ? 'sandbox' : 'PRODUCTION (live data)';
}

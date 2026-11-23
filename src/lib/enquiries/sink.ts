/**
 * Where a website enquiry goes.
 *
 * The same arrangement as `createListingSource()`, and for the same reason. The
 * page depends on the `EnquirySink` interface and gets whatever the factory
 * returns. The factory returns a sink that sends nothing unless Agentbox is
 * explicitly switched on with credentials in hand — so a fresh checkout, the
 * tests and a preview deploy never write to anyone's CRM by accident.
 *
 * This is the first thing in the repo that writes to Agentbox. Hard rule 2 still
 * applies: `AgentboxClient` refuses a client ID that does not decode to a
 * sandbox unless production is allowed deliberately.
 *
 * Endpoint scope: `POST /enquiries` is the one write in the submission to the
 * Reapit API team (`docs/REAPIT-API-ENDPOINTS.md`). Nothing else may be called.
 */

import { AgentboxClient, AgentboxError } from '../ingestion/agentbox-client.ts';
import type { Enquiry } from './enquiry.ts';

export type EnquiryOutcome =
  /** Accepted by the CRM. `reference` is the enquiry id it assigned. */
  | { status: 'sent'; reference: string | null }
  /** The sink is switched off. Nothing left the app, and nothing was stored. */
  | { status: 'not-forwarded' }
  /** Attempted and refused, or unreachable. */
  | { status: 'failed'; error: string };

export interface EnquirySink {
  submit(enquiry: Enquiry): Promise<EnquiryOutcome>;
}

/**
 * Sends nothing, and keeps nothing.
 *
 * It is tempting to have this write the enquiry to D1 so that a switched-off
 * sink still loses no leads. That would mean storing names, emails and phone
 * numbers — a schema change, and a decision about personal data this project
 * has not made. So it does not. Switched off means switched off.
 */
export class NullEnquirySink implements EnquirySink {
  async submit(): Promise<EnquiryOutcome> {
    return { status: 'not-forwarded' };
  }
}

/**
 * The payload `POST /enquiries` takes, per the Reapit Sales API v2 reference.
 *
 * `type` and `source` are left out. Both must be values from `GET /enquiry-types`
 * and `GET /enquiry-sources`, and a wrong one is rejected — so sending neither is
 * safer than guessing, until those lookups are fetched and cached.
 *
 * No `attachedListing`: this is a general enquiry from the home page, not about
 * a property. A per-listing form would add it.
 */
export function toAgentboxEnquiry(enquiry: Enquiry): unknown {
  const contact: Record<string, string> = {
    firstName: enquiry.firstName,
    email: enquiry.email,
  };
  if (enquiry.lastName) contact.lastName = enquiry.lastName;
  if (enquiry.mobile) contact.mobile = enquiry.mobile;

  return {
    enquiry: {
      comment: enquiry.message,
      /*
       * The CRM matches an existing contact on email or mobile and creates one
       * only when neither matches. An existing contact is attached, not
       * overwritten — so a returning visitor does not clobber their own record.
       */
      attachedContact: contact,
    },
  };
}

export class AgentboxEnquirySink implements EnquirySink {
  readonly #client: AgentboxClient;

  constructor(client: AgentboxClient) {
    this.#client = client;
  }

  async submit(enquiry: Enquiry): Promise<EnquiryOutcome> {
    try {
      const body = await this.#client.post<{ enquiry?: { id?: unknown } }>(
        '/enquiries',
        toAgentboxEnquiry(enquiry),
      );
      const id = body?.enquiry?.id;
      return { status: 'sent', reference: id === undefined || id === null ? null : String(id) };
    } catch (error) {
      if (error instanceof AgentboxError) {
        return { status: 'failed', error: `${error.message}: ${error.body.slice(0, 300)}` };
      }
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export interface EnquiryEnv {
  /** The switch. Anything other than `"true"` leaves the sink off. */
  AGENTBOX_ENQUIRIES?: string;
  AGENTBOX_CLIENT_ID?: string;
  AGENTBOX_API_KEY?: string;
  AGENTBOX_ALLOW_PRODUCTION?: string;
}

/**
 * The only supported way to get a sink.
 *
 * Off unless `AGENTBOX_ENQUIRIES=true` **and** both credentials are present. A
 * switch set without credentials falls back to the null sink rather than
 * throwing: a misconfigured environment should keep rendering its pages.
 */
export function createEnquirySink(env: EnquiryEnv, fetchImpl?: typeof fetch): EnquirySink {
  if (env.AGENTBOX_ENQUIRIES !== 'true') return new NullEnquirySink();
  if (!env.AGENTBOX_CLIENT_ID || !env.AGENTBOX_API_KEY) return new NullEnquirySink();

  try {
    return new AgentboxEnquirySink(
      new AgentboxClient({
        credentials: { clientId: env.AGENTBOX_CLIENT_ID, apiKey: env.AGENTBOX_API_KEY },
        allowProduction: env.AGENTBOX_ALLOW_PRODUCTION === 'true',
        fetchImpl,
      }),
    );
  } catch {
    // The client refuses a non-sandbox ID without allowProduction. Refuse
    // quietly into the null sink rather than taking the page down.
    return new NullEnquirySink();
  }
}

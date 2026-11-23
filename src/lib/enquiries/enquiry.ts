/**
 * A general enquiry from the website, and the rules for accepting one.
 *
 * Pure: no network, no environment. The form is public and unauthenticated, so
 * everything a visitor sends is untrusted, and this is the single place it is
 * checked. Nothing downstream re-validates.
 */

export interface Enquiry {
  firstName: string;
  lastName: string | null;
  email: string;
  mobile: string | null;
  message: string;
}

/** The fields as typed, kept verbatim so a rejected form can be re-shown intact. */
export interface EnquiryValues {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  message: string;
}

export type EnquiryField = keyof EnquiryValues;

export type ParsedEnquiry =
  | { kind: 'valid'; enquiry: Enquiry; values: EnquiryValues }
  | { kind: 'invalid'; errors: Partial<Record<EnquiryField, string>>; values: EnquiryValues }
  /*
   * The honeypot was filled. Reported to the visitor as success — a bot told it
   * was caught simply tries again differently — but never forwarded.
   */
  | { kind: 'spam'; values: EnquiryValues };

/**
 * The honeypot field's name.
 *
 * Deliberately plausible. Bots fill fields whose names look like they want
 * something; a field called `honeypot` is skipped by the better ones. It is
 * hidden from people with CSS and from assistive tech with `aria-hidden` and
 * `tabindex="-1"`, so a real visitor never fills it.
 */
export const HONEYPOT_FIELD = 'website';

const LIMITS: Record<EnquiryField, number> = {
  firstName: 100,
  lastName: 100,
  email: 254,
  mobile: 30,
  message: 2000,
};

function read(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Loose on purpose. Strict email regexes reject real addresses — plus signs,
 * long TLDs, subdomains — and the CRM matches contacts by exact email anyway, so
 * a typo is caught there. This only rules out input that is plainly not one.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Digits, spaces, a leading plus, brackets and dashes. Australian or not. */
function looksLikePhone(value: string): boolean {
  return /^\+?[\d\s()-]{6,}$/.test(value);
}

export function parseEnquiryForm(form: FormData): ParsedEnquiry {
  const values: EnquiryValues = {
    firstName: read(form, 'firstName'),
    lastName: read(form, 'lastName'),
    email: read(form, 'email'),
    mobile: read(form, 'mobile'),
    message: read(form, 'message'),
  };

  if (read(form, HONEYPOT_FIELD) !== '') {
    return { kind: 'spam', values };
  }

  const errors: Partial<Record<EnquiryField, string>> = {};

  if (!values.firstName) errors.firstName = 'Enter your first name.';

  if (!values.email) errors.email = 'Enter your email address, so we can reply.';
  else if (!looksLikeEmail(values.email)) errors.email = 'That email address does not look right.';

  if (values.mobile && !looksLikePhone(values.mobile)) {
    errors.mobile = 'Use digits only, with an optional leading +.';
  }

  if (!values.message) errors.message = 'Tell us what you would like to know.';

  for (const [field, max] of Object.entries(LIMITS) as [EnquiryField, number][]) {
    if (!errors[field] && values[field].length > max) {
      errors[field] = `Keep this under ${max} characters.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { kind: 'invalid', errors, values };
  }

  return {
    kind: 'valid',
    values,
    enquiry: {
      firstName: values.firstName,
      lastName: values.lastName || null,
      email: values.email,
      mobile: values.mobile || null,
      message: values.message,
    },
  };
}

export const EMPTY_VALUES: EnquiryValues = {
  firstName: '',
  lastName: '',
  email: '',
  mobile: '',
  message: '',
};

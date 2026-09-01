/**
 * Who may appear on the public agent directory.
 *
 * This is a publication policy about real people, so it lives in one file that
 * both the sync and the query layer import, rather than being expressed twice
 * and drifting.
 *
 * The problem it solves, measured against the sandbox
 * (`scripts/probe-staff-visibility.ts`):
 *
 *   108 staff, of which 98 have `role: Admin`
 *   47 of them front a live listing — including accounts named
 *   "Atomix Sandbox", "Birdeye Test" and "Beforeyoubid Sandbox"
 *
 * So "appears on a property page" is *not* a safe proxy for "is a public
 * agent", and an unfiltered directory would publish 98 back-office and
 * integration accounts.
 *
 * The rule below publishes 12 of the 108: the ten whose role is public-facing,
 * plus two whom Agentbox has explicitly flagged for the staff page.
 *
 * It is deliberately not a database column. `role`, `status` and `web_display`
 * are stored raw and the decision is made here, so changing who appears is a
 * code change rather than a re-sync of 837 records.
 */

/** Agentbox's own flag for "show this person on the website's staff page". */
export const PUBLIC_STAFF_SECTION = 'Our Staff';

/**
 * Roles that are back-office rather than public-facing.
 *
 * A denylist rather than an allowlist of the four roles seen in the sandbox:
 * a franchise with 76 offices will use roles this instance never shows, and a
 * new one should default to being visible rather than silently disappearing.
 * `Admin` is the one that must not leak.
 */
export const NON_PUBLIC_ROLES: readonly string[] = ['Admin'];

/** The fields the rule reads. Both a DB row and a source record satisfy it. */
export interface StaffVisibility {
  role: string | null;
  status: string | null;
  webDisplay: string[];
}

/**
 * Whether a staff member may be published.
 *
 * Active, and either holding a public-facing role or explicitly flagged for the
 * staff page. The flag is an override so that an office manager whose CRM role
 * is Admin can still be listed when Stone says so — without opening the door to
 * the 96 that nobody flagged.
 *
 * A null `status` is treated as active: the listing-embedded staff record does
 * not carry one, and a missing field should not silently unpublish somebody who
 * is otherwise plainly a real agent.
 */
export function isPublishableStaff(staff: StaffVisibility): boolean {
  const active = staff.status === null || staff.status.toLowerCase() === 'active';
  if (!active) return false;

  if (staff.webDisplay.includes(PUBLIC_STAFF_SECTION)) return true;

  return staff.role !== null && !NON_PUBLIC_ROLES.includes(staff.role);
}

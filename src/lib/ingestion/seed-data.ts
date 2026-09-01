import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Listing } from '../types/listing.ts';
import { slugify } from './agentbox-mapping.ts';
import type { SourceAgent, SourceOffice } from './source.ts';

/**
 * Reads the seed fixtures off disk.
 *
 * Node-only, and deliberately so: this is used by the seed loader script, which
 * runs locally. The Worker never reads these files — it queries D1, which the
 * loader populates.
 *
 * The current fixtures are SYNTHETIC (see `scripts/generate-dev-fixtures.mjs`).
 * Swapping in the real export is a matter of replacing the files and updating
 * the filenames below; no other code changes.
 */

const LISTINGS_FILE = 'seed-listings.dev.json';
const OFFICES_FILE = 'seed-offices.dev.json';
const AGENTS_FILE = 'seed-agents.dev.json';

/** The fixture shapes. Narrower than the source types they widen into. */
export interface SeedOffice {
  officeId: string;
  name: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
}

export interface SeedAgent {
  agentId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  officeId: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
}

/** Fixture files are `{ _synthetic, records }`; a real export may be a bare array. */
function readRecords<T>(fileName: string, rootDir: string): T[] {
  const raw = readFileSync(join(rootDir, fileName), 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) return parsed as T[];

  if (parsed !== null && typeof parsed === 'object' && 'records' in parsed) {
    const { records } = parsed as { records: unknown };
    if (Array.isArray(records)) return records as T[];
  }

  throw new Error(`${fileName} is neither an array nor a { records } envelope`);
}

export function loadSeedListings(rootDir = process.cwd()): Listing[] {
  return readRecords<Listing>(LISTINGS_FILE, rootDir);
}

/*
 * The fixtures predate the office and staff endpoints, so they carry the narrow
 * shape. Both loaders widen to the full `SourceOffice` / `SourceAgent` on the
 * way out, defaulting the fields a fixture has no answer for — so a fresh
 * checkout with no credentials still loads, and the directory pages simply find
 * nobody publishable rather than failing.
 */

export function loadSeedOffices(rootDir = process.cwd()): SourceOffice[] {
  return readRecords<SeedOffice>(OFFICES_FILE, rootDir).map((office) => ({
    ...office,
    slug: `${slugify(office.name)}-${slugify(office.officeId)}`.replace(/-+/g, '-'),
    streetAddress: null,
    country: null,
    website: null,
    latitude: null,
    longitude: null,
    status: 'Active',
  }));
}

export function loadSeedAgents(rootDir = process.cwd()): SourceAgent[] {
  return readRecords<SeedAgent>(AGENTS_FILE, rootDir).map((agent) => ({
    ...agent,
    slug: `${slugify(agent.fullName ?? '')}-${slugify(agent.agentId)}`.replace(/-+/g, '-'),
    jobTitle: null,
    /*
     * The fixtures describe sales agents, so they are given the role and the
     * flag that make them publishable. Without this the synthetic directory
     * would be empty and there would be nothing to develop the pages against.
     */
    role: 'Sales Representative',
    status: 'Active',
    profile: null,
    specialistAreas: [],
    webDisplay: [],
  }));
}

import React from "react";

/*
 * CSS Modules, imported the awkward way, because two toolchains disagree.
 *
 * Webflow's bundler emits one named export per class and no default. Astro's
 * ambient `*.module.css` type declares the opposite — a default object and no
 * named exports. A namespace import is what actually works at runtime; the cast
 * is what stops the type checker rejecting it on the strength of a declaration
 * that does not describe this bundler.
 */
import * as cssModule from "./PropertySearch.module.css";

const styles = cssModule as unknown as Record<string, string>;

/**
 * The property filter panel, as a Webflow Code Component.
 *
 * This is the same filter the app renders on `/listings`, packaged so it can be
 * placed on a Webflow page — the Buy and Rent pages in particular — and edited
 * in the Designer.
 *
 * Two things make that possible, and both are deliberate:
 *
 * 1. **It has no server dependencies.** The Astro version reads the current
 *    filter state out of `Astro.url` and the mount path out of
 *    `import.meta.env.BASE_URL`. Neither exists on a Webflow page, so this
 *    version takes the action path as a prop and starts empty.
 *
 * 2. **It is a plain GET form.** Submitting navigates to the app's listings
 *    route with the filters in the query string, which is a full page load to a
 *    different route space. No fetch, no client state, nothing to hydrate.
 *
 * The parameter names below are the contract with the app, and they match the
 * ones the previous site used. Renaming one here breaks the link silently — the
 * form still submits, the filter is just ignored.
 */

/** Query parameter names. Must match `PARAM` in `src/lib/queries/params.ts`. */
const PARAM = {
  keywords: "keywords",
  propertyType: "property_type",
  priceMin: "price_min",
  priceMax: "price_max",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  carspaces: "carspaces",
  status: "status",
} as const;

const PROPERTY_TYPES = [
  "House", "Apartment", "Townhouse", "Villa", "Unit", "Duplex", "Studio",
  "Land", "Acreage", "Farm", "Lifestyle", "Office", "Retail", "Warehouse", "Showroom",
];

const PRICE_STEPS = [
  250000, 500000, 750000, 1000000, 1250000, 1500000, 2000000, 3000000, 5000000,
];

const COUNT_OPTIONS = ["1", "2", "3", "4", "5"];

const money = (value: number) =>
  value >= 1000000 ? `$${value / 1000000}m` : `$${value / 1000}k`;

export interface PropertySearchProps {
  /** Where the form submits. The app's listings route, including its mount path. */
  actionPath?: string;
  /** Panel heading. Empty hides it. */
  heading?: string;
  /** Submit button label. */
  submitLabel?: string;
  /**
   * Fixes the search to one listing status and hides the control.
   *
   * This is what makes a Buy page a Buy page: set `forSale` and the panel can
   * only ever search for-sale listings. Left empty, the visitor chooses.
   */
  lockedStatus?: string;
  /** Show the suburb text field. */
  showSuburb?: boolean;
  /** Show the property type select. */
  showPropertyType?: boolean;
  /** Show the price range selects. */
  showPrice?: boolean;
  /** Show bedrooms, bathrooms and carspaces. */
  showCounts?: boolean;
}

export const PropertySearch: React.FC<PropertySearchProps> = ({
  actionPath = "/app/listings",
  heading = "Find a property",
  submitLabel = "Search",
  lockedStatus = "",
  showSuburb = true,
  showPropertyType = true,
  showPrice = true,
  showCounts = true,
}) => {
  const status = lockedStatus.trim();

  return (
    <form className={styles.panel} method="get" action={actionPath}>
      {heading ? <h2 className={styles.heading}>{heading}</h2> : null}

      {/*
        A locked status travels as a hidden input rather than a preset select.
        The visitor cannot change it, and it survives the round trip so the
        results page filters the same way.
      */}
      {status ? <input type="hidden" name={PARAM.status} value={status} /> : null}

      <div className={styles.fields}>
        {showSuburb ? (
          <label className={styles.field}>
            <span className={styles.label}>Suburb</span>
            <input
              className={styles.input}
              type="text"
              name={PARAM.keywords}
              placeholder="e.g. Manly"
              autoComplete="off"
            />
          </label>
        ) : null}

        {showPropertyType ? (
          <label className={styles.field}>
            <span className={styles.label}>Property type</span>
            <select className={styles.select} name={PARAM.propertyType} defaultValue="">
              <option value="">Any type</option>
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
        ) : null}

        {showPrice ? (
          <div className={styles.field}>
            <span className={styles.label}>Price range</span>
            <div className={styles.pair}>
              <select
                className={styles.select}
                name={PARAM.priceMin}
                aria-label="Minimum price"
                defaultValue=""
              >
                <option value="">No min</option>
                {PRICE_STEPS.map((value) => (
                  <option key={value} value={value}>{money(value)}</option>
                ))}
              </select>
              <select
                className={styles.select}
                name={PARAM.priceMax}
                aria-label="Maximum price"
                defaultValue=""
              >
                <option value="">No max</option>
                {PRICE_STEPS.map((value) => (
                  <option key={value} value={value}>{money(value)}</option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {showCounts
          ? ([
              ["Bedrooms", PARAM.bedrooms],
              ["Bathrooms", PARAM.bathrooms],
              ["Carspaces", PARAM.carspaces],
            ] as const).map(([label, name]) => (
              <label className={styles.field} key={name}>
                <span className={styles.label}>{label}</span>
                <select className={styles.select} name={name} defaultValue="">
                  <option value="">Any</option>
                  {COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}+</option>
                  ))}
                </select>
              </label>
            ))
          : null}
      </div>

      <button className={styles.submit} type="submit">{submitLabel}</button>
    </form>
  );
};

import React, { useEffect, useState } from "react";

import * as cssModule from "./ListingGrid.module.css";

const styles = cssModule as unknown as Record<string, string>;

/**
 * A grid of listing cards, as a Webflow Code Component.
 *
 * This exists because of a gap the other two mechanisms leave open. A Cloud app
 * renders only at its mount path and never on the Designer canvas, and custom
 * `<script>` in page settings runs on the published site but not on the canvas
 * either. A code component is the only one of the three that a designer can see
 * while designing — so this is what puts real properties in front of them.
 *
 * It fetches. Webflow's docs are explicit that a component's requests run in
 * the browser, which has two consequences worth stating plainly:
 *
 * 1. **The API must allow cross-origin requests**, because the canvas is served
 *    from Webflow's origin. `/api/listings.json` sets CORS for this reason.
 * 2. **The cards are not in view-source.** That rules this out for `/buy`,
 *    `/rent` and property pages, where hard rule 4 applies and roughly 5,200
 *    indexed pages carry Stone's organic traffic. Use it for a homepage
 *    "featured" strip, an office page, a landing page — surfaces where the
 *    listings are decoration rather than the reason the page ranks.
 *
 * The server-rendered path is `search()` straight from D1, and it stays the
 * only way a section page gets its listings.
 */

/** Mirrors the payload in `src/pages/api/listings.json.ts`. */
export interface GridListing {
  listingId: string;
  href: string;
  status: string;
  propertyType: string;
  suburb: string;
  state: string;
  displayAddress: string;
  streetAddress: string;
  priceDisplay: string;
  priceValue: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
  primaryImageUrl: string | null;
}

export interface ListingGridProps {
  /** The app's mount path. `/app` in production, `/staging` on staging. */
  basePath?: string;
  /** One public status, or empty for all of them. */
  status?: string;
  /** Suburb name. Maps to the inherited `keywords` parameter. */
  suburb?: string;
  propertyType?: string;
  /** How many cards. The API caps this at 24. */
  limit?: number;
  sort?: string;
  heading?: string;
  /** Show the price line. Off is useful where prices are withheld. */
  showPrice?: boolean;
  showSpecs?: boolean;
}

/** Query parameter names. Must match `PARAM` in `src/lib/queries/params.ts`. */
function buildUrl(props: ListingGridProps): string {
  const base = (props.basePath ?? "/app").replace(/\/$/, "");
  const query = new URLSearchParams();

  if (props.status) query.set("status", props.status);
  if (props.suburb) query.set("keywords", props.suburb);
  if (props.propertyType) query.set("property_type", props.propertyType);
  if (props.sort) query.set("sort", props.sort);
  query.set("per_page", String(props.limit ?? 6));

  return `${base}/api/listings.json?${query.toString()}`;
}

/**
 * A price worth showing.
 *
 * Around 70% of sandbox records carry an empty `priceDisplay` while holding a
 * real `priceValue`, so rendering `priceDisplay` alone leaves most cards blank.
 * Falling back to the formatted number keeps a card looking finished. An
 * genuinely price-less listing — a vendor who withheld it — gets the honest
 * "Contact agent" rather than an empty line.
 */
function priceOf(listing: GridListing): string {
  if (listing.priceDisplay) return listing.priceDisplay;
  if (listing.priceValue === null) return "Contact agent";
  return listing.priceValue.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });
}

const spec = (value: number | null, label: string) =>
  value === null || value === 0 ? null : `${value} ${label}`;

export const ListingGrid: React.FC<ListingGridProps> = (props) => {
  const {
    heading = "",
    limit = 6,
    showPrice = true,
    showSpecs = true,
  } = props;

  const [listings, setListings] = useState<GridListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const url = buildUrl(props);

  useEffect(() => {
    let live = true;

    setListings(null);
    setFailure(null);

    fetch(url, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`Listings API returned ${response.status}`);
        return response.json() as Promise<{ results?: GridListing[] }>;
      })
      .then((data) => {
        if (live) setListings(data.results ?? []);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      });

    // The canvas re-renders on every prop change, so an in-flight request for
    // the previous props must not overwrite the current ones.
    return () => {
      live = false;
    };
  }, [url]);

  return (
    <section className={styles.wrap}>
      {heading ? <h2 className={styles.heading}>{heading}</h2> : null}

      {/*
        The message is deliberately plain and mentions the mount path, because
        the overwhelmingly likely cause on the canvas is a wrong Base path — the
        component cannot infer it, and a designer has no other clue.
      */}
      {failure ? (
        <p className={styles.state}>
          Could not load listings: {failure}. Check the Base path prop matches
          the app's mount path.
        </p>
      ) : null}

      {!failure && listings === null ? (
        <div className={styles.grid} aria-busy="true">
          {Array.from({ length: limit }, (_, i) => (
            <div className={styles.skeleton} key={i} />
          ))}
        </div>
      ) : null}

      {listings !== null && listings.length === 0 ? (
        <p className={styles.state}>No listings match these filters.</p>
      ) : null}

      {listings !== null && listings.length > 0 ? (
        <div className={styles.grid}>
          {listings.map((listing) => {
            const specs = [
              spec(listing.bedrooms, "bed"),
              spec(listing.bathrooms, "bath"),
              spec(listing.carspaces, "car"),
            ].filter(Boolean);

            return (
              <a className={styles.card} href={listing.href} key={listing.listingId}>
                <div className={styles.media}>
                  {listing.primaryImageUrl ? (
                    <img
                      className={styles.image}
                      src={listing.primaryImageUrl}
                      alt={listing.displayAddress}
                      loading="lazy"
                    />
                  ) : null}
                </div>

                <div className={styles.body}>
                  {showPrice ? <span className={styles.price}>{priceOf(listing)}</span> : null}
                  <span className={styles.address}>{listing.streetAddress}</span>
                  <span className={styles.suburb}>
                    {listing.suburb} {listing.state}
                  </span>
                  {showSpecs && specs.length > 0 ? (
                    <span className={styles.specs}>{specs.join(" · ")}</span>
                  ) : null}
                  <span className={styles.type}>{listing.propertyType}</span>
                </div>
              </a>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

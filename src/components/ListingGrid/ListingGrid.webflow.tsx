import { declareComponent } from "@webflow/react";
import { props } from "@webflow/data-types";

import { ListingGrid } from "./ListingGrid";
import "./ListingGrid.module.css";

/**
 * Declares ListingGrid to the Webflow Designer.
 *
 * Unlike PropertySearch, this one is `ssr: false`, and that is not an oversight.
 * The grid gets its listings from a browser fetch, so there is nothing useful to
 * render on the server — claiming otherwise would put an empty grid into the
 * HTML and imply the content was indexable when it is not.
 *
 * Which is also the rule for where this may be used. Put it on a homepage strip,
 * an office page, a landing page. Do not put it on /buy, /rent, /sold, /leased
 * or a property page: those are server-rendered from D1 because hard rule 4
 * requires listing content in view-source, and roughly 5,200 indexed pages carry
 * Stone's organic traffic.
 */
export default declareComponent(ListingGrid, {
  name: "Listing Grid",
  description:
    "A grid of live property cards, loaded in the browser. For marketing pages "
    + "and featured strips — not for the main listings pages, which are "
    + "server-rendered so search engines can read them.",
  group: "Listings",

  props: {
    basePath: props.Text({
      name: "Base path",
      defaultValue: "/app",
      group: "Connection",
      tooltip:
        "The app's mount path — /app in production, /staging on staging. Must "
        + "match, or the grid cannot reach the listings API.",
    }),

    status: props.Text({
      name: "Status",
      defaultValue: "forSale",
      group: "Filters",
      tooltip:
        "forSale, forRent, underOffer, sold or leased. Leave empty to show all "
        + "of them. Withdrawn listings are never returned.",
    }),
    suburb: props.Text({
      name: "Suburb",
      defaultValue: "",
      group: "Filters",
      tooltip: "Restrict to one suburb. Leave empty for all.",
    }),
    propertyType: props.Text({
      name: "Property type",
      defaultValue: "",
      group: "Filters",
      tooltip: "House, Apartment, Townhouse and so on. Leave empty for all.",
    }),
    sort: props.Text({
      name: "Sort",
      defaultValue: "newest",
      group: "Filters",
      tooltip: "newest, priceAsc, priceDesc or suburb.",
    }),
    limit: props.Number({
      name: "How many",
      defaultValue: 6,
      group: "Filters",
      tooltip: "Number of cards. The API caps this at 24.",
    }),

    heading: props.Text({
      name: "Heading",
      defaultValue: "",
      group: "Content",
      tooltip: "Leave empty to hide the heading.",
    }),
    showPrice: props.Boolean({
      name: "Show price",
      defaultValue: true,
      group: "Content",
    }),
    showSpecs: props.Boolean({
      name: "Show beds, baths, cars",
      defaultValue: true,
      group: "Content",
    }),
  },

  options: {
    applyTagSelectors: true,
    ssr: false,
  },
});

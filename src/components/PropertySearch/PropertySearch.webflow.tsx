import { declareComponent } from "@webflow/react";
import { props } from "@webflow/data-types";

import { PropertySearch } from "./PropertySearch";
import "./PropertySearch.module.css";

/**
 * Declares PropertySearch to the Webflow Designer.
 *
 * Every prop below becomes a control in the Properties panel, so a designer can
 * drop this on the Buy page, set the status to `forSale`, and never touch code.
 *
 * `ssr: true` is the important line. The panel must render to HTML on the
 * server: hard rule 4 in CLAUDE.md requires listing content in view-source with
 * JavaScript disabled, and a search form that only appears after hydration is a
 * search form crawlers cannot see.
 */
export default declareComponent(PropertySearch, {
  name: "Property Search",
  description:
    "Filter panel that submits to the listings app. Set Locked status to forSale "
    + "or forRent to make a page search only that kind of listing.",
  group: "Listings",

  props: {
    actionPath: props.Text({
      name: "Results URL",
      defaultValue: "/app/listings",
      group: "Behaviour",
      tooltip:
        "Where the form submits. Must include the app's mount path — /app/listings "
        + "in production, /staging/listings on staging.",
    }),
    lockedStatus: props.Text({
      name: "Locked status",
      defaultValue: "",
      group: "Behaviour",
      tooltip:
        "forSale, forRent, sold, leased or underOffer. Set it and the visitor "
        + "searches only that status. Leave empty to let them choose.",
    }),

    heading: props.Text({
      name: "Heading",
      defaultValue: "Find a property",
      group: "Content",
      tooltip: "Clear this to hide the heading entirely.",
    }),
    submitLabel: props.Text({
      name: "Button label",
      defaultValue: "Search",
      group: "Content",
    }),

    showSuburb: props.Boolean({
      name: "Suburb field",
      defaultValue: true,
      group: "Fields",
    }),
    showPropertyType: props.Boolean({
      name: "Property type",
      defaultValue: true,
      group: "Fields",
    }),
    showPrice: props.Boolean({
      name: "Price range",
      defaultValue: true,
      group: "Fields",
    }),
    showCounts: props.Boolean({
      name: "Beds, baths, cars",
      defaultValue: true,
      group: "Fields",
    }),
  },

  options: {
    applyTagSelectors: true,
    ssr: true,
  },
});

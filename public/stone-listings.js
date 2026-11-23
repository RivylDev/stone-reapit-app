/*
 * Stone listings — data-attribute binding for Webflow Designer pages.
 *
 * A Webflow Cloud app does not render on the Designer canvas, so a page built
 * in the Designer cannot server-render listings. This script is the supported
 * way round it: Webflow's own guidance is that you author `data-` attributes on
 * elements under Settings, and bring your own DOM code. This is that DOM code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS MAY AND MAY NOT BE USED
 *
 * This renders in the browser. Listing content bound this way is NOT in
 * view-source with JavaScript disabled, so it must not be how a page that
 * organic search depends on gets its listings — the section pages and property
 * pages server-render from D1 for exactly that reason (hard rule 4).
 *
 * Use it for: Designer-authored marketing pages, a homepage "featured" strip,
 * an office page widget, and previewing real data on the canvas while designing.
 *
 * Do not use it for: /buy, /rent, /sold, /leased, /property/*, or anything else
 * whose listings need to be indexed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AUTHORING, in the Designer
 *
 * On a container element, under Settings → Custom attributes:
 *
 *   data-stone-listings          (required, no value) marks it as a feed
 *   data-stone-base="/app"       (required) the Cloud app's mount path
 *   data-stone-status="forSale"  optional, any public status
 *   data-stone-suburb="Manly"    optional
 *   data-stone-property-type     optional
 *   data-stone-office            optional, an office id
 *   data-stone-sort              newest | priceAsc | priceDesc | suburb
 *   data-stone-limit="6"         optional, capped at 24 by the API
 *
 * Inside it, one child marked as the card template:
 *
 *   data-stone-template
 *
 * The template is cloned once per listing and removed from the DOM. Inside it,
 * put `data-stone-field` on any element:
 *
 *   <div data-stone-field="priceDisplay">     text is replaced
 *   <img data-stone-field="primaryImageUrl">  src is set
 *   <a   data-stone-field="href">             href is set
 *
 * Field names are the canonical `Listing` field names and nothing else:
 * listingId, slug, href, status, propertyType, suburb, state, postcode,
 * displayAddress, streetAddress, priceDisplay, priceValue, bedrooms,
 * bathrooms, carspaces, photoCount, primaryImageUrl, agentName, listedAt.
 *
 * `bedrooms`, never `beds`. `priceDisplay`, never `price`. A rename costs a
 * change across two codebases, so the names match the type exactly.
 *
 * An element whose field is null or empty gets `hidden` set, so a card with no
 * carspaces does not render a stray icon. Wrap the icon and the number in one
 * element and mark that, rather than the number alone.
 *
 * RESERVED — written by this script, never author them in the Designer:
 *
 *   data-stone-phase   loading | ready | empty | error
 *   data-stone-count   how many cards were rendered
 *   data-stone-error   why it failed, for whoever is debugging
 *
 * These must never collide with a name in FILTERS below. They did once:
 * the lifecycle attribute was `data-stone-state`, `state` is also the AU state
 * filter, and the script read its own "loading" back as a filter value and
 * matched nothing. Hence `phase`. Keep the two namespaces disjoint.
 */

(function () {
  'use strict';

  var FEED = '[data-stone-listings]';
  var API = '/api/listings.json';

  /* Attribute → the API's query parameter. The parameter names are inherited
   * from the current live site and must not drift; see queries/params.ts. */
  var FILTERS = {
    suburb: 'keywords',
    'property-type': 'property_type',
    'price-min': 'price_min',
    'price-max': 'price_max',
    bedrooms: 'bedrooms',
    bathrooms: 'bathrooms',
    carspaces: 'carspaces',
    status: 'status',
    state: 'state',
    office: 'office',
    sort: 'sort',
  };

  function buildUrl(root) {
    /*
     * The mount path has to be prefixed by hand. A Designer page is served from
     * the site root and knows nothing about where the Cloud app is mounted, so
     * a bare fetch('/api/listings.json') would 404 against the Webflow site
     * rather than reach the app. This is the caveat Webflow call out.
     */
    var base = (root.getAttribute('data-stone-base') || '').replace(/\/$/, '');
    var query = new URLSearchParams();

    for (var attr in FILTERS) {
      if (!Object.prototype.hasOwnProperty.call(FILTERS, attr)) continue;
      var value = root.getAttribute('data-stone-' + attr);
      if (value) query.set(FILTERS[attr], value);
    }

    var limit = root.getAttribute('data-stone-limit');
    if (limit) query.set('per_page', limit);

    var qs = query.toString();
    return base + API + (qs ? '?' + qs : '');
  }

  function apply(card, listing) {
    var targets = card.querySelectorAll('[data-stone-field]');

    for (var i = 0; i < targets.length; i += 1) {
      var el = targets[i];
      var value = listing[el.getAttribute('data-stone-field')];

      if (value === null || value === undefined || value === '') {
        el.hidden = true;
        continue;
      }

      el.hidden = false;

      if (el.tagName === 'IMG') el.setAttribute('src', String(value));
      else if (el.tagName === 'A') el.setAttribute('href', String(value));
      else el.textContent = String(value);
    }

    // Convenience for the whole-card link, which is usually the card itself.
    if (card.tagName === 'A' && listing.href) card.setAttribute('href', listing.href);
  }

  function fail(root, message) {
    root.setAttribute('data-stone-phase', 'error');
    // Left in the DOM rather than shown: a visitor should see an empty section,
    // not a stack trace. The attribute is there for whoever is debugging.
    root.setAttribute('data-stone-error', message);
  }

  function hydrate(root) {
    var template = root.querySelector('[data-stone-template]');

    if (!template) {
      fail(root, 'No [data-stone-template] inside this feed.');
      return;
    }

    if (!root.getAttribute('data-stone-base')) {
      fail(root, 'data-stone-base is required — set it to the app mount path.');
      return;
    }

    /*
     * Build the URL *before* writing any lifecycle attribute. The filter map
     * reads attributes off this same element, so anything the script writes
     * first would be read straight back as a filter — see RESERVED above.
     */
    var url = buildUrl(root);

    root.setAttribute('data-stone-phase', 'loading');

    fetch(url, { headers: { accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Listings API returned ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var results = (data && data.results) || [];
        var parent = template.parentNode;

        template.remove();

        for (var i = 0; i < results.length; i += 1) {
          var card = template.cloneNode(true);
          card.removeAttribute('data-stone-template');
          apply(card, results[i]);
          parent.appendChild(card);
        }

        root.setAttribute('data-stone-phase', results.length ? 'ready' : 'empty');
        root.setAttribute('data-stone-count', String(results.length));
      })
      .catch(function (error) {
        fail(root, error && error.message ? error.message : String(error));
      });
  }

  function start() {
    var feeds = document.querySelectorAll(FEED);
    for (var i = 0; i < feeds.length; i += 1) hydrate(feeds[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

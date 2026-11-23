/**
 * One consistent price line for listing cards and search results.
 *
 * Agentbox's `displayPrice` is free text that agents type, and production
 * shows what that means (23 Nov 2026): "AUCTION | Shaun Ramani", "NEW TO
 * MARKET", "Stone Exclusive Showcase - Contact Agent", "Sold by Angel Li &
 * Adam Noakes 0452 532 578", rent as "$520 pw" or "$420 per week", and blank
 * sold prices. Stone's current site prints it verbatim.
 *
 * Cards build the line from structured fields instead: the status and sale
 * method from Reapit, and from the agent's text only the price itself, when
 * there is one. Names, phone numbers and slogans never reach a card. The
 * property page keeps the agent's exact wording (`priceDisplay`).
 *
 * Pending Stone's decision at the 24 Nov walkthrough (question 9).
 */

import type { ListingStatus } from './types/listing.ts';

export interface PriceLabelInput {
  status: ListingStatus;
  saleMethod: string | null;
  /** The agent's free text. */
  priceDisplay: string;
  /** Sale: the search price. Rental: the weekly rent. Never rendered for a sale. */
  priceValue: number | null;
  soldPriceConfidential: boolean;
}

const SEPARATOR = ' · ';

const money = (value: number): string =>
  `$${Math.round(value).toLocaleString('en-AU')}`;

/** `$640,000`, `$775k`, `$1.2m` → 640000, 775000, 1200000. */
function parseAmount(raw: string): number | null {
  const match = /^\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?$/i.exec(raw.trim());
  if (!match) return null;
  const n = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = match[2]?.toLowerCase();
  return unit === 'k' ? n * 1_000 : unit === 'm' ? n * 1_000_000 : n;
}

/**
 * The price phrase inside an agent's text, normalised, or null when there is
 * no dollar figure. Keeps the one qualifier that changes meaning ("Offers
 * over", "Guide"), and drops everything else.
 */
export function extractPrice(text: string): string | null {
  const amounts = [...text.matchAll(/\$\s*[\d,]+(?:\.\d+)?\s*[km]?\b/gi)]
    .map((m) => parseAmount(m[0]))
    .filter((n): n is number => n !== null && n > 0);
  if (amounts.length === 0) return null;

  const figure = amounts.length >= 2 && amounts[1] > amounts[0]
    ? `${money(amounts[0])} to ${money(amounts[1])}`
    : money(amounts[0]);

  if (/offers?\s+(over|above|from)/i.test(text)) return `Offers over ${figure}`;
  if (/guide/i.test(text)) return `Guide ${figure}`;
  return figure;
}

export function cardPriceLabel(input: PriceLabelInput): string {
  const { status, saleMethod, priceDisplay, priceValue, soldPriceConfidential } = input;
  const isAuction = (saleMethod ?? '').toLowerCase() === 'auction';

  switch (status) {
    case 'forRent': {
      if (priceValue !== null && priceValue > 0) return `${money(priceValue)} per week`;
      return extractPrice(priceDisplay)?.concat(' per week') ?? 'Contact agent';
    }
    case 'leased':
      return priceValue !== null && priceValue > 0
        ? `Leased${SEPARATOR}${money(priceValue)} per week`
        : 'Leased';
    case 'sold': {
      const price = soldPriceConfidential ? null : extractPrice(priceDisplay);
      return `Sold${SEPARATOR}${price ?? 'Price undisclosed'}`;
    }
    case 'underOffer':
      return 'Under offer';
    case 'withdrawn':
      return 'Withdrawn';
    case 'forSale':
    default: {
      const price = extractPrice(priceDisplay) ?? 'Contact agent';
      return isAuction ? `Auction${SEPARATOR}${price}` : price;
    }
  }
}

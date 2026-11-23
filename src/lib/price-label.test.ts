import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cardPriceLabel, extractPrice } from './price-label.ts';

// Every input below is a real `displayPrice` from production, 23 Nov 2026.
const sale = (priceDisplay: string, saleMethod: string | null = 'Private Treaty') =>
  cardPriceLabel({ status: 'forSale', saleMethod, priceDisplay, priceValue: 1, soldPriceConfidential: false });

describe('cardPriceLabel', () => {
  it('keeps the price and drops names, slogans and labels', () => {
    assert.equal(sale('$2,550,000'), '$2,550,000');
    assert.equal(sale('Offers Over $659,000'), 'Offers over $659,000');
    assert.equal(sale('$1,175,000 - $1,250,000'), '$1,175,000 to $1,250,000');
    assert.equal(sale('Price Guide: $1,400,000'), 'Guide $1,400,000');
    assert.equal(sale('Price Guide $650,000 - $710,000'), 'Guide $650,000 to $710,000');
    assert.equal(sale('For Sale Guide $775k - $850k'), 'Guide $775,000 to $850,000');
    assert.equal(sale('Contact Marize Bellomo'), 'Contact agent');
    assert.equal(sale('NEW TO MARKET'), 'Contact agent');
    assert.equal(sale('Stone Exclusive Showcase - Contact Victoria Liu'), 'Contact agent');
    assert.equal(sale('MOTIVATED SELLERS | PURCHASED ELSEWHERE'), 'Contact agent');
  });

  it('labels auctions from the sale method, not the text', () => {
    assert.equal(sale('Auction Guide $640,000', 'Auction'), 'Auction · Guide $640,000');
    assert.equal(sale('AUCTION | Shaun Ramani', 'Auction'), 'Auction · Contact agent');
    assert.equal(sale('GUIDE $800,000', 'Auction'), 'Auction · Guide $800,000');
    assert.equal(sale('Auction Guide $660k', 'Auction'), 'Auction · Guide $660,000');
  });

  it('builds rent from the weekly figure, whatever the agent typed', () => {
    const rent = (priceDisplay: string, priceValue: number | null) =>
      cardPriceLabel({ status: 'forRent', saleMethod: null, priceDisplay, priceValue, soldPriceConfidential: false });
    assert.equal(rent('$520 pw', 520), '$520 per week');
    assert.equal(rent('$625.00 pw', 625), '$625 per week');
    assert.equal(rent('$420 per week', 420), '$420 per week');
    assert.equal(rent('$1100 pw', 1100), '$1,100 per week');
    assert.equal(rent('', null), 'Contact agent');
  });

  it('never shows names, phones or confidential figures on a sold card', () => {
    const sold = (priceDisplay: string, soldPriceConfidential = false) =>
      cardPriceLabel({ status: 'sold', saleMethod: null, priceDisplay, priceValue: 525000, soldPriceConfidential });
    assert.equal(sold('Sold by Angel Li & Adam Noakes 0452 532 578'), 'Sold · Price undisclosed');
    assert.equal(sold('SOLD - $1,065,000'), 'Sold · $1,065,000');
    assert.equal(sold('$410,000'), 'Sold · $410,000');
    assert.equal(sold(''), 'Sold · Price undisclosed');
    assert.equal(sold('$2,250,000', true), 'Sold · Price undisclosed');
    // A bare number with no dollar sign is not trusted as a price.
    assert.equal(sold('1250000'), 'Sold · Price undisclosed');
  });

  it('labels under offer and leased plainly', () => {
    assert.equal(cardPriceLabel({ status: 'underOffer', saleMethod: 'Auction', priceDisplay: 'Auction Guide $1,975,000', priceValue: 1, soldPriceConfidential: false }), 'Under offer');
    assert.equal(cardPriceLabel({ status: 'leased', saleMethod: null, priceDisplay: '', priceValue: 770, soldPriceConfidential: false }), 'Leased · $770 per week');
  });
});

describe('extractPrice', () => {
  it('returns null when there is no dollar figure', () => {
    assert.equal(extractPrice('For Sale - Contact Agent'), null);
    assert.equal(extractPrice('SOLD - 1,017sqm level block'), null);
  });
});

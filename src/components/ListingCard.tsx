import './ListingCard.css';

/**
 * STAND-IN for the DevLink export of the Webflow `Listing Card` component.
 *
 * This file is hand-written and lives in `src/components/`, deliberately NOT in
 * `src/devlink/`. That directory is generated: `npm run devlink:export`
 * overwrites it wholesale, so anything hand-written there would be destroyed on
 * the next export and, worse, could be mistaken for real generated output.
 *
 * The prop signature below is not invented. It is the exact set of 14 props
 * defined on the Webflow component (id a920ee6b-bf0e-bbd1-8a6f-b6b30b96e66c),
 * each already bound to an element in the Designer. The markup mirrors the
 * component's real element tree and class names.
 *
 * WHEN THE REAL EXPORT ARRIVES, the swap is one import line in listings.astro:
 *
 *   - import ListingCard from '../components/ListingCard';
 *   + import { ListingCard } from '../devlink';
 *
 * Nothing else changes, because the props are already the right names.
 *
 * Note what is absent: there is no image prop. The Webflow component's
 * `.media-placeholder` and `.agent-avatar` are plain divs, not Image elements,
 * so DevLink cannot generate an image prop for them. This stand-in reproduces
 * that limitation rather than papering over it — the grey blocks are what the
 * real export will render until those divs become Image elements in the
 * Designer.
 */
export interface ListingCardProps {
  listingId?: string;
  suburb?: string;
  /** Street-level only. The suburb renders separately. */
  displayAddress?: string;
  priceDisplay?: string;
  bedrooms?: number;
  bathrooms?: number;
  carspaces?: number;
  photoCount?: number;
  agentName?: string;
  agentPhone?: string;
  contactUrl?: string;
  openDate?: string;
  openTime?: string;
  hasOpenTimes?: boolean;
}

/*
 * Defaults mirror the default values set on the Webflow props, so an
 * unconfigured instance renders exactly as it does on the Designer canvas.
 */
export default function ListingCard({
  listingId = '0000000',
  suburb = 'Richmond',
  displayAddress = '1/38 West Market Street',
  priceDisplay = '$1,250,000',
  bedrooms = 3,
  bathrooms = 2,
  carspaces = 1,
  photoCount = 20,
  agentName = 'Jane Smith',
  agentPhone = '1234 567 890',
  contactUrl = '#',
  openDate = 'Wed 4th March',
  openTime = '4:15 pm - 4:30 pm',
  hasOpenTimes = true,
}: ListingCardProps) {
  return (
    <div className="listing-card" id={listingId}>
      <div className="listing-media">
        <div className="photo-count">{photoCount}</div>
        <div className="media-placeholder" />
        <div className="agent-strip">
          <div className="agent-avatar" />
          <div className="agent-details">
            <div className="agent-name">{agentName}</div>
            <div className="agent-phone">{agentPhone}</div>
          </div>
        </div>
      </div>

      <div className="listing-body">
        <div className="listing-suburb">{suburb}</div>
        <div className="listing-address">{displayAddress}</div>
        <div className="listing-price">{priceDisplay}</div>

        <div className="feature-row">
          <div className="feature-box">
            <div className="feature-icon" />
            <div className="feature-value">{bedrooms}</div>
          </div>
          <div className="feature-box">
            <div className="feature-icon" />
            <div className="feature-value">{bathrooms}</div>
          </div>
          <div className="feature-box">
            <div className="feature-icon" />
            <div className="feature-value">{carspaces}</div>
          </div>
        </div>

        {/* Bound to the hasOpenTimes prop via element visibility in Webflow. */}
        {hasOpenTimes && (
          <div className="open-times">
            <div className="open-times-label">Open times:</div>
            <div className="open-times-row">
              <div className="open-date">{openDate}</div>
              <div className="open-time">{openTime}</div>
            </div>
          </div>
        )}

        <a className="contact-agent" href={contactUrl}>
          Contact Agent
        </a>
      </div>
    </div>
  );
}

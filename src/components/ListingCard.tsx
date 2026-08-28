import './ListingCard.css';

/**
 * GENERATED from the live Webflow `Listing Card`, not hand-designed.
 *
 * Source: site 6a73c4d12df78ea4c276a06b, component
 *         a920ee6b-bf0e-bbd1-8a6f-b6b30b96e66c
 *
 * The element tree, class names and prop signature were all read out of the
 * Webflow Designer through the Webflow MCP, then transcribed here. The styles
 * live in ListingCard.css, likewise generated from the site's real class
 * properties and design tokens.
 *
 * This exists because `webflow devlink export` needs a Workspace API token,
 * which requires workspace Admin rights nobody on this project currently has.
 * It is a faithful reproduction from the same source of truth DevLink reads —
 * but it is NOT the official pipeline, and it does not track design changes on
 * its own. When the card changes in Webflow, ask Claude to regenerate this
 * file and ListingCard.css.
 *
 * It lives in `src/components/`, deliberately NOT in `src/devlink/`. That
 * directory belongs to the real export, which overwrites it wholesale — a file
 * placed there would be destroyed on the next run and, worse, could be mistaken
 * for genuine generated output.
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

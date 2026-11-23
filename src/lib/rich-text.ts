/**
 * Source copy → plain paragraphs.
 *
 * Agentbox returns rich text in some fields and plain text in others, with no
 * flag to say which. Measured against the sandbox: all 9 populated staff
 * `profile` values are HTML, and 2 of 163 listing descriptions are, plus one
 * carrying bare HTML entities.
 *
 * So a page cannot assume either. Rendering HTML as text shows the reader
 * literal `<p>` tags; rendering source text as HTML would be an injection
 * vector, since this copy is typed by agents into a CRM and is not trusted.
 *
 * The resolution is to convert to plain text and render as text. Block-level
 * tags become paragraph breaks, everything else is dropped, and entities are
 * decoded afterwards — never before, or `&lt;p&gt;` would be promoted into a
 * tag and then stripped, silently deleting something the author typed
 * literally. The result still goes through Astro's normal escaping on output.
 */

/** The tags that end a block, and so become a paragraph break. */
const BLOCK_END = /<\/(?:p|div|li|h[1-6]|blockquote|tr)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const ANY_TAG = /<[^>]*>/g;

/** Only the entities that actually turn up in this copy. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known !== undefined) return known;

      // Numeric entities outside the table, e.g. &#8217;. An out-of-range or
      // malformed code point is left as written rather than throwing.
      const numeric = /^&#(\d+);$/.exec(entity);
      if (numeric) {
        const code = Number(numeric[1]);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          return String.fromCodePoint(code);
        }
      }
      return entity;
    });
}

const looksLikeHtml = (value: string): boolean => /<[a-z/][^>]*>/i.test(value);

/**
 * Splits source copy into paragraphs, whether it arrived as HTML or plain text.
 *
 * Returns an empty array for null, empty or whitespace-only input, so a caller
 * can test `.length` rather than checking for emptiness twice.
 */
export function toParagraphs(value: string | null | undefined): string[] {
  if (!value) return [];

  let text = value;

  if (looksLikeHtml(text)) {
    text = text
      .replace(LINE_BREAK, '\n')
      .replace(BLOCK_END, '\n\n')
      .replace(ANY_TAG, '');
  }

  return decodeEntities(text)
    // Collapse runs of spaces and tabs, but not newlines: those carry the
    // paragraph structure this function exists to preserve.
    .replace(/[^\S\n]+/g, ' ')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * One line of plain text, for a meta description or a card summary.
 *
 * `maxLength` trims on a word boundary rather than mid-word, and appends an
 * ellipsis only when something was actually removed.
 */
export function toPlainText(
  value: string | null | undefined,
  maxLength = 300,
): string {
  const text = toParagraphs(value).join(' ');
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

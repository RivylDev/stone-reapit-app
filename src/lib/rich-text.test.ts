import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toParagraphs, toPlainText } from './rich-text.ts';
import { isPublishableStaff } from './directory-policy.ts';

describe('toParagraphs', () => {
  it('returns nothing for empty input', () => {
    assert.deepEqual(toParagraphs(null), []);
    assert.deepEqual(toParagraphs(undefined), []);
    assert.deepEqual(toParagraphs(''), []);
    assert.deepEqual(toParagraphs('   \n\n  '), []);
  });

  it('splits plain text on blank lines and keeps single newlines', () => {
    assert.deepEqual(
      toParagraphs('First para.\nSame para.\n\nSecond para.'),
      ['First para.\nSame para.', 'Second para.'],
    );
  });

  it('turns HTML paragraphs into separate blocks', () => {
    assert.deepEqual(
      toParagraphs('<p>One.</p><p>Two.</p>'),
      ['One.', 'Two.'],
    );
  });

  it('strips tags rather than showing them, which was the bug', () => {
    // Every populated staff profile in the sandbox arrives like this. Rendered
    // as text without stripping, the reader saw a literal <p>.
    const result = toParagraphs('<p>Lorem ipsum <strong>dolor</strong> sit.</p>');
    assert.deepEqual(result, ['Lorem ipsum dolor sit.']);
    assert.ok(!result[0].includes('<'));
  });

  it('treats <br> as a line break inside one paragraph', () => {
    assert.deepEqual(toParagraphs('<p>One<br>Two</p>'), ['One\nTwo']);
  });

  it('decodes entities', () => {
    assert.deepEqual(toParagraphs('Smith &amp; Co&nbsp;Pty'), ['Smith & Co Pty']);
    assert.deepEqual(toParagraphs('caf&#233;'), ['café']);
  });

  /*
   * Decoding must happen after stripping, never before. The other order would
   * promote an escaped tag into a real one and then delete it, silently losing
   * text the author typed literally.
   */
  it('keeps escaped markup as visible text', () => {
    assert.deepEqual(toParagraphs('<p>Use &lt;br&gt; to break</p>'), ['Use <br> to break']);
  });

  it('does not execute or preserve a script tag', () => {
    const result = toParagraphs('<p>Hi</p><script>alert(1)</script>');
    assert.deepEqual(result, ['Hi', 'alert(1)']);
    assert.ok(!result.join(' ').includes('<script'));
  });

  it('collapses runs of spaces without eating paragraph breaks', () => {
    assert.deepEqual(toParagraphs('a    b\n\n\n c'), ['a b', 'c']);
  });
});

describe('toPlainText', () => {
  it('joins paragraphs into one line', () => {
    assert.equal(toPlainText('<p>One.</p><p>Two.</p>'), 'One. Two.');
  });

  it('returns an empty string rather than throwing on empty input', () => {
    assert.equal(toPlainText(null), '');
  });

  it('trims on a word boundary and marks the cut', () => {
    const result = toPlainText('alpha bravo charlie delta echo foxtrot', 20);
    assert.ok(result.length <= 21, result);
    assert.ok(result.endsWith('…'), result);
    assert.ok(!result.includes('  '));
  });

  it('leaves text shorter than the limit alone', () => {
    assert.equal(toPlainText('Short.', 100), 'Short.');
  });
});

describe('isPublishableStaff', () => {
  const staff = (over: Partial<Parameters<typeof isPublishableStaff>[0]> = {}) => ({
    role: 'Sales Representative',
    status: 'Active',
    webDisplay: [] as string[],
    ...over,
  });

  it('publishes an active public-facing role', () => {
    assert.equal(isPublishableStaff(staff()), true);
    assert.equal(isPublishableStaff(staff({ role: 'Principal' })), true);
    assert.equal(isPublishableStaff(staff({ role: 'Property Management' })), true);
  });

  /*
   * The one that matters. 102 of 119 sandbox agent rows are Admin, most of them
   * integration accounts, and 47 front a live listing — so this is what keeps
   * "Atomix Sandbox" and "Birdeye Test" off the public directory.
   */
  it('does not publish an unflagged Admin', () => {
    assert.equal(isPublishableStaff(staff({ role: 'Admin' })), false);
  });

  it('publishes an Admin whom the CRM flagged for the staff page', () => {
    assert.equal(
      isPublishableStaff(staff({ role: 'Admin', webDisplay: ['Our Staff'] })),
      true,
    );
  });

  it('ignores web flags other than the staff page', () => {
    assert.equal(
      isPublishableStaff(staff({ role: 'Admin', webDisplay: ['My Listings'] })),
      false,
    );
  });

  it('never publishes an inactive person, however they are flagged', () => {
    assert.equal(isPublishableStaff(staff({ status: 'Inactive' })), false);
    assert.equal(
      isPublishableStaff(staff({ status: 'Inactive', webDisplay: ['Our Staff'] })),
      false,
    );
  });

  it('treats a missing status as active, since the listing feed omits it', () => {
    assert.equal(isPublishableStaff(staff({ status: null })), true);
  });

  it('does not publish someone with no role at all', () => {
    // Agents collected from the listing feed alone carry no role. Until a
    // /staff sync classifies them, staying unpublished is the safe default.
    assert.equal(isPublishableStaff(staff({ role: null })), false);
  });
});

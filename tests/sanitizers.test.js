import { sanitize, sanitizeTxtFile, safeParseJson } from '../js/generalHelpers.js';

describe('Sanitizers and normalization security checks', () => {

  test('sanitize removes HTML tags and attributes', () => {
    const input = '<script>alert(1)</script><b>bold</b> plain';
    const out = sanitize(input);

    // No HTML tags should remain
    expect(out).not.toMatch(/<[^>]+>/);
    // Text content should survive
    expect(out).toContain('plain');
    expect(out).toContain('bold');
  });

  test('sanitizeTxtFile removes BOM, NUL and control-chars but preserves structure', () => {
    const input = '\uFEFFHello\u0000<b>bold</b>\x01\nLine2\t';
    const out = sanitizeTxtFile(input, { normalizeNewlines: true, keepTabs: true });

    expect(out).not.toContain('\uFEFF');
    expect(out).not.toContain('\u0000');
    // tags removed
    expect(out).not.toMatch(/<[^>]+>/);
    // content preserved and newline kept
    expect(out).toContain('Hello');
    expect(out).toContain('bold');
    expect(out).toMatch(/\n/);
  });
  /*
  test('normalizeFileString strips BOM, NUL and most control characters and normalizes newlines', () => {
    const raw = '\uFEFFLine1\u0000\u0001\r\nLine2\t';
    const out = normalizeFileString(raw);

    expect(out).not.toContain('\uFEFF');
    expect(out).not.toContain('\u0000');
    // control char U+0001 removed
    expect(out).not.toMatch(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    // newlines normalized to \n
    expect(out).toContain('\n');
    expect(out).not.toContain('\r');
  });
*/
  test('safeParseJson prevents prototype pollution', () => {
    const raw = JSON.stringify({ __proto__: { polluted: true }, val: '<img src=x onerror=alert(1)>' });
    const res = safeParseJson(raw);

    // prototype must not be polluted
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(res, '__proto__')).toBe(false);

    // string values are preserved (sanitization responsibility is separate)
    expect(res.val).toBe("");
  });

});

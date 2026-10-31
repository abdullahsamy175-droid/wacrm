import { describe, expect, it } from 'vitest';
import { frameHeaders, parseFrameAncestors } from './frame-headers';

describe('parseFrameAncestors', () => {
  it('keeps origins and trims the list', () => {
    expect(parseFrameAncestors(' https://portal.bnerd.com , http://localhost:3001 ')).toEqual([
      'https://portal.bnerd.com',
      'http://localhost:3001',
    ]);
  });

  it.each([
    [undefined],
    [''],
    ['*'],
    ['portal.bnerd.com'],
    ['https://portal.bnerd.com/path'],
    ['https://*.bnerd.com'],
    ["https://a.com; script-src 'none'"],
  ])('refuses %s', (raw) => {
    expect(parseFrameAncestors(raw)).toEqual([]);
  });
});

describe('frameHeaders', () => {
  it('refuses framing when no origin is configured', () => {
    expect(frameHeaders([])).toEqual({ 'X-Frame-Options': 'DENY' });
  });

  it('allows only the configured origins, including the microphone', () => {
    const headers = frameHeaders(['https://portal.bnerd.com']);
    expect(headers['X-Frame-Options']).toBeUndefined();
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self' https://portal.bnerd.com");
    expect(headers['Permissions-Policy']).toContain('microphone=(self "https://portal.bnerd.com")');
  });
});

import { describe, it, expect } from 'vitest';
import { parseAcquisitionSrc, SRC_MAX_LENGTH, SRC_PARAM, SRC_PATTERN } from '../acquisition-src';
import { attributionFromUrl } from '../attribution';
import { countBySrc } from '../marketing/signups-by-src';

// The site (xhybrid-dev/hybridx-web-x) declares the same rule in
// src/lib/app-links.ts and pins it in src/lib/__tests__/cross-repo-agreement.test.ts.
// These are the literal values it asserts; if one changes here, it fails there
// only once someone runs it, so change both in the same piece of work.
describe('src agrees with hybridx.club', () => {
  it('uses the same parameter, pattern and length', () => {
    expect(SRC_PARAM).toBe('src');
    expect(SRC_PATTERN.source).toBe('^[a-z0-9]+(?:-[a-z0-9]+)*$');
    expect(SRC_MAX_LENGTH).toBe(90);
  });

  it('accepts every shape the site sends', () => {
    for (const src of ['guide-sled-push-technique', 'page-home', 'page-calculators-week-planner', 'page-app']) {
      expect(parseAcquisitionSrc(src)).toBe(src);
    }
  });

  it('drops anything else rather than repairing it', () => {
    for (const bad of ['', 'Guide-x', 'guide_x', 'guide--x', '-guide', 'guide-', 'a b', 'x'.repeat(91), 42, null, undefined]) {
      expect(parseAcquisitionSrc(bad)).toBeUndefined();
    }
    expect(parseAcquisitionSrc('x'.repeat(90))).toBe('x'.repeat(90));
  });
});

describe('attributionFromUrl', () => {
  const now = new Date('2026-11-11T09:00:00Z');

  it('records a src from the site with no UTM tags at all', () => {
    expect(attributionFromUrl('?src=guide-wall-balls', '/signup', 'https://hybridx.club/', now)).toEqual({
      src: 'guide-wall-balls',
      landingPage: '/signup',
      referrer: 'https://hybridx.club/',
      capturedAt: now.toISOString(),
    });
  });

  it('keeps UTM tags and src side by side', () => {
    const a = attributionFromUrl('?utm_source=newsletter&utm_campaign=c1&src=page-home', '/', '', now);
    expect(a).toMatchObject({ utmSource: 'newsletter', utmCampaign: 'c1', src: 'page-home' });
    expect(a).not.toHaveProperty('referrer');
  });

  it('records nothing for a bare visit, or a src that is not ours', () => {
    expect(attributionFromUrl('', '/', '', now)).toBeNull();
    expect(attributionFromUrl('?src=<script>', '/', '', now)).toBeNull();
    expect(attributionFromUrl('?utm_source=', '/', '', now)).toBeNull();
  });
});

describe('countBySrc', () => {
  it('counts sign-ups, trials and paying per src, and skips what is not a src', () => {
    expect(
      countBySrc([
        { src: 'guide-a', status: 'trial' },
        { src: 'guide-a', status: 'active' },
        { src: 'guide-a', status: 'expired' },
        { src: 'page-home', status: 'trial' },
        { src: null, status: 'active' },
        { src: 'Not Ours', status: 'active' },
      ]),
    ).toEqual({
      'guide-a': { signups: 3, trials: 1, paying: 1 },
      'page-home': { signups: 1, trials: 1, paying: 0 },
    });
  });
});

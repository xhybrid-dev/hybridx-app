import { describe, it, expect } from 'vitest';
import { describeContract, leadPayloadSchema, normaliseUtm } from '../bridge-contract';

describe('normaliseUtm — the drift this contract exists to stop', () => {
  it('reads the prefixed spelling a query string carries', () => {
    expect(
      normaliseUtm({
        utm_source: 'instagram',
        utm_medium: 'social',
        utm_campaign: 'spring',
        utm_term: 'hyrox',
        utm_content: 'story-2',
      }),
    ).toEqual({
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: 'hyrox',
      utmContent: 'story-2',
    });
  });

  it('reads the bare spelling a form handler produces after stripping the prefix', () => {
    // This is the exact shape the marketing site was sending while this app
    // read utm_source — so every lead's attribution was silently discarded.
    // If this test fails, that bug is back.
    expect(
      normaliseUtm({
        source: 'instagram',
        medium: 'social',
        campaign: 'spring',
        term: 'hyrox',
        content: 'story-2',
      }),
    ).toEqual({
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: 'hyrox',
      utmContent: 'story-2',
    });
  });

  it('prefers the prefixed spelling when a caller sends both', () => {
    const result = normaliseUtm({ utm_source: 'raw', source: 'parsed' });
    expect(result?.utmSource).toBe('raw');
  });

  it('drops empty strings so "arrived directly" is not stored as attribution', () => {
    // A form rendering five hidden UTM inputs submits five empty strings when
    // the visitor came direct. Storing those makes "no attribution" and
    // "attributed to nothing" indistinguishable in every later report.
    expect(normaliseUtm({ utm_source: '', utm_medium: '   ' })).toBeUndefined();
  });

  it('keeps a partial attribution rather than discarding the whole thing', () => {
    expect(normaliseUtm({ utm_source: 'newsletter', utm_medium: '' })).toEqual({
      utmSource: 'newsletter',
    });
  });

  it('omits absent keys entirely rather than setting them to undefined', () => {
    // Not cosmetic. The Admin SDK is initialised without
    // ignoreUndefinedProperties, so one undefined value makes the attribution
    // write throw — and that write happens inside captureLead, whose catch
    // would report the whole capture as a 500 and skip event emission. A lead
    // with a single UTM (the common case) would lose its welcome sequence.
    const result = normaliseUtm({ utm_source: 'instagram' })!;
    expect(Object.keys(result)).toEqual(['utmSource']);
    expect(Object.values(result).every((v) => v !== undefined)).toBe(true);
  });

  it('survives a non-string value rather than failing the payload', () => {
    const result = normaliseUtm({ utm_source: 'ig', utm_medium: null as unknown as string });
    expect(result).toEqual({ utmSource: 'ig' });
  });

  it('returns undefined when there was no utm object at all', () => {
    expect(normaliseUtm(undefined)).toBeUndefined();
  });

  it('caps a single value so one caller cannot write an unbounded field', () => {
    const result = normaliseUtm({ utm_campaign: 'x'.repeat(500) });
    expect(result?.utmCampaign?.length).toBe(200);
  });
});

describe('leadPayloadSchema', () => {
  const valid = { email: 'athlete@hybridx.club' };

  it('accepts a minimal payload — only the address is required', () => {
    expect(leadPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a full payload from a funnel', () => {
    const result = leadPayloadSchema.safeParse({
      email: 'athlete@hybridx.club',
      name: 'Sam Taylor',
      source: 'spring-hyrox-challenge',
      consent: true,
      consentMethod: 'landing-form',
      utm: { utm_source: 'instagram' },
      tags: ['promo:spring', 'interest:doubles'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing address, which is the one thing it cannot work without', () => {
    expect(leadPayloadSchema.safeParse({}).success).toBe(false);
  });

  it('drops a tag claiming an origin — the route comes from the authenticated caller', () => {
    const result = leadPayloadSchema.safeParse({ ...valid, tags: ['route:magnet-vo2max', 'ok'] });
    expect(result.success && result.data.tags).toEqual(['ok']);
  });

  it('drops malformed tags but keeps the lead', () => {
    // Filtering, not rejecting. A sixth tag or one stray capital used to fail
    // the whole payload — and since the forward is fire-and-forget, nobody
    // would have seen the 400s. A cosmetic mistake must cost a tag, not a lead.
    const result = leadPayloadSchema.safeParse({
      ...valid,
      tags: ['Uppercase', 'has space', 'has/slash', 'x'.repeat(41), 'good:tag'],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.tags).toEqual(['good:tag']);
  });

  it('caps the number of tags one call may apply, without failing', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = leadPayloadSchema.safeParse({ ...valid, tags: seven });
    expect(result.success).toBe(true);
    expect(result.success && result.data.tags).toHaveLength(5);
  });

  it('does not fail a payload whose utm carries a non-string value', () => {
    const result = leadPayloadSchema.safeParse({ ...valid, utm: { utm_source: 'ig', n: 4 } });
    expect(result.success).toBe(true);
  });

  it('leaves consent undefined when unstated, so the route decides', () => {
    const result = leadPayloadSchema.safeParse(valid);
    expect(result.success && result.data.consent).toBeUndefined();
  });

  it('rejects a non-boolean consent rather than coercing it', () => {
    // 'true' as a string coercing to true would be a consent record created by
    // a type confusion, which is the one place guessing is unacceptable.
    expect(leadPayloadSchema.safeParse({ ...valid, consent: 'true' }).success).toBe(false);
  });

  it('accepts the consent posture a double opt-in funnel declares', () => {
    const result = leadPayloadSchema.safeParse({ ...valid, consentPolicy: 'confirmed' });
    expect(result.success && result.data.consentPolicy).toBe('confirmed');
  });

  it('rejects a posture it does not know rather than storing it', () => {
    // A route's posture decides whether the console warns that a funnel has no
    // journey attached. An unrecognised value silently stored would be worse
    // than the absence it replaces.
    expect(leadPayloadSchema.safeParse({ ...valid, consentPolicy: 'double' }).success).toBe(false);
  });

  it('leaves the posture undefined when unstated, so the old inference applies', () => {
    // Additive and optional: a funnel deployed before this field existed keeps
    // working exactly as it did.
    const result = leadPayloadSchema.safeParse(valid);
    expect(result.success && result.data.consentPolicy).toBeUndefined();
  });
});

describe('describeContract — what a future funnel reads instead of guessing', () => {
  it('documents every field the schema actually accepts', () => {
    const documented = Object.keys(describeContract().fields).sort();
    const accepted = Object.keys(leadPayloadSchema.shape).sort();
    expect(documented).toEqual(accepted);
  });

  it('states how to authenticate', () => {
    expect(describeContract().auth).toContain('LEAD_BRIDGE_SECRET');
  });
});

describe('src (1.3.0)', () => {
  it('carries where on hybridx.club the address was left', () => {
    const parsed = leadPayloadSchema.parse({ email: 'a@b.com', src: 'guide-sled-push-technique' });
    expect(parsed.src).toBe('guide-sled-push-technique');
  });

  it('drops a src that is not one of ours, and keeps the lead', () => {
    for (const src of ['Guide X', 'guide_x', 42, null, 'x'.repeat(91)]) {
      const parsed = leadPayloadSchema.safeParse({ email: 'a@b.com', src });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.src).toBeUndefined();
    }
  });

  it('is documented on the contract endpoint', () => {
    expect(describeContract().fields).toHaveProperty('src');
  });
});

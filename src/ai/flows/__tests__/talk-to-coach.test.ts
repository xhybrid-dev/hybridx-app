import { describe, expect, it, vi } from 'vitest';

// The helpers under test are pure; keep the model and the database out of it.
vi.mock('@/ai/genkit', () => ({ ai: { generate: vi.fn() }, MODELS: { fast: 'fast' } }));
vi.mock('@/ai/coach-tools', () => ({ buildCoachTools: vi.fn() }));
vi.mock('@/services/coach-context', () => ({ buildCoachContext: vi.fn() }));

describe('describeForModel', () => {
  it('marks voice notes and the session a message was about', async () => {
    const { describeForModel } = await import('@/ai/flows/coach-chat');

    expect(describeForModel('legs were gone', 'voice', 'Engine Builder')).toBe(
      '[Voice note, about "Engine Builder"] legs were gone',
    );
    expect(describeForModel('ill this week', 'voice')).toBe('[Voice note] ill this week');
    expect(describeForModel('how is my week looking?', 'text')).toBe('how is my week looking?');
  });
});

describe('normaliseVoiceMimeType', () => {
  it('accepts what browsers record in, without codec parameters', async () => {
    const { normaliseVoiceMimeType } = await import('@/ai/flows/transcribe-voice-note');

    expect(normaliseVoiceMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normaliseVoiceMimeType('audio/mp4')).toBe('audio/mp4');
    expect(normaliseVoiceMimeType('AUDIO/OGG; codecs=opus')).toBe('audio/ogg');
  });

  it('refuses anything that is not audio we take', async () => {
    const { normaliseVoiceMimeType } = await import('@/ai/flows/transcribe-voice-note');

    expect(normaliseVoiceMimeType('video/mp4')).toBeNull();
    expect(normaliseVoiceMimeType('')).toBeNull();
    expect(normaliseVoiceMimeType(undefined)).toBeNull();
  });
});

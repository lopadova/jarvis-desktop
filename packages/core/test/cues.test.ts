import { describe, expect, it } from 'vitest';
import { dialectFor, renderCues, SentenceChunker, speakable, stripCues } from '../src/index.js';

describe('cues', () => {
  it('maps neutral cues per provider', () => {
    const t = '[happy] Done! [laugh] the footer behaved. [pause] Anything else?';
    expect(renderCues(t, 'fish')).toBe('[happy] Done! [laughing] the footer behaved. [break] Anything else?');
    expect(renderCues(t, 'elevenlabs-v3')).toBe(
      '[happy] Done! [laughs] the footer behaved. [short pause] Anything else?',
    );
    expect(stripCues(t)).toBe('Done! the footer behaved. Anything else?');
  });
  it('drops unknown cues and caps at three', () => {
    expect(renderCues('[evil laugh] hi', 'fish')).toBe('hi');
    expect(renderCues('[happy] a [laugh] b [sigh] c [pause] d', 'fish')).toBe('[happy] a [laughing] b [sighing] c d');
  });
  it('dialect selection', () => {
    expect(dialectFor('elevenlabs', 'eleven_flash_v2_5')).toBe('none');
    expect(dialectFor('elevenlabs', 'eleven_v3')).toBe('elevenlabs-v3');
    expect(dialectFor('piper')).toBe('none');
  });
  it('speakable strips markdown', () => {
    expect(speakable('**Done**\n- one\n- two\n`code`')).toBe('Done one two code');
  });
  it('chunks sentences for streaming', () => {
    const c = new SentenceChunker();
    expect(c.push('Hello there. How ')).toEqual(['Hello there.']);
    expect(c.push('are you? I am')).toEqual(['How are you?']);
    expect(c.push(' fine, e.g. ok')).toEqual([]);
    expect(c.flush()).toBe('I am fine, e.g. ok');
  });
});

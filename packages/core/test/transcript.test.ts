import { describe, expect, it } from 'vitest';
import { isNonSpeech } from '../src/voice/transcript.js';

describe('isNonSpeech', () => {
  it('treats Whisper silence/noise tags as not speech', () => {
    for (const t of [
      '',
      '  ',
      '[BLANK_AUDIO]',
      ' [BLANK_AUDIO] ',
      '(silence)',
      '[Music]',
      '*sighs*',
      '♪♪',
      '[ Silence ]  .',
      '(music) [applause]',
    ]) {
      expect(isNonSpeech(t), JSON.stringify(t)).toBe(true);
    }
  });

  it('keeps real speech, including speech that mentions a tag', () => {
    for (const t of ['what time is it', 'Jarvis, stop', 'play [music] now', 'è tardi (davvero)', '7.45 pm']) {
      expect(isNonSpeech(t), JSON.stringify(t)).toBe(false);
    }
  });
});

import { isSelfEcho } from '../src/voice/transcript.js';

describe('isSelfEcho', () => {
  const said = ['Sorry, I didn’t catch that. Could you repeat it?', "It's 14:05."];

  it('recognises Jarvis hearing itself, even when Whisper garbles a word', () => {
    expect(isSelfEcho("Sorry, he didn't want to catch that. Could you repeat it?", said)).toBe(true);
    expect(isSelfEcho('sorry I didn’t catch that', said)).toBe(true);
  });

  it('lets real user speech through, including short commands', () => {
    expect(isSelfEcho('stop', said)).toBe(false);
    expect(isSelfEcho('yes', said)).toBe(false);
    expect(isSelfEcho('add milk to the shopping list', said)).toBe(false);
    expect(isSelfEcho('what time is it', ["It's 14:05."])).toBe(false);
    expect(isSelfEcho('anything at all here', [])).toBe(false);
  });
});

import { matchWakeUtterance } from '../src/voice/transcript.js';

describe('matchWakeUtterance', () => {
  it('finds the wake word, however Whisper spells it', () => {
    for (const t of [
      'Jarvis',
      'Giarvis',
      'jarvis.',
      'Iarvis,',
      'Jervis',
      'Yarvis',
      'Garvis',
      'Hey Jarvis',
      'Ehi Giarvis',
      'OK Jarvis!',
      '"Jarvis"',
    ]) {
      expect(matchWakeUtterance(t), t).toEqual({ matched: true, rest: '' });
    }
  });

  it('returns the command that follows the wake word', () => {
    expect(matchWakeUtterance('Jarvis Choresono')).toEqual({ matched: true, rest: 'Choresono' });
    expect(matchWakeUtterance('Jarvis, che ore sono?')).toEqual({ matched: true, rest: 'che ore sono?' });
    expect(matchWakeUtterance('Hey Jarvis: what time is it')).toEqual({ matched: true, rest: 'what time is it' });
  });

  it('ignores ordinary speech, including the word in the middle of a sentence', () => {
    for (const t of [
      'che ore sono',
      'ask Jarvis later',
      'the service was fine',
      'servizio',
      'I think so',
      'Harvey',
      'marvelous',
      '',
      '[Musica]',
    ]) {
      expect(matchWakeUtterance(t).matched, t).toBe(false);
    }
  });
});

import { matchFastIntent } from '../src/router/fastpath.js';

describe('local time question (Whisper spells it both ways)', () => {
  it('answers locally for "che ora sono" and "che ore sono" and the English forms', () => {
    for (const t of [
      'che ora sono',
      'Che ore sono?',
      'che ora è',
      'che ore sono adesso',
      'what time is it',
      'What time is it now?',
    ]) {
      expect(matchFastIntent(t), t).toEqual({ kind: 'time' });
    }
    expect(matchFastIntent('che ora sono i miei')).toBeNull();
  });
});

describe('Whisper hallucinations on silence', () => {
  it('are not speech', () => {
    for (const t of [
      '(speaking in foreign language)',
      '[Sottotitoli e ris',
      '[Sottotitoli e revisione a cura di QTSS]',
      'Thanks for watching!',
      'Subtitles by the Amara.org community',
      'Grazie per la visione.',
    ]) {
      expect(isNonSpeech(t), t).toBe(true);
    }
    expect(isNonSpeech('thanks, that is all for today')).toBe(false);
  });
});

import { nearWakeWord } from '../src/voice/transcript.js';

describe('nearWakeWord', () => {
  it('reports first words that look like the wake word', () => {
    expect(nearWakeWord('Garvis che ore sono')).toBe('garvis');
    expect(nearWakeWord('Javis')).toBe('javis');
  });

  it('ignores everything else', () => {
    for (const t of ['che ore sono', 'buongiorno a tutti', 'sì', 'terminale', '']) {
      expect(nearWakeWord(t), t).toBeNull();
    }
  });
});

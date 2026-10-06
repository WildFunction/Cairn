import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SHELL_SETTINGS, parseSettings, VOICES, voiceFor,
} from '../../src/shared/settings';

describe('parseSettings', () => {
  test('nothing stored yet falls back whole', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SHELL_SETTINGS);
  });

  test('narration follows the book by default', () => {
    expect(DEFAULT_SHELL_SETTINGS.narration).toBe('follow');
  });

  test('the Chinese default is the voice every existing book was built with', () => {
    // Changing this silently re-keys every book that never chose a voice
    expect(DEFAULT_SHELL_SETTINGS.voices.zh).toBe('zh-CN-YunjianNeural');
  });

  test('keeps a valid record', () => {
    const stored = {
      providers: { openai: { apiKey: 'sk-x', baseUrl: 'https://example.test/v1', model: 'gpt-5.4-mini' } },
      generationProvider: 'openai',
      chatProvider: 'inherit',
      narration: 'en',
      voices: { en: 'en-US-AvaNeural', zh: 'zh-CN-XiaoxiaoNeural' },
      searchProvider: 'firecrawl',
      braveKey: 'brave-x',
      firecrawlKey: 'fire-x',
      tavilyKey: 'tvly-x',
      wereadKey: 'wrk-x',
      wereadAccount: '读者',
      trace: true,
      icloudSync: true,
    };
    expect(parseSettings(stored)).toEqual(stored);
  });

  test('nothing is configured until the reader configures it', () => {
    expect(DEFAULT_SHELL_SETTINGS.providers).toEqual({});
    expect(DEFAULT_SHELL_SETTINGS.chatProvider).toBe('inherit');
  });

  test('a provider this build does not know is dropped, not stored', () => {
    expect(parseSettings({ providers: { nope: { apiKey: 'x' } } }).providers).toEqual({});
    expect(parseSettings({ generationProvider: 'nope' }).generationProvider)
      .toBe(DEFAULT_SHELL_SETTINGS.generationProvider);
    expect(parseSettings({ chatProvider: 'nope' }).chatProvider).toBe('inherit');
  });

  test('every provider keeps its own key', () => {
    const parsed = parseSettings({
      providers: {
        openai: { apiKey: 'openai-key', baseUrl: '', model: '' },
        anthropic: { apiKey: 'anthropic-key', baseUrl: '', model: '' },
      },
      chatProvider: 'anthropic',
    });
    expect(parsed.providers.openai?.apiKey).toBe('openai-key');
    expect(parsed.providers.anthropic?.apiKey).toBe('anthropic-key');
    expect(parsed.chatProvider).toBe('anthropic');
  });

  test('a reader without a search key gets keyless web search by default', () => {
    expect(parseSettings({}).searchProvider).toBe('firecrawl');
  });

  test('persists Tavily selection and rejects an unknown search provider', () => {
    expect(parseSettings({ searchProvider: 'tavily' }).searchProvider).toBe('tavily');
    expect(parseSettings({ searchProvider: 'brave' }).searchProvider).toBe('brave');
    expect(parseSettings({ searchProvider: 'unknown' }).searchProvider).toBe('firecrawl');
  });

  test('an older saved Tavily key keeps its search destination after upgrade', () => {
    expect(parseSettings({ tavilyKey: 'old-key' }).searchProvider).toBe('tavily');
    expect(parseSettings({ searchProvider: 'keenable', tavilyKey: 'old-key' }).searchProvider).toBe('firecrawl');
    expect(parseSettings({ searchProvider: 'keenable' }, { ...DEFAULT_SHELL_SETTINGS, searchProvider: 'tavily' }).searchProvider)
      .toBe('firecrawl');
  });

  test('a providers block that is not an object falls back whole', () => {
    expect(parseSettings({ providers: 'openai' }).providers).toEqual({});
  });

  /**
   * Empty is meaningful for all three: read the environment, use the catalog's
   * endpoint, use the provider's default model. Coercing them would silently pin
   * a value the reader never chose.
   */
  test('empty key, endpoint and model are kept, not defaulted', () => {
    const parsed = parseSettings({ providers: { openai: { apiKey: '', baseUrl: '', model: '' } } });
    expect(parsed.providers.openai).toEqual({ apiKey: '', baseUrl: '', model: '' });
  });

  /**
   * A voice id that no longer exists would fail at synthesis — which happens
   * *after* a model call has been paid for. Rejecting it here is the cheap end.
   */
  test('a voice this build does not ship is not honoured', () => {
    const parsed = parseSettings({ voices: { zh: 'zh-CN-GoneNeural', en: 'nope' } });
    expect(parsed.voices.zh).toBe(DEFAULT_SHELL_SETTINGS.voices.zh);
    expect(parsed.voices.en).toBe(DEFAULT_SHELL_SETTINGS.voices.en);
  });

  test('a voice from the wrong language list is not honoured either', () => {
    // en-US-AndrewNeural is real, but not a Chinese voice
    expect(parseSettings({ voices: { zh: 'en-US-AndrewNeural' } }).voices.zh)
      .toBe(DEFAULT_SHELL_SETTINGS.voices.zh);
  });

  test.each(['sometimes', '', 'ja', 42, null])(
    'a narration language of %p is not honoured',
    (narration) => {
      expect(parseSettings({ narration }).narration).toBe(DEFAULT_SHELL_SETTINGS.narration);
    },
  );

  test('a stored default budget is read and dropped', () => {
    // The budget belongs to one book, chosen when it is added. A remembered rung
    // was a second answer that went stale as soon as a shorter book arrived.
    expect(parseSettings({ defaultBudget: 'solid' })).not.toHaveProperty('defaultBudget');
  });

  test('an empty key is kept, because it means “read the environment”', () => {
    expect(parseSettings({ tavilyKey: '' }).tavilyKey).toBe('');
  });

  // Wrapped in objects: `test.each` spreads a bare array into zero arguments
  test.each([
    { value: 'nonsense' }, { value: 42 }, { value: [] }, { value: true },
  ])('$value is not a settings record', ({ value }) => {
    expect(parseSettings(value)).toEqual(DEFAULT_SHELL_SETTINGS);
  });
});

/**
 * A settings file written before the provider registry existed.
 *
 * Losing a key here looks exactly like the panel quietly forgetting what the
 * reader typed, and they would have no way to tell it apart from a bug in the
 * field itself.
 */
describe('parseSettings — migration from the pre-registry shape', () => {
  test('an API-key generation route becomes the OpenAI provider', () => {
    const parsed = parseSettings({
      model: { source: 'key', apiKey: 'sk-old', baseUrl: '', model: 'gpt-4o-mini' },
      chatModel: { source: 'inherit', apiKey: '', model: '' },
    });
    expect(parsed.generationProvider).toBe('openai');
    expect(parsed.providers.openai).toEqual({ apiKey: 'sk-old', baseUrl: '', model: 'gpt-4o-mini' });
    expect(parsed.chatProvider).toBe('inherit');
  });

  test('an empty old route stores nothing rather than an empty profile', () => {
    // The commonest real file: the key route selected, nothing typed into it yet
    const parsed = parseSettings({
      model: { source: 'key', apiKey: '', baseUrl: '', model: '' },
      chatModel: { source: 'inherit', apiKey: '', model: '' },
    });
    expect(parsed.providers).toEqual({});
  });

  test('a base URL that was not OpenAI’s becomes the custom provider', () => {
    // There was no other way to name a third-party endpoint in the old shape
    const parsed = parseSettings({
      model: { source: 'key', apiKey: 'sk-old', baseUrl: 'https://proxy.test/v1', model: 'local' },
    });
    expect(parsed.generationProvider).toBe('custom');
    expect(parsed.providers.custom)
      .toEqual({ apiKey: 'sk-old', baseUrl: 'https://proxy.test/v1', model: 'local' });
  });

  test('the Codex route leaves generation unconfigured rather than inventing a key', () => {
    const parsed = parseSettings({ model: { source: 'codex', apiKey: '', baseUrl: '', model: '' } });
    expect(parsed.providers).toEqual({});
    expect(parsed.generationProvider).toBe(DEFAULT_SHELL_SETTINGS.generationProvider);
  });

  test('a Companion vendor becomes that provider, keeping its own key', () => {
    const parsed = parseSettings({
      model: { source: 'key', apiKey: 'generation-key', baseUrl: '', model: '' },
      chatModel: { source: 'deepseek', apiKey: 'chat-key', model: 'deepseek-v4-pro' },
    });
    expect(parsed.chatProvider).toBe('deepseek');
    expect(parsed.providers.deepseek)
      .toEqual({ apiKey: 'chat-key', baseUrl: '', model: 'deepseek-v4-pro' });
    // and generation is untouched by it
    expect(parsed.providers.openai?.apiKey).toBe('generation-key');
    expect(parsed.generationProvider).toBe('openai');
  });

  test('a Companion vendor this build dropped does not become a provider', () => {
    const parsed = parseSettings({ chatModel: { source: 'unknown', apiKey: 'x' } });
    expect(parsed.chatProvider).toBe('inherit');
    expect(parsed.providers).toEqual({});
  });

  // The new shape wins outright, or a stale `model` block would keep resurrecting
  test('a file already in the new shape ignores any leftover old block', () => {
    const parsed = parseSettings({
      providers: { anthropic: { apiKey: 'new-key', baseUrl: '', model: '' } },
      generationProvider: 'anthropic',
      model: { source: 'key', apiKey: 'stale', baseUrl: '', model: '' },
    });
    expect(parsed.generationProvider).toBe('anthropic');
    expect(parsed.providers.openai).toBeUndefined();
  });
});

describe('voiceFor', () => {
  const settings = {
    ...DEFAULT_SHELL_SETTINGS,
    voices: { en: 'en-US-AvaNeural', zh: 'zh-CN-XiaoxiaoNeural' },
  };

  test('following the book uses the book’s own language', () => {
    expect(voiceFor({ ...settings, narration: 'follow' }, 'zh'))
      .toEqual({ locale: 'zh', voice: 'zh-CN-XiaoxiaoNeural' });
    expect(voiceFor({ ...settings, narration: 'follow' }, 'en'))
      .toEqual({ locale: 'en', voice: 'en-US-AvaNeural' });
  });

  /** Forcing a language is the reader's call, and it overrides the book. */
  test('forcing a language overrides the book', () => {
    expect(voiceFor({ ...settings, narration: 'en' }, 'zh'))
      .toEqual({ locale: 'en', voice: 'en-US-AvaNeural' });
  });

  test('every shipped voice id belongs to its own language list', () => {
    expect(VOICES.zh.every((v) => v.id.startsWith('zh-'))).toBe(true);
    expect(VOICES.en.every((v) => v.id.startsWith('en-'))).toBe(true);
  });

  test('both defaults are ids this build actually ships', () => {
    expect(VOICES.en.some((v) => v.id === DEFAULT_SHELL_SETTINGS.voices.en)).toBe(true);
    expect(VOICES.zh.some((v) => v.id === DEFAULT_SHELL_SETTINGS.voices.zh)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { AssistantMessage, Tool } from '@earendil-works/pi-ai';
import { resolveJsonSchemaStrictSampling } from '@earendil-works/pi-ai/api/constrained-sampling';
import { forcedToolChoice, piLlmProvider, type PiRegistry } from '../../src/main/pi-provider';

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
} as const;

const variantOf = (kind: string) => ({
  type: 'object',
  properties: { kind: { type: 'string', const: kind } },
  required: ['kind'],
  additionalProperties: false,
});

/** The shape of a slide: one of several objects. */
const UNION_SCHEMA = {
  type: 'object',
  properties: { slide: { anyOf: [variantOf('a'), variantOf('b')] } },
  required: ['slide'],
  additionalProperties: false,
} as const;

/** A provider wired to a scripted reply, standing in for a real vendor. */
function scripted(replies: AssistantMessage[]): {
  build: (id: string, modelId: string, baseUrl?: string) => PiRegistry;
  seen: { context?: unknown; options?: unknown };
} {
  const seen: { context?: unknown; options?: unknown } = {};
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  faux.setResponses(replies.map((reply) => (context, options) => {
    seen.context = context;
    seen.options = options;
    return reply;
  }));

  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel('faux', 'faux-1')!;
  return { build: () => ({ models, model }) as PiRegistry, seen };
}

function provider(replies: AssistantMessage[], seenOut?: { value?: unknown }) {
  const { build, seen } = scripted(replies);
  if (seenOut) seenOut.value = seen;
  return {
    llm: piLlmProvider({ providerId: 'openai', apiKey: 'k', model: 'faux-1', build: build as never }),
    seen,
  };
}

describe('piLlmProvider', () => {
  test('a schema comes back as the tool call’s arguments', async () => {
    const { llm } = provider([
      fauxAssistantMessage([fauxToolCall('emit', { title: 'Anchoring' })], { stopReason: 'toolUse' }),
    ]);

    const raw = await llm.complete({ prompt: 'p', schema: SCHEMA });
    expect(JSON.parse(raw)).toEqual({ title: 'Anchoring' });
  });

  // `ToolChoice` is typed 'auto' | 'none', but every adapter accepts a forcing
  // value. Without it the model is merely invited, and a decline once in a
  // hundred calls is a parse error nobody can reproduce.
  test('a schema forces the tool call', async () => {
    const { llm, seen } = provider([
      fauxAssistantMessage([fauxToolCall('emit', { title: 'x' })], { stopReason: 'toolUse' }),
    ]);

    await llm.complete({ prompt: 'p', schema: SCHEMA });
    expect((seen.options as { toolChoice?: string }).toolChoice).toBeDefined();
  });

  test('no schema means no tool and no forcing', async () => {
    const { llm, seen } = provider([fauxAssistantMessage('plain words')]);

    expect(await llm.complete({ prompt: 'p' })).toBe('plain words');
    expect((seen.options as { toolChoice?: string }).toolChoice).toBeUndefined();
  });

  /**
   * Defensive, not expected. If an adapter ever stops forcing, behaviour falls
   * back to what the old HTTP path did rather than throwing.
   */
  test('text instead of a tool call still returns the text', async () => {
    const { llm } = provider([fauxAssistantMessage([fauxText('{"title":"x"}')])]);
    expect(await llm.complete({ prompt: 'p', schema: SCHEMA })).toBe('{"title":"x"}');
  });

  /**
   * `completeSimple` resolves an error rather than rejecting. Not checking
   * `stopReason` would read a failed call as an empty reply and report a
   * nonsensical JSON error.
   */
  test('a provider error becomes provider_failed, not an empty reply, and names who refused', async () => {
    const { llm } = provider([
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'rate limited' }),
    ]);

    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({
      code: 'provider_failed', detail: 'openai: rate limited',
    });
  });

  test('a call that throws names who failed too', async () => {
    const { model } = scripted([]).build('faux', 'faux-1');
    const throwing = { completeSimple: async () => { throw new Error('ECONNREFUSED'); } };
    const llm = piLlmProvider({
      providerId: 'openai', apiKey: 'k', model: 'faux-1',
      build: (() => ({ models: throwing, model })) as never,
    });

    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({
      code: 'provider_failed', detail: 'openai: Error: ECONNREFUSED',
    });
  });

  // The old HTTP path never read `finish_reason`, so truncation surfaced as
  // "not valid JSON" — true, and useless.
  test('truncation says it was truncated', async () => {
    const { llm } = provider([fauxAssistantMessage([fauxText('{"tit')], { stopReason: 'length' })]);
    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({ code: 'bad_output' });
  });

  // `job.ts` and `scheduler.ts` tell a stop from a failure by `signal.aborted`
  test('the caller’s abort maps to aborted', async () => {
    const { llm } = provider([fauxAssistantMessage([], { stopReason: 'aborted' })]);
    const controller = new AbortController();
    controller.abort();

    await expect(llm.complete({ prompt: 'p', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' });
  });

  test('an abort with no caller signal is the timeout, not a cancellation', async () => {
    const { llm } = provider([fauxAssistantMessage([], { stopReason: 'aborted' })]);
    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({ code: 'timeout' });
  });

  test('an empty reply is reported rather than passed on', async () => {
    const { llm } = provider([fauxAssistantMessage([])]);
    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({ code: 'bad_output' });
  });

  test('an unknown provider fails before any request', async () => {
    const llm = piLlmProvider({
      providerId: 'openai', apiKey: 'k', model: 'nope', build: () => undefined,
    });
    await expect(llm.complete({ prompt: 'p' })).rejects.toMatchObject({ code: 'provider_failed' });
  });

  // Two layers of backoff multiply, and the progress pane cannot say what it is
  // waiting for. Retries belong to `runJob`, which shows them.
  test('pi-ai’s own retry is disabled', async () => {
    const { llm, seen } = provider([fauxAssistantMessage('ok')]);
    await llm.complete({ prompt: 'p' });
    expect((seen.options as { maxRetryDelayMs?: number }).maxRetryDelayMs).toBe(0);
  });

  // Every deck failed on DeepSeek: a slide is a union of objects, which pi-ai
  // cannot make strict, and `require` turned that into a thrown error.
  test('a schema pi-ai cannot make strict still reaches a strict model', async () => {
    const faux = fauxProvider({ provider: 'deepseek', models: [{ id: 'deepseek-flash' }] });
    const seen: { tools?: readonly Tool[] } = {};
    faux.setResponses([(context) => {
      // faux reports the tools it was handed on the first message, not on `context.tools`
      seen.tools = (context.messages[0] as { toolsAdded?: readonly Tool[] }).toolsAdded;
      return fauxAssistantMessage([fauxToolCall('emit', { slide: { kind: 'a' } })], { stopReason: 'toolUse' });
    }]);
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('deepseek', 'deepseek-flash')!;
    const llm = piLlmProvider({
      providerId: 'deepseek', apiKey: 'k', model: 'deepseek-flash',
      build: () => ({ models, model }) as PiRegistry,
    });

    await llm.complete({ prompt: 'p', schema: UNION_SCHEMA });
    const [tool] = seen.tools ?? [];
    expect(() => resolveJsonSchemaStrictSampling(tool!, true)).not.toThrow();
  });

  test('the system prompt travels separately from the user prompt', async () => {
    const { llm, seen } = provider([fauxAssistantMessage('ok')]);
    await llm.complete({ prompt: 'the question', system: 'the rules' });

    const messages = JSON.stringify(seen.context);
    expect(messages).toContain('the question');
    expect(messages).toContain('the rules');
  });
});

/**
 * Each adapter spells "you must call the tool" differently, and the type omits
 * every forcing value — so this table is the only place the knowledge lives, and
 * nothing else would notice if it were wrong.
 */
describe('forcedToolChoice', () => {
  test.each([
    'openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses',
  ])('%s takes OpenAI’s `required`', (api) => {
    expect(forcedToolChoice(api)).toBe('required');
  });

  test.each([
    'anthropic-messages', 'google-generative-ai', 'google-vertex',
    'bedrock-converse-stream', 'mistral-conversations',
  ])('%s takes `any`', (api) => {
    expect(forcedToolChoice(api)).toBe('any');
  });
});

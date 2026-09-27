/**
 * The generation model, reached through pi-ai.
 *
 * One implementation for every vendor, because pi-ai already knows each one's
 * wire format and — the part that actually matters here — which of their models
 * will hold a reply to a JSON Schema. The pipeline asks for structured output on
 * roughly a hundred calls per book; guessing that per vendor is how a schema
 * quietly becomes a suggestion.
 *
 * pi-ai is a dependency of the app, never of `packages/core`, so this lives here
 * and reaches core only through `LlmProvider`.
 */
import {
  type Context, createModels, createProvider, type Model, type Tool,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { groqProvider } from '@earendil-works/pi-ai/providers/groq';
import { minimaxCnProvider } from '@earendil-works/pi-ai/providers/minimax-cn';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { LlmError, type LlmProvider, type LlmRequest } from '@cairn/core/llm';
import type { CodexCredentials } from '@cairn/core/runtime';
import type { ProviderId } from '../shared/providers';
import { codexRegistry } from './codex-provider';

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Measured on the OpenAI chat-completions shape (the since-removed `http-llm.ts`): a few
 * hundred tokens of envelope rather than the codex CLI's ~18k of agent harness.
 * These drive the map stage's batch size and the scheduler's concurrency, so they
 * are a real number and not decoration — `AssistantMessage.usage` reports the
 * true count and could refine them later.
 */
const OVERHEAD_TOKENS = 400;
const CONCURRENCY = 4;

/** The single tool the schema is carried on. */
const EMIT = 'emit';

const CUSTOM_PROVIDER = 'cairn-custom';

type Registry = ReturnType<typeof createModels>;

function providerFor(id: ProviderId): Parameters<Registry['setProvider']>[0] | undefined {
  switch (id) {
    case 'openai': return openaiProvider();
    case 'anthropic': return anthropicProvider();
    case 'google': return googleProvider();
    case 'deepseek': return deepseekProvider();
    case 'openrouter': return openrouterProvider();
    case 'groq': return groqProvider();
    case 'xai': return xaiProvider();
    case 'moonshotai': return moonshotaiProvider();
    case 'minimax': return minimaxProvider();
    case 'minimax-cn': return minimaxCnProvider();
    default: return undefined;
  }
}

/**
 * How to say "you must call the tool".
 *
 * `ToolChoice` is typed `'auto' | 'none'`, but every adapter forwards or maps a
 * forcing value; only the spelling differs. Without it the model is merely invited
 * to call the tool, and an invitation declined once in a hundred calls is a
 * parse error nobody can reproduce.
 */
export function forcedToolChoice(api: string): string {
  return api.startsWith('openai') || api.startsWith('azure-openai') ? 'required' : 'any';
}

export type PiRegistry = { models: Registry; model: Model<never> } | undefined;

export interface PiProviderConfig {
  readonly providerId: ProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  /** What `openai-codex` signs in with; unused by every other provider. */
  readonly codex?: CodexCredentials;
  readonly timeoutMs?: number;
  /**
   * Injected by tests. Without it every path here needs a real vendor and a real
   * key, which is the same reason `LlmProvider` exists one layer up.
   */
  readonly build?: (id: ProviderId, modelId: string, baseUrl?: string, codex?: CodexCredentials) => PiRegistry;
}

export function piLlmProvider(config: PiProviderConfig): LlmProvider {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Named: with no key set, the route may be a `codex login` the reader forgot about
  const failed = (detail: string): LlmError =>
    new LlmError('模型接口请求失败', 'provider_failed', `${config.providerId}: ${detail}`.slice(0, 300));

  return {
    name: `pi:${config.providerId}`,
    suggestedConcurrency: CONCURRENCY,
    overheadTokens: OVERHEAD_TOKENS,

    async complete(request: LlmRequest): Promise<string> {
      const { models, model } = resolve(config);

      // One controller for both reasons a call can end early, so the request sees
      // a single signal and the caller's abort is not lost behind the timeout's.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = (): void => controller.abort();
      request.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const reply = await models.completeSimple(model, context(request), {
          apiKey: config.apiKey,
          signal: controller.signal,
          maxTokens: model.maxTokens,
          // Retries belong to `runJob`, which shows them. Two layers of backoff
          // multiply, and the progress pane cannot say what it is waiting for.
          maxRetryDelayMs: 0,
          ...(request.schema ? { toolChoice: forcedToolChoice(model.api) as 'auto' } : {}),
        });

        if (reply.stopReason === 'aborted') {
          throw request.signal?.aborted
            ? new LlmError('调用已取消', 'aborted')
            : new LlmError('模型接口超时', 'timeout');
        }
        if (reply.stopReason === 'error') {
          throw failed(reply.errorMessage ?? '');
        }
        if (reply.stopReason === 'length') {
          // The old HTTP path never looked at this, so a truncated reply surfaced
          // as "not valid JSON" — true, and useless.
          throw new LlmError('模型输出超出长度上限被截断', 'bad_output', `maxTokens=${model.maxTokens}`);
        }

        return read(reply);
      } catch (cause) {
        if (cause instanceof LlmError) throw cause;
        if (request.signal?.aborted) throw new LlmError('调用已取消', 'aborted');
        if (controller.signal.aborted) throw new LlmError('模型接口超时', 'timeout');
        throw failed(String(cause));
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/**
 * A registry holding one provider, and the model to call on it.
 *
 * Shared with the companion so both halves of the app reach a vendor the same
 * way — one place that knows how a provider is built, rather than two that drift.
 */
export function piRegistry(
  providerId: ProviderId,
  modelId: string,
  baseUrl?: string,
  codex?: CodexCredentials,
): { models: Registry; model: Model<never> } | undefined {
  if (providerId === 'custom') return custom(modelId, baseUrl);
  if (providerId === 'openai-codex') return codex ? codexRegistry(modelId, codex) : undefined;

  const provider = providerFor(providerId);
  if (!provider) return undefined;

  const models = createModels();
  models.setProvider(provider);

  const found = models.getModel(provider.id, modelId);
  if (!found) return undefined;

  // A custom endpoint overrides the catalog's, and nothing else about the model
  return { models, model: (baseUrl ? { ...found, baseUrl } : found) as Model<never> };
}

/**
 * An endpoint the catalog has never heard of.
 *
 * Assumed to speak OpenAI chat-completions, which is what almost every
 * self-hosted server and gateway offers. Nothing is known about its models, so
 * the schema goes out as `prefer` and the panel says the constraint is unproven.
 */
function custom(modelId: string, baseUrl?: string): { models: Registry; model: Model<never> } | undefined {
  if (!baseUrl || !modelId) return undefined;

  const model = {
    id: modelId, name: modelId, api: 'openai-completions' as const, provider: CUSTOM_PROVIDER,
    baseUrl, reasoning: false, input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000, maxTokens: 8192,
  };

  const models = createModels();
  models.setProvider(createProvider({
    id: CUSTOM_PROVIDER, name: 'Custom endpoint', baseUrl,
    auth: { apiKey: { name: 'Configured API key', resolve: async ({ credential }) =>
      (credential?.key ? { auth: { apiKey: credential.key } } : undefined) } },
    models: [model], api: openAICompletionsApi(),
  }));
  return { models, model: model as unknown as Model<never> };
}

function resolve(config: PiProviderConfig): { models: Registry; model: Model<never> } {
  const built = (config.build ?? piRegistry)(config.providerId, config.model, config.baseUrl, config.codex);
  if (!built) {
    throw new LlmError(
      `提供方 ${config.providerId} 无法提供模型 ${config.model}`, 'provider_failed',
    );
  }
  return built;
}

function context(request: LlmRequest): Context {
  return {
    ...(request.system ? { systemPrompt: request.system } : {}),
    messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }],
    ...(request.schema
      ? {
        tools: [{
          name: EMIT,
          description: 'Call exactly once, passing the result as the arguments.',
          // A TypeBox schema *is* a JSON Schema object at runtime, and no adapter
          // validates it — `validateToolArguments` is an opt-in helper.
          parameters: request.schema as Tool['parameters'],
          // `prefer` is strict wherever pi-ai can make the schema strict. `require`
          // throws where it cannot — a slide is a union of objects, so every deck.
          constrainedSampling: { type: 'json_schema', strict: 'prefer' },
        }],
      }
      : {}),
  };
}

/**
 * The reply, whichever way it came back.
 *
 * The tool call is the normal path now that it is forced. The text fallback is
 * defensive: it should not fire, and if it does the downstream `parseJsonOutput`
 * behaves exactly as it did before pi-ai — so the worst case is the old one.
 */
function read(reply: { content: readonly unknown[] }): string {
  for (const part of reply.content) {
    const block = part as { type?: string; name?: string; arguments?: unknown };
    if (block.type === 'toolCall' && block.name === EMIT) {
      return JSON.stringify(block.arguments ?? {});
    }
  }

  const text = reply.content
    .map((part) => (part as { type?: string; text?: string }))
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');

  if (text.trim().length === 0) throw new LlmError('模型未返回内容', 'bad_output');
  return text;
}

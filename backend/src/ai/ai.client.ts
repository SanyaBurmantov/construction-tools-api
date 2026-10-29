import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import type { ChatMessage } from './ai-fields';

const REQUEST_TIMEOUT_MS = 120_000;
const MODELS_TTL_MS = 60 * 60 * 1000;

/**
 * Tried in order when the task's own model is unavailable. Free models come
 * and go on OpenRouter, so a hard-coded single id would rot; `openrouter/free`
 * is their own router over whatever free model is up right now.
 */
const FALLBACK_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
];

const FREE_MODEL = /(:free$)|(^openrouter\/free$)/;

/**
 * Who answers. DeepSeek (paid, direct, OpenAI-compatible) when
 * `DEEPSEEK_API_KEY` is set — the catalogue texts are written there; otherwise
 * OpenRouter's free models, which is what the screens were built on.
 */
type Provider = {
  id: 'deepseek' | 'openrouter';
  label: string;
  api: string;
  key: string;
  defaultModel: string;
  /** Which model ids a task may name — on OpenRouter only `:free` ones. */
  allows: (model: string) => boolean;
  /** How long to wait after a 429 with no reset header. */
  rateLimitPauseMs: number;
};

function provider(): Provider | null {
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseek) {
    return {
      id: 'deepseek',
      label: 'DeepSeek',
      api: process.env.DEEPSEEK_API_BASE?.trim() || 'https://api.deepseek.com',
      key: deepseek,
      defaultModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
      allows: (model) => /^deepseek-/.test(model),
      // A paid key is limited per minute, not per day.
      rateLimitPauseMs: 60 * 1000,
    };
  }
  const openRouter = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouter) {
    return {
      id: 'openrouter',
      label: 'OpenRouter',
      api: 'https://openrouter.ai/api/v1',
      key: openRouter,
      defaultModel: process.env.OPENROUTER_MODEL?.trim() || FALLBACK_MODELS[0],
      // A paid id typed into the form would bill the key's credits.
      allows: (model) => FREE_MODEL.test(model),
      rateLimitPauseMs: 15 * 60 * 1000,
    };
  }
  return null;
}

/** A 429 (or an empty balance) — retried later, not failed. */
export class AiRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super(message);
  }
}

export type AiModel = { id: string; name: string; contextLength: number };

export type AiQuota = {
  isFreeTier: boolean;
  dailyLimit: number | null;
  dailyUsed: number | null;
  dailyRemaining: number | null;
  /** Paid key: what is left on the account, e.g. "12.40 USD". */
  balance: string | null;
};

@Injectable()
export class AiClient implements OnModuleInit {
  private readonly logger = new Logger(AiClient.name);
  private modelsCache: { at: number; models: AiModel[] } | null = null;

  /** Read per call, like the other env-driven settings in this module. */
  private get provider() {
    return provider();
  }

  get enabled() {
    return Boolean(this.provider);
  }

  get providerLabel() {
    return this.provider?.label ?? null;
  }

  get defaultModel() {
    return this.provider?.defaultModel ?? FALLBACK_MODELS[0];
  }

  /** Whether a task may name this model with the current provider. */
  allowsModel(model: string) {
    return this.provider?.allows(model) ?? false;
  }

  onModuleInit() {
    const current = this.provider;
    if (!current) {
      this.logger.warn(
        'AI tasks disabled — set DEEPSEEK_API_KEY or OPENROUTER_API_KEY to enable',
      );
    } else {
      this.logger.log(
        `AI tasks via ${current.label}, model ${current.defaultModel}`,
      );
    }
  }

  async chat(model: string, messages: ChatMessage[]) {
    const current = this.provider;
    if (!current)
      throw new Error(
        'Ключ ИИ не задан (DEEPSEEK_API_KEY / OPENROUTER_API_KEY)',
      );
    // A task created under the other provider (or before a key change) keeps
    // a model id this one does not serve; the default is the sane answer.
    const resolved = current.allows(model) ? model : current.defaultModel;
    const openRouter = current.id === 'openrouter';

    const res = await fetchWithTimeout(
      `${current.api}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${current.key}`,
          'Content-Type': 'application/json',
          ...(openRouter
            ? {
                'HTTP-Referer':
                  process.env.PUBLIC_ORIGIN || 'https://localhost',
                'X-Title': 'construction-tools admin',
              }
            : {}),
        },
        body: JSON.stringify({
          model: resolved,
          // OpenRouter's own fallback chain: one request, first model that answers.
          ...(openRouter
            ? {
                models: [
                  resolved,
                  ...FALLBACK_MODELS.filter((id) => id !== resolved),
                ].slice(0, 3),
              }
            : {}),
          messages,
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      },
      // No transport-level retry on 429: on the free tier that is the daily
      // quota, and retrying it within seconds only burns the next request too.
      { timeoutMs: REQUEST_TIMEOUT_MS, retries: 0 },
    );

    const text = await res.text();
    if (res.status === 429) {
      throw new AiRateLimitError(
        `Лимит ${current.label}: ${this.errorText(text)}`,
        this.retryAt(res, current.rateLimitPauseMs),
      );
    }
    if (res.status === 402) {
      // DeepSeek: the balance ran out. Every request would fail the same way,
      // so pause the key instead of burning the items' attempts.
      throw new AiRateLimitError(
        `${current.label}: закончился баланс — ${this.errorText(text)}`,
        new Date(Date.now() + 60 * 60 * 1000),
      );
    }
    if (!res.ok) {
      throw new Error(
        `${current.label} ${res.status}: ${this.errorText(text)}`,
      );
    }

    const body = JSON.parse(text) as {
      model?: string;
      error?: { message?: string; code?: number };
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    // OpenRouter reports upstream failures inside a 200 body.
    if (body.error) {
      if (body.error.code === 429) {
        throw new AiRateLimitError(
          `Лимит ${current.label}: ${body.error.message ?? ''}`,
          new Date(Date.now() + current.rateLimitPauseMs),
        );
      }
      throw new Error(
        `${current.label}: ${body.error.message ?? 'ошибка модели'}`,
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('Модель вернула пустой ответ');
    return { content, model: body.model ?? resolved };
  }

  /**
   * Models a task may pick, cached for an hour: OpenRouter's free ones, or
   * whatever the DeepSeek key serves.
   */
  async models(): Promise<AiModel[]> {
    const current = this.provider;
    if (!current) return [];
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) {
      return this.modelsCache.models;
    }
    const res = await fetchWithTimeout(
      `${current.api}/models`,
      current.id === 'deepseek'
        ? { headers: { Authorization: `Bearer ${current.key}` } }
        : {},
      { timeoutMs: 20_000 },
    );
    if (!res.ok) throw new Error(`${current.label} models ${res.status}`);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        name?: string;
        context_length?: number;
        /** DeepSeek's name for it. */
        context_window?: number;
        architecture?: { output_modalities?: string[] };
      }>;
    };
    const models = body.data
      .filter(
        (model) =>
          current.allows(model.id) &&
          (model.architecture?.output_modalities ?? ['text']).includes(
            'text',
          ) &&
          !/safety|guard/i.test(model.id),
      )
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextLength: model.context_length ?? model.context_window ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.modelsCache = { at: Date.now(), models };
    return models;
  }

  async quota(): Promise<AiQuota | null> {
    const current = this.provider;
    if (!current) return null;
    try {
      if (current.id === 'deepseek') return await this.deepseekBalance(current);
      const res = await fetchWithTimeout(
        `${current.api}/key`,
        { headers: { Authorization: `Bearer ${current.key}` } },
        { timeoutMs: 10_000, retries: 0 },
      );
      if (!res.ok) return null;
      const { data } = (await res.json()) as {
        data: {
          is_free_tier?: boolean;
          free_model_daily_requests?: {
            used?: number;
            limit?: number;
            remaining?: number;
          };
        };
      };
      const daily = data.free_model_daily_requests;
      return {
        isFreeTier: Boolean(data.is_free_tier),
        dailyLimit: daily?.limit ?? null,
        dailyUsed: daily?.used ?? null,
        dailyRemaining: daily?.remaining ?? null,
        balance: null,
      };
    } catch {
      return null;
    }
  }

  private async deepseekBalance(current: Provider): Promise<AiQuota | null> {
    const res = await fetchWithTimeout(
      `${current.api}/user/balance`,
      { headers: { Authorization: `Bearer ${current.key}` } },
      { timeoutMs: 10_000, retries: 0 },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      balance_infos?: Array<{ currency?: string; total_balance?: string }>;
    };
    const balance =
      body.balance_infos
        ?.map((info) =>
          `${info.total_balance ?? '?'} ${info.currency ?? ''}`.trim(),
        )
        .join(', ') || null;
    return {
      isFreeTier: false,
      dailyLimit: null,
      dailyUsed: null,
      dailyRemaining: null,
      balance,
    };
  }

  private retryAt(res: Response, fallbackMs: number) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) {
      // Milliseconds since the epoch on OpenRouter; tolerate seconds too.
      const at = reset > 1e12 ? reset : reset * 1000;
      if (at > Date.now())
        return new Date(Math.min(at, Date.now() + 26 * 3600_000));
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return new Date(Date.now() + retryAfter * 1000);
    }
    return new Date(Date.now() + fallbackMs);
  }

  private errorText(text: string) {
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      return body.error?.message ?? text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  }
}

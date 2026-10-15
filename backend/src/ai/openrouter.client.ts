import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import type { ChatMessage } from './ai-fields';

const API = 'https://openrouter.ai/api/v1';
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

/** A 429 — the daily free quota or a per-minute limit. Retried later, not failed. */
export class AiRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super(message);
  }
}

export type FreeModel = { id: string; name: string; contextLength: number };

export type AiQuota = {
  isFreeTier: boolean;
  dailyLimit: number | null;
  dailyUsed: number | null;
  dailyRemaining: number | null;
};

@Injectable()
export class OpenRouterClient implements OnModuleInit {
  private readonly logger = new Logger(OpenRouterClient.name);
  private modelsCache: { at: number; models: FreeModel[] } | null = null;

  private get apiKey() {
    return process.env.OPENROUTER_API_KEY?.trim() || '';
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  get defaultModel() {
    return process.env.OPENROUTER_MODEL?.trim() || FALLBACK_MODELS[0];
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('AI tasks disabled — set OPENROUTER_API_KEY to enable');
    }
  }

  async chat(model: string, messages: ChatMessage[]) {
    if (!this.enabled) throw new Error('OPENROUTER_API_KEY не задан');

    const models = [model, ...FALLBACK_MODELS.filter((id) => id !== model)];
    const res = await fetchWithTimeout(
      `${API}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.PUBLIC_ORIGIN || 'https://localhost',
          'X-Title': 'construction-tools admin',
        },
        body: JSON.stringify({
          model,
          // OpenRouter's own fallback chain: one request, first model that answers.
          models: models.slice(0, 3),
          messages,
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      },
      // No transport-level retry on 429: that is the daily quota, and retrying
      // it within seconds only burns the next request too.
      { timeoutMs: REQUEST_TIMEOUT_MS, retries: 0 },
    );

    const text = await res.text();
    if (res.status === 429) {
      throw new AiRateLimitError(
        `Лимит OpenRouter: ${this.errorText(text)}`,
        this.retryAt(res),
      );
    }
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${this.errorText(text)}`);
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
          `Лимит OpenRouter: ${body.error.message ?? ''}`,
          new Date(Date.now() + 10 * 60 * 1000),
        );
      }
      throw new Error(`OpenRouter: ${body.error.message ?? 'ошибка модели'}`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('Модель вернула пустой ответ');
    return { content, model: body.model ?? model };
  }

  /** Free models currently listed by OpenRouter, cached for an hour. */
  async freeModels(): Promise<FreeModel[]> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) {
      return this.modelsCache.models;
    }
    const res = await fetchWithTimeout(
      `${API}/models`,
      {},
      { timeoutMs: 20_000 },
    );
    if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { output_modalities?: string[] };
      }>;
    };
    const models = body.data
      .filter(
        (model) =>
          (model.id.endsWith(':free') || model.id === 'openrouter/free') &&
          (model.architecture?.output_modalities ?? ['text']).includes(
            'text',
          ) &&
          !/safety|guard/i.test(model.id),
      )
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextLength: model.context_length ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.modelsCache = { at: Date.now(), models };
    return models;
  }

  async quota(): Promise<AiQuota | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetchWithTimeout(
        `${API}/key`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
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
      };
    } catch {
      return null;
    }
  }

  private retryAt(res: Response) {
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
    return new Date(Date.now() + 15 * 60 * 1000);
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

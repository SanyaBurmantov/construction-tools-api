import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';

/** What the detector container answers for one text (see detector/analyze.py). */
export type DetectorVerdict = { key: string; label: string };
export type DetectorReport = {
  probability: number;
  verdict: DetectorVerdict;
  model: string;
  tokens: number;
  words: number;
  warnings: string[];
  fragments: Array<{
    start: number;
    end: number;
    words: number;
    probability: number;
    verdict: DetectorVerdict;
  }>;
  markers: Array<{
    kind: string;
    label: string;
    start: number;
    end: number;
    text: string;
  }>;
  markerSummary: Array<{
    kind: string;
    label: string;
    count: number;
    per100Words: number;
    examples: string[];
  }>;
  rhythm: {
    words: number;
    sentences: number;
    avgSentenceWords: number;
    burstiness: number | null;
    lexicalVariety: number | null;
  };
  ms?: number;
};
export type DetectorScore = {
  probability: number;
  verdict: string;
  tokens: number;
  words: number;
};

/**
 * HTTP client of the `detector` container (Python, ONNX). It is optional —
 * its compose profile is off until switched on — so «not configured» and
 * «not answering» are a 503 with a sentence an admin can act on, never a 500.
 * A long text on the production box's one core takes a few seconds, hence the
 * generous timeout; no retries, the admin presses the button again.
 */
@Injectable()
export class DetectorClient {
  private readonly logger = new Logger(DetectorClient.name);

  private get baseUrl() {
    return (process.env.DETECTOR_URL ?? '').replace(/\/+$/, '');
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  private headers(): Record<string, string> {
    const token = process.env.DETECTOR_TOKEN;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async health(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.configured) return { ok: false, error: 'DETECTOR_URL не задан' };
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/health`,
        {},
        {
          timeoutMs: 3_000,
          retries: 0,
        },
      );
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return (await res.json()) as { ok: boolean; model?: string };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  analyze(text: string): Promise<DetectorReport> {
    return this.post<DetectorReport>('/analyze', { text, fragments: true });
  }

  async scoreMany(texts: string[]): Promise<DetectorScore[]> {
    const body = await this.post<{ results: DetectorScore[] }>(
      '/analyze/batch',
      { texts },
    );
    return body.results;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'ИИ-детектор не подключён: на сервере не задан DETECTOR_URL',
      );
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${this.baseUrl}${path}`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(payload),
        },
        { timeoutMs: 60_000, retries: 0, maxBytes: 8 * 1024 * 1024 },
      );
    } catch (error) {
      this.logger.warn(`detector ${path}: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'ИИ-детектор не отвечает. Возможно, контейнер ещё запускается — попробуйте через минуту.',
      );
    }
    if (!res.ok) {
      const detail = await res
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => undefined);
      this.logger.warn(`detector ${path}: HTTP ${res.status} ${detail ?? ''}`);
      throw new ServiceUnavailableException(
        detail ? `ИИ-детектор: ${detail}` : `ИИ-детектор ответил ${res.status}`,
      );
    }
    return (await res.json()) as T;
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import { isValidUnp, normalizeUnp } from '../common/utils/requisites';
import {
  PAYER_REGISTRY_URL,
  parsePayerRegistry,
  payerProblem,
  type PayerLookup,
} from './payer-registry';

const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 2000;

/**
 * Looks a УНП up in the tax ministry's payer registry (`payer-registry.ts`).
 * Used twice: the storefront fills the organisation's name and address from
 * it as the УНП is typed, and registration / `POST /orders` refuse a УНП the
 * registry does not know or that belongs to a liquidated payer — the site
 * sells to organisations and ИП only (owner, 2026-11-06).
 *
 * The registry is someone else's service: an answer is cached (a day when
 * found, an hour when not), and an outage or an answer we cannot read is
 * `unavailable`, which lets the sale through rather than lose it.
 */
@Injectable()
export class PayerRegistryService {
  private readonly logger = new Logger(PayerRegistryService.name);
  private readonly cache = new Map<
    string,
    { lookup: PayerLookup; expires: number }
  >();

  async lookup(rawUnp: string): Promise<PayerLookup> {
    const unp = normalizeUnp(rawUnp);
    if (!/^\d{9}$/.test(unp) || !isValidUnp(unp))
      return { status: 'not_found' };

    const cached = this.cache.get(unp);
    if (cached && cached.expires > Date.now()) return cached.lookup;

    const lookup = await this.fetch(unp);
    if (lookup.status !== 'unavailable') {
      this.cache.delete(unp);
      if (this.cache.size >= MAX_CACHED) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(unp, {
        lookup,
        expires:
          Date.now() +
          (lookup.status === 'found' ? FOUND_TTL_MS : NOT_FOUND_TTL_MS),
      });
    }
    return lookup;
  }

  /**
   * Throws a 400 a customer can act on when the registry rules the УНП out;
   * returns the lookup otherwise (including `unavailable`).
   */
  async assertBillable(
    rawUnp: string | null | undefined,
  ): Promise<PayerLookup> {
    if (!rawUnp?.trim()) {
      throw new BadRequestException(
        'Укажите УНП организации или ИП — сайт работает только с ними',
      );
    }
    const unp = normalizeUnp(rawUnp);
    if (!/^\d{9}$/.test(unp) || !isValidUnp(unp)) {
      throw new BadRequestException(
        'УНП организации или ИП — 9 цифр; проверьте номер',
      );
    }
    const lookup = await this.lookup(unp);
    const problem = payerProblem(lookup);
    if (problem) throw new BadRequestException(problem);
    return lookup;
  }

  private async fetch(unp: string): Promise<PayerLookup> {
    const url = `${PAYER_REGISTRY_URL}?unp=${unp}&charset=UTF-8&type=json`;
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        { timeoutMs: 6000, retries: 1 },
      );
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      const lookup = parsePayerRegistry(res.status, body);
      if (lookup.status === 'unavailable') {
        this.logger.warn(
          `Payer registry: unexpected answer ${res.status} for ${unp}: ${text.slice(0, 200)}`,
        );
      }
      return lookup;
    } catch (error) {
      this.logger.warn(
        `Payer registry unavailable for ${unp}: ${(error as Error).message}`,
      );
      return { status: 'unavailable' };
    }
  }
}

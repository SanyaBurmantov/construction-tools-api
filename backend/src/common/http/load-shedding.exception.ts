import { ServiceUnavailableException } from '@nestjs/common';

/**
 * A 503 the API answers on purpose to protect itself — a queue bound was hit
 * (`RecommendationsService.gated`), nothing is broken. The client sees the
 * same 503; the error log keeps it by route pattern and Telegram hears about
 * it only when the shedding lasts (ErrorLogService: ≥ 50 in 5 minutes). A
 * crawler opening fifty product pages at once used to send six «🔴 Ошибка 503»
 * messages about a block that rendered client-side anyway (2026-11-18).
 */
export class LoadSheddingException extends ServiceUnavailableException {}

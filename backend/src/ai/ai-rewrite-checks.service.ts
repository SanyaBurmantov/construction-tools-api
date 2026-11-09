import { Injectable, Logger } from '@nestjs/common';
import { AiEntity } from '@prisma/client';
import { DetectorClient } from '../ai-detector/detector.client';
import { UniquenessService } from '../ai-detector/uniqueness.service';
import {
  rewriteVerdict,
  UNIQUENESS_FIELDS,
  type FieldQuality,
  type RewriteVerdict,
} from './ai-rewrite-checks';

export type RewriteInput = {
  entityId: string;
  entity: AiEntity;
  /** Field → the new text the model proposes. */
  proposed: Record<string, string>;
  /** The entity's current texts (what the rewrite replaces). */
  previous: Array<string | null | undefined>;
};

/**
 * Uniqueness (the same shingles as «ИИ-детектор») and the detector's figure
 * for each proposed description, before a task writes it. Neither may stop a
 * batch: a failed catalogue search or a detector that is switched off only
 * leaves its figure out.
 */
@Injectable()
export class AiRewriteChecksService {
  private readonly logger = new Logger(AiRewriteChecksService.name);

  constructor(
    private readonly uniqueness: UniquenessService,
    private readonly detector: DetectorClient,
  ) {}

  async check(inputs: RewriteInput[]): Promise<Map<string, RewriteVerdict>> {
    const figures = new Map<string, Record<string, FieldQuality>>();
    const copied = new Map<string, Record<string, string[]>>();
    const texts: Array<{ entityId: string; field: string; text: string }> = [];
    for (const input of inputs) {
      const own: Record<string, FieldQuality> = {};
      const pieces: Record<string, string[]> = {};
      for (const field of UNIQUENESS_FIELDS) {
        const text = input.proposed[field];
        if (!text) continue;
        texts.push({ entityId: input.entityId, field, text });
        try {
          const result = await this.uniqueness.forRewrite(text, {
            productId:
              input.entity === AiEntity.PRODUCT ? input.entityId : null,
            previous: input.previous,
          });
          own[field] = { uniqueness: result.percent };
          if (result.copied.length) pieces[field] = result.copied;
        } catch (error) {
          this.logger.warn(
            `uniqueness of ${input.entityId}: ${(error as Error).message}`,
          );
          own[field] = {};
        }
      }
      figures.set(input.entityId, own);
      copied.set(input.entityId, pieces);
    }

    if (texts.length && this.detector.configured) {
      try {
        const scores = await this.detector.scoreMany(texts.map((t) => t.text));
        texts.forEach((t, i) => {
          const field = figures.get(t.entityId)?.[t.field];
          if (field && scores[i]) {
            field.ai = Math.round(scores[i].probability * 1000) / 1000;
          }
        });
      } catch (error) {
        this.logger.warn(`detector: ${(error as Error).message}`);
      }
    }

    return new Map(
      [...figures].map(([id, quality]) => [
        id,
        rewriteVerdict(quality, copied.get(id)),
      ]),
    );
  }
}

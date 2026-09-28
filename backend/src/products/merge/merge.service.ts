import { Injectable } from '@nestjs/common';
import { TSourceProduct } from '../../sources/types/source-product.type';
import { TMergeResult } from '../types/merge-result.type';
import { compareNames } from '../../common/utils/compare-names';

@Injectable()
export class MergeService {
  merge(sourceProducts: TSourceProduct[]): TMergeResult {
    const base = sourceProducts[0];

    const matched = sourceProducts.filter((p) =>
      compareNames(base.name, p.name),
    );

    const productId = crypto.randomUUID();

    return {
      productId,

      sourceProductIds: matched.map((p) => p.id),
    };
  }
}

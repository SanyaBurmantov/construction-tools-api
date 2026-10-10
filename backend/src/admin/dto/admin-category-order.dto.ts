import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
} from 'class-validator';

export class AdminCategoryOrderDto {
  /**
   * Sibling ids in the order they should appear. `sortOrder` is written as the
   * position in this list, so the whole row of siblings is renumbered in one
   * transaction — moving one category up cannot leave two of them claiming the
   * same slot, which is what a per-row PATCH does if the second one fails.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}

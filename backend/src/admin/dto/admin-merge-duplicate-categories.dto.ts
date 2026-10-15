import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

/** A reviewed group of same-named siblings: fold `sourceIds` into `targetId`. */
export class AdminMergeDuplicateCategoriesDto {
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sourceIds: string[];
}

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AdminMergeProductsDto {
  @ApiProperty({ description: 'ID товара, который остаётся' })
  @IsString()
  targetId!: string;

  @ApiProperty({ description: 'ID дубля, который будет присоединён' })
  @IsString()
  duplicateId!: string;
}

/** «Один товар» on a merge conflict; the dearest card on sale by default. */
export class AdminResolveConflictDto {
  @ApiProperty({ required: false, description: 'ID товара, который остаётся' })
  @IsOptional()
  @IsString()
  targetId?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AdminMergeProductsDto {
  @ApiProperty({ description: 'ID товара, который остаётся' })
  @IsString()
  targetId!: string;

  @ApiProperty({ description: 'ID дубля, который будет присоединён' })
  @IsString()
  duplicateId!: string;
}

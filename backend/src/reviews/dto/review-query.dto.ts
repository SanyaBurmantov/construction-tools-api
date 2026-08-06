import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ReviewStatus } from '@prisma/client';

export class ReviewQueryDto {
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiProperty({
    required: false,
    enum: ['createdAt', 'rating'],
    description: 'Сортировка',
  })
  @IsOptional()
  @IsIn(['createdAt', 'rating'])
  sortBy?: 'createdAt' | 'rating';

  @ApiProperty({ required: false, enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class AdminReviewQueryDto extends ReviewQueryDto {
  @ApiProperty({ required: false, enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiProperty({ required: false, description: 'Поиск по автору или тексту' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, description: 'ID товара' })
  @IsOptional()
  @IsString()
  productId?: string;
}

export class AdminUpdateReviewStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'Имя автора' })
  @IsString()
  @Length(2, 120)
  authorName!: string;

  @ApiProperty({
    required: false,
    description: 'Email автора (не публикуется)',
  })
  @IsOptional()
  @IsEmail()
  authorEmail?: string;

  @ApiProperty({ description: 'Оценка от 1 до 5', minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ required: false, description: 'Заголовок отзыва' })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  title?: string;

  @ApiProperty({ description: 'Текст отзыва' })
  @IsString()
  @Length(10, 4000)
  text!: string;

  /**
   * Honeypot. Hidden from real users by CSS, so anything non-empty here came
   * from a bot filling every field it found. Not validated as a URL on
   * purpose — we only care whether it was touched.
   */
  @ApiProperty({
    required: false,
    description: 'Служебное поле, оставьте пустым',
  })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  website?: string;
}

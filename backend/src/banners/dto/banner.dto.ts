import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class AdminCreateBannerDto {
  @ApiProperty({ description: 'Заголовок баннера' })
  @IsString()
  @Length(2, 160)
  title!: string;

  @ApiProperty({ required: false, description: 'Подзаголовок' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  subtitle?: string;

  @ApiProperty({ description: 'Ссылка на изображение' })
  @IsString()
  @Length(4, 1000)
  imageUrl!: string;

  @ApiProperty({ required: false, description: 'Изображение для мобильных' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  mobileUrl?: string;

  @ApiProperty({ required: false, description: 'Куда ведёт баннер' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  linkUrl?: string;

  @ApiProperty({ required: false, description: 'Текст кнопки' })
  @IsOptional()
  @IsString()
  @Length(0, 60)
  buttonText?: string;

  @ApiProperty({ required: false, description: 'Цвет фона, например #0f172a' })
  @IsOptional()
  @IsString()
  @Length(0, 32)
  bgColor?: string;

  @ApiProperty({ required: false, description: 'Порядок показа' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Показывать с (ISO)' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiProperty({ required: false, description: 'Показывать до (ISO)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

export class AdminUpdateBannerDto extends AdminCreateBannerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  declare title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(4, 1000)
  declare imageUrl: string;
}

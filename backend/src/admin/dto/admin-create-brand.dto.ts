import { IsOptional, IsString } from 'class-validator';

export class AdminCreateBrandDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

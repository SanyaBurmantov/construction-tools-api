import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminCreateBrandDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  /** `null` on an update clears it. */
  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  country?: string | null;

  /**
   * The brand page's own title and description. The admin form always sent
   * them and the DTO did not declare them, so with `forbidNonWhitelisted`
   * every brand save in /admin/brands answered 400. Blank — the name (and
   * the description) stand in, as before.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string;
}

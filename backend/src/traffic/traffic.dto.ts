import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** One page view, sent by the storefront (`plugins/page-views.client.ts`). */
export class PageViewDto {
  /** Path only, starting with `/`. */
  @IsString()
  @MaxLength(2000)
  @Matches(/^\//)
  path!: string;

  @IsIn([200, 404])
  status!: 200 | 404;

  /** First page after 30 minutes of silence. */
  @IsBoolean()
  entry!: boolean;

  @IsOptional()
  @IsUUID()
  visitorId?: string;

  /** `document.referrer` on an entry, our previous page on a client-side move. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referrer?: string;

  /** `navigator.maxTouchPoints > 1` — tells an iPad from a Mac. */
  @IsOptional()
  @IsBoolean()
  touch?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmMedium?: string;

  /** Whether the landing URL carried an ad click id. */
  @IsOptional()
  @IsIn(['yclid', 'gclid'])
  click?: 'yclid' | 'gclid';
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length, ValidateNested } from 'class-validator';

/** One visit's source, as the storefront saw it. All optional, all short. */
export class TouchDto {
  @IsOptional() @IsString() @Length(0, 100) utmSource?: string;
  @IsOptional() @IsString() @Length(0, 100) utmMedium?: string;
  @IsOptional() @IsString() @Length(0, 200) utmCampaign?: string;
  @IsOptional() @IsString() @Length(0, 200) utmContent?: string;
  @IsOptional() @IsString() @Length(0, 200) utmTerm?: string;
  @IsOptional() @IsString() @Length(0, 200) yclid?: string;
  @IsOptional() @IsString() @Length(0, 200) gclid?: string;
  @IsOptional() @IsString() @Length(0, 200) referrer?: string;
  @IsOptional() @IsString() @Length(0, 300) landing?: string;
  @IsOptional() @IsString() @Length(0, 40) at?: string;
}

/**
 * First touch (how they found us) and last non-direct touch (what brought
 * them back to buy). Sent with an order or a lead; never trusted for
 * anything but reporting.
 */
export class AttributionDto {
  @ApiProperty({ required: false, type: TouchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TouchDto)
  first?: TouchDto;

  @ApiProperty({ required: false, type: TouchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TouchDto)
  last?: TouchDto;
}

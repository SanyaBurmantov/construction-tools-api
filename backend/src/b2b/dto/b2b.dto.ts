import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LeadKind, LeadStatus } from '@prisma/client';
import { emptyToUndefined } from '../../common/dto/empty-to-undefined';
import {
  IsBankAccount,
  IsBic,
  IsUnp,
} from '../../common/dto/requisites.validators';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../../cart/cart-limits';
import { AttributionDto } from '../../attribution/attribution.dto';

/** '' / null → undefined (not sent), anything else → a number. */
function blankToUndefinedNumber({ value }: { value: unknown }) {
  if (value === '' || value === null || value === undefined) return undefined;
  return typeof value === 'number' ? value : Number(value);
}

export class B2bLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

/** Who is asking — every field optional on a quote, the account fills gaps. */
class ContactFields {
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 200)
  companyName?: string;

  @ApiProperty({ required: false, description: 'УНП' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUnp()
  taxId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  @Length(3, 200)
  email?: string;

  @ApiProperty({
    required: false,
    type: AttributionDto,
    description:
      'Источник визита (UTM, click id, реферер) — только для отчётов',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;

  /** Honeypot: hidden in the form, only a bot fills it in. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  website?: string;
}

export class QuoteRequestDto extends ContactFields {
  @ApiProperty({ type: [B2bLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => B2bLineDto)
  items!: B2bLineDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 120)
  contactName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(5, 32)
  phone?: string;
}

export class QuestionDto extends ContactFields {
  @ApiProperty({ required: false, description: 'Товар, о котором вопрос' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty()
  @IsString()
  @Length(2, 120)
  contactName!: string;

  @ApiProperty()
  @IsString()
  @Length(5, 32)
  phone!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 2000)
  message!: string;
}

export class AdminLeadQueryDto {
  @ApiProperty({ required: false, enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiProperty({ required: false, enum: LeadKind })
  @IsOptional()
  @IsEnum(LeadKind)
  kind?: LeadKind;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  search?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminUpdateLeadDto {
  @ApiProperty({ enum: LeadStatus })
  @IsEnum(LeadStatus)
  status!: LeadStatus;
}

/** `/admin/seller`: '' clears a field (update semantics). */
export class AdminUpdateSellerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUnp()
  unp?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  legalAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBankAccount()
  bankAccount?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  bankName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBic()
  bankBic?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 60)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  email?: string;

  @ApiProperty({ required: false, description: '«Директор Иванов И. И.»' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  signatory?: string;

  @ApiProperty({ required: false, enum: ['NONE', 'INCLUDED', ''] })
  @IsOptional()
  @IsIn(['NONE', 'INCLUDED', ''])
  vatMode?: 'NONE' | 'INCLUDED' | '';

  // A cleared number input sends '' (or null); `@Type(() => Number)` made that
  // 0 and invoices printed «НДС 0%». Blank now means «leave as it is».
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(blankToUndefinedNumber)
  @IsNumber()
  @Min(0)
  @Max(30)
  vatRate?: number;

  @ApiProperty({ required: false, description: 'Срок действия счёта, дней' })
  @IsOptional()
  @Transform(blankToUndefinedNumber)
  @IsInt()
  @Min(1)
  @Max(30)
  validDays?: number;
}

export class PurchaseListDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ type: [B2bLineDto] })
  @IsArray()
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => B2bLineDto)
  items!: B2bLineDto[];
}

export class UpdatePurchaseListDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiProperty({ required: false, type: [B2bLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => B2bLineDto)
  items?: B2bLineDto[];
}

export class PriceListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  categorySlug?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  brandSlug?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  inStock?: boolean;
}

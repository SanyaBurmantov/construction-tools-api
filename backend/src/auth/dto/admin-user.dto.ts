import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CustomerType, UserRole } from '@prisma/client';
import { MAX_LOGIN_LENGTH, MIN_LOGIN_LENGTH } from '../login.util';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../password.util';
import { emptyToUndefined } from '../../common/dto/empty-to-undefined';

/** Query strings arrive as 'true'/'false'; class-validator wants booleans. */
const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class AdminUserQueryDto {
  @ApiProperty({
    required: false,
    description: 'Поиск по логину, имени, e-mail',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @ApiProperty({ required: false, enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Creating an account from the admin panel — this is how admins are made. */
export class AdminCreateUserDto {
  @ApiProperty()
  @IsString()
  @Length(MIN_LOGIN_LENGTH, MAX_LOGIN_LENGTH)
  login!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;

  @ApiProperty({ enum: UserRole, default: UserRole.CUSTOMER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ required: false, enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  @Length(3, 200)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(3, 40)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 200)
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(2, 40)
  taxId?: string;
}

export class AdminUpdateUserDto {
  @ApiProperty({ required: false, enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    required: false,
    description: 'Новый пароль — все сессии пользователя сбрасываются',
    minLength: MIN_PASSWORD_LENGTH,
  })
  @IsOptional()
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password?: string;

  @ApiProperty({ required: false, enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  // An empty string is how the form clears the field — the service turns it
  // into `null`. Without this, `@IsEmail()` made a saved e-mail permanent.
  @ValidateIf((dto: { email?: string }) => dto.email !== '')
  @IsEmail()
  @Length(3, 200)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  taxId?: string;
}

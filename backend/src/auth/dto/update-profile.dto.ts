import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { CustomerType } from '@prisma/client';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../password.util';

/** Everything an account may change about itself — never the role. */
export class UpdateProfileDto {
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

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  currentPassword!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  newPassword!: string;
}

/**
 * Deleting your own account. The password is asked for the same reason a bank
 * asks before a transfer: the session alone could be a borrowed laptop.
 */
export class DeleteAccountDto {
  @ApiProperty()
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  password!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { MAX_LOGIN_LENGTH } from '../login.util';
import { MAX_PASSWORD_LENGTH } from '../password.util';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @Length(1, MAX_LOGIN_LENGTH)
  login!: string;

  @ApiProperty()
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  password!: string;

  /** The authenticator code, when the account has the second factor on. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 12)
  otp?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { CustomerType } from '@prisma/client';
import { MAX_LOGIN_LENGTH, MIN_LOGIN_LENGTH } from '../login.util';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../password.util';

export class RegisterDto {
  @ApiProperty({ description: 'Логин (можно e-mail), регистр не важен' })
  @IsString()
  @Length(MIN_LOGIN_LENGTH, MAX_LOGIN_LENGTH)
  login!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;

  @ApiProperty({ enum: CustomerType, default: CustomerType.INDIVIDUAL })
  @IsEnum(CustomerType)
  customerType!: CustomerType;

  @ApiProperty({ required: false, description: 'Имя или контактное лицо' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @Length(3, 200)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  phone?: string;

  @ApiProperty({
    required: false,
    description: 'Название организации — обязательно для юридического лица',
  })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  companyName?: string;

  @ApiProperty({ required: false, description: 'УНП / ИНН' })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  taxId?: string;
}

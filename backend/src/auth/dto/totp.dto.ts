import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../password.util';

export class TotpCodeDto {
  @ApiProperty({ description: 'Шесть цифр из приложения' })
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class TotpDisableDto extends TotpCodeDto {
  @ApiProperty()
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  password!: string;
}

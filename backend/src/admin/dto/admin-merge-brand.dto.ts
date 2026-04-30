import { IsString } from 'class-validator';

export class AdminMergeBrandDto {
  @IsString()
  targetBrandId: string;
}

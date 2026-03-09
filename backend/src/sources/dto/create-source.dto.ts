import { IsString } from 'class-validator';

export class CreateSourceDto {

  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsString()
  url: string;
}
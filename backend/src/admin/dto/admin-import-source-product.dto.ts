import { IsString } from 'class-validator';

export class AdminImportSourceProductDto {
  @IsString()
  sourceId: string;

  @IsString()
  url: string;
}

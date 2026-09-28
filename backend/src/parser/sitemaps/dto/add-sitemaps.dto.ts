import { IsString, IsBoolean } from 'class-validator';

export class AddSitemapsDto {
  @IsString()
  url: string;

  @IsBoolean()
  isVisited: boolean;
}

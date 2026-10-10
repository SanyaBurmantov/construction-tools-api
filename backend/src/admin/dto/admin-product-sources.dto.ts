import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** `?ids=a,b,c` — the admin screens ask for a whole page of products at once. */
export class AdminProductSourcesDto {
  @ApiProperty({ description: 'ID товаров через запятую' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];
}

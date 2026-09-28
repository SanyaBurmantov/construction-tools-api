import { PartialType } from '@nestjs/mapped-types';
import { CreateSourceWebsiteDto } from './create-source-website.dto';

export class UpdateSourceWebsiteDto extends PartialType(CreateSourceWebsiteDto) {}

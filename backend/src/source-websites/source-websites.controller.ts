import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { SourceWebsitesService } from './source-websites.service';
import { CreateSourceWebsiteDto } from './dto/create-source-website.dto';
import { UpdateSourceWebsiteDto } from './dto/update-source-website.dto';

@ApiTags('source-websites')
@Controller('source-websites')
export class SourceWebsitesController {
  constructor(
    private readonly sourceWebsitesService: SourceWebsitesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Добавить источник для парсинга' })
  @ApiResponse({ status: 201, description: 'Источник успешно добавлен' })
  create(@Body() createSourceWebsiteDto: CreateSourceWebsiteDto) {
    return this.sourceWebsitesService.create(createSourceWebsiteDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить список источников' })
  findAll() {
    return this.sourceWebsitesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить источник по ID' })
  @ApiParam({ name: 'id', description: 'ID источника' })
  findOne(@Param('id') id: string) {
    return this.sourceWebsitesService.findOne(id);
  }

  @Get('url/*')
  @ApiOperation({ summary: 'Получить источник по URL' })
  @ApiQuery({ name: 'url', description: 'Базовый URL источника' })
  findByUrl(@Query('url') url: string) {
    return this.sourceWebsitesService.findByUrl(url);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить источник' })
  @ApiParam({ name: 'id', description: 'ID источника' })
  update(
    @Param('id') id: string,
    @Body() updateSourceWebsiteDto: UpdateSourceWebsiteDto,
  ) {
    return this.sourceWebsitesService.update(id, updateSourceWebsiteDto);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Включить/выключить источник' })
  @ApiParam({ name: 'id', description: 'ID источника' })
  toggleActive(@Param('id') id: string) {
    return this.sourceWebsitesService.toggleActive(id);
  }

  @Get(':id/parser-config')
  @ApiOperation({ summary: 'Получить конфиг парсера' })
  @ApiParam({ name: 'id', description: 'ID источника' })
  getParserConfig(@Param('id') id: string) {
    return this.sourceWebsitesService.getParserConfig(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить источник' })
  @ApiParam({ name: 'id', description: 'ID источника' })
  remove(@Param('id') id: string) {
    return this.sourceWebsitesService.remove(id);
  }
}

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
import { FacetFiltersService } from './facet-filters.service';
import { CreateFacetFilterDto } from './dto/create-facet-filter.dto';
import { UpdateFacetFilterDto } from './dto/update-facet-filter.dto';

@ApiTags('facet-filters')
@Controller('facet-filters')
export class FacetFiltersController {
  constructor(private readonly facetFiltersService: FacetFiltersService) {}

  @Post()
  @ApiOperation({ summary: 'Создать новый фильтр' })
  @ApiResponse({ status: 201, description: 'Фильтр успешно создан' })
  create(@Body() createFacetFilterDto: CreateFacetFilterDto) {
    return this.facetFiltersService.create(createFacetFilterDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить список фильтров' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'ID категории' })
  findAll(@Query('categoryId') categoryId?: string) {
    return this.facetFiltersService.findAll(categoryId);
  }

  @Get('category/:categoryId')
  @ApiOperation({ summary: 'Получить фильтры для категории' })
  @ApiParam({ name: 'categoryId', description: 'ID категории' })
  getFiltersForCategory(@Param('categoryId') categoryId: string) {
    return this.facetFiltersService.getFiltersForCategory(categoryId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить фильтр по ID' })
  @ApiParam({ name: 'id', description: 'ID фильтра' })
  findOne(@Param('id') id: string) {
    return this.facetFiltersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить фильтр' })
  @ApiParam({ name: 'id', description: 'ID фильтра' })
  update(
    @Param('id') id: string,
    @Body() updateFacetFilterDto: UpdateFacetFilterDto,
  ) {
    return this.facetFiltersService.update(id, updateFacetFilterDto);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Включить/выключить фильтр' })
  @ApiParam({ name: 'id', description: 'ID фильтра' })
  toggleEnabled(@Param('id') id: string) {
    return this.facetFiltersService.toggleEnabled(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить фильтр' })
  @ApiParam({ name: 'id', description: 'ID фильтра' })
  remove(@Param('id') id: string) {
    return this.facetFiltersService.remove(id);
  }
}

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
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Создать новую категорию' })
  @ApiResponse({ status: 201, description: 'Категория успешно создана' })
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить список категорий' })
  @ApiQuery({ name: 'sourceWebsiteId', required: false, description: 'ID источника' })
  findAll(@Query('sourceWebsiteId') sourceWebsiteId?: string) {
    return this.categoriesService.findAll(sourceWebsiteId);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Получить дерево категорий' })
  @ApiQuery({ name: 'sourceWebsiteId', required: false, description: 'ID источника' })
  getTree(@Query('sourceWebsiteId') sourceWebsiteId?: string) {
    return this.categoriesService.getTree(sourceWebsiteId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить категорию по ID' })
  @ApiParam({ name: 'id', description: 'ID категории' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Получить категорию по slug' })
  @ApiParam({ name: 'slug', description: 'URL-слаг категории' })
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить категорию' })
  @ApiParam({ name: 'id', description: 'ID категории' })
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить категорию' })
  @ApiParam({ name: 'id', description: 'ID категории' })
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}

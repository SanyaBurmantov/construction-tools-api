import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ summary: 'Создать новый товар' })
  @ApiResponse({ status: 201, description: 'Товар успешно создан' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации' })
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить список товаров с фильтрацией' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Страница' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Лимит' })
  @ApiQuery({ name: 'search', required: false, description: 'Поиск' })
  @ApiQuery({ name: 'brand', required: false, description: 'Бренд (можно несколько)' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'ID категории' })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'inStock', required: false, type: Boolean })
  findAll(
    @Query('page', new ParseIntPipe({ optional: true }))
    page?: number,
    @Query('limit', new ParseIntPipe({ optional: true }))
    limit?: number,
    @Query('search') search?: string,
    @Query('brand') brand?: string | string[],
    @Query('categoryId') categoryId?: string,
    @Query('minPrice', new ParseIntPipe({ optional: true }))
    minPrice?: number,
    @Query('maxPrice', new ParseIntPipe({ optional: true }))
    maxPrice?: number,
    @Query('inStock') inStock?: string,
  ) {
    const filters: any = {
      search,
      brand: Array.isArray(brand) ? brand : brand ? [brand] : undefined,
      categoryId,
      minPrice,
      maxPrice,
      inStock: inStock === 'true' ? true : inStock === 'false' ? false : undefined,
    };

    return this.productsService.findAll(
      filters,
      page || 1,
      limit || 20,
    );
  }

  @Get('facets/:categoryId')
  @ApiOperation({ summary: 'Получить опции фасетных фильтров для категории' })
  @ApiParam({ name: 'categoryId', description: 'ID категории' })
  getFacetOptions(@Param('categoryId') categoryId: string) {
    return this.productsService.getFacetOptions(categoryId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить товар по ID' })
  @ApiParam({ name: 'id', description: 'ID товара' })
  @ApiResponse({ status: 200, description: 'Товар найден' })
  @ApiResponse({ status: 404, description: 'Товар не найден' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Получить товар по slug' })
  @ApiParam({ name: 'slug', description: 'URL-слаг товара' })
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить товар' })
  @ApiParam({ name: 'id', description: 'ID товара' })
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить товар (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID товара' })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Delete(':id/hard')
  @ApiOperation({ summary: 'Удалить товар полностью' })
  @ApiParam({ name: 'id', description: 'ID товара' })
  hardDelete(@Param('id') id: string) {
    return this.productsService.hardDelete(id);
  }
}

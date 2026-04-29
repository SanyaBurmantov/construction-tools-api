import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminCreateBrandDto } from './dto/admin-create-brand.dto';
import { AdminCreateCategoryDto } from './dto/admin-create-category.dto';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { AdminProductQueryDto } from './dto/admin-product-query.dto';
import { AdminUpdateBrandDto } from './dto/admin-update-brand.dto';
import { AdminUpdateCategoryDto } from './dto/admin-update-category.dto';
import { AdminSitemapQueryDto } from './dto/admin-sitemap-query.dto';

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('products')
  getProducts(@Query() query: AdminProductQueryDto) {
    return this.adminService.getProducts(query);
  }

  @Post('products')
  createProduct(@Body() dto: AdminCreateProductDto) {
    return this.adminService.createProduct(dto);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: AdminUpdateProductDto) {
    return this.adminService.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.adminService.deleteProduct(id);
  }

  @Get('brands')
  getBrands() {
    return this.adminService.getBrands();
  }

  @Post('brands')
  createBrand(@Body() dto: AdminCreateBrandDto) {
    return this.adminService.createBrand(dto);
  }

  @Patch('brands/:id')
  updateBrand(@Param('id') id: string, @Body() dto: AdminUpdateBrandDto) {
    return this.adminService.updateBrand(id, dto);
  }

  @Delete('brands/:id')
  deleteBrand(@Param('id') id: string) {
    return this.adminService.deleteBrand(id);
  }

  @Get('categories')
  getCategories() {
    return this.adminService.getCategories();
  }

  @Get('sources')
  getSources() {
    return this.adminService.getSources();
  }

  @Get('queue')
  getQueueStats() {
    return this.adminService.getQueueStats();
  }

  @Get('queue/sitemaps')
  getSitemaps(@Query() query: AdminSitemapQueryDto) {
    return this.adminService.getSitemaps(query);
  }

  @Get('queue/errors')
  getParserErrors() {
    return this.adminService.getParserErrors();
  }

  @Delete('queue/errors')
  clearParserErrors() {
    return this.adminService.clearParserErrors();
  }

  @Post('queue/refresh-sitemaps')
  refreshSitemaps() {
    return this.adminService.refreshSitemaps();
  }

  @Post('queue/process')
  processQueuedProducts(@Body('limit') limit?: number) {
    return this.adminService.processQueuedProducts(limit || 25);
  }

  @Post('categories')
  createCategory(@Body() dto: AdminCreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: AdminUpdateCategoryDto) {
    return this.adminService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.adminService.deleteCategory(id);
  }
}

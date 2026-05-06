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
import { AdminMergeBrandDto } from './dto/admin-merge-brand.dto';
import { AdminImportSourceProductDto } from './dto/admin-import-source-product.dto';
import { AdminMapSourceCategoryDto } from './dto/admin-map-source-category.dto';
import { AdminDukonSitemapQueryDto } from './dto/admin-dukon-sitemap-query.dto';
import { Admin7745SitemapQueryDto } from './dto/admin-7745-sitemap-query.dto';

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

  @Post('brands/:id/merge')
  mergeBrand(@Param('id') id: string, @Body() dto: AdminMergeBrandDto) {
    return this.adminService.mergeBrand(id, dto.targetBrandId);
  }

  @Delete('brands/:id')
  deleteBrand(@Param('id') id: string) {
    return this.adminService.deleteBrand(id);
  }

  @Get('categories')
  getCategories() {
    return this.adminService.getCategories();
  }

  @Get('source-categories')
  getSourceCategories(@Query('sourceId') sourceId?: string) {
    return this.adminService.getSourceCategories(sourceId);
  }

  @Patch('source-categories/:id/mapping')
  mapSourceCategory(
    @Param('id') id: string,
    @Body() dto: AdminMapSourceCategoryDto,
  ) {
    return this.adminService.mapSourceCategory(id, dto.categoryId);
  }

  @Get('sources')
  getSources() {
    return this.adminService.getSources();
  }

  @Post('source-products/import')
  importSourceProduct(@Body() dto: AdminImportSourceProductDto) {
    return this.adminService.importSourceProduct(dto);
  }

  @Get('queue')
  getQueueStats() {
    return this.adminService.getQueueStats();
  }

  @Get('queue/dukon')
  getDukonQueueStats() {
    return this.adminService.getDukonQueueStats();
  }

  @Get('queue/dukon/sitemaps')
  getDukonSitemaps(@Query() query: AdminDukonSitemapQueryDto) {
    return this.adminService.getDukonSitemaps(query);
  }

  @Get('queue/7745')
  get7745QueueStats() {
    return this.adminService.get7745QueueStats();
  }

  @Get('queue/7745/sitemaps')
  get7745Sitemaps(@Query() query: Admin7745SitemapQueryDto) {
    return this.adminService.get7745Sitemaps(query);
  }

  @Get('queue/sitemaps')
  getSitemaps(@Query() query: AdminSitemapQueryDto) {
    return this.adminService.getSitemaps(query);
  }

  @Get('queue/errors')
  getParserErrors() {
    return this.adminService.getParserErrors();
  }

  @Get('queue/runtime-status')
  getParserRuntimeStatus() {
    return this.adminService.getParserRuntimeStatus();
  }

  @Get('queue/health')
  getParserHealth() {
    return this.adminService.getParserHealth();
  }

  @Get('queue/supplier-summary')
  getSupplierCatalogSummary() {
    return this.adminService.getSupplierCatalogSummary();
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

  @Post('queue/dukon/refresh-sitemaps')
  refreshDukonSitemaps() {
    return this.adminService.refreshDukonSitemaps();
  }

  @Post('queue/dukon/process')
  processDukonQueuedProducts(@Body('limit') limit?: number) {
    return this.adminService.processDukonQueuedProducts(limit || 25);
  }

  @Post('queue/dukon/sitemaps/retry-problems')
  retryProblemDukonSitemaps() {
    return this.adminService.retryProblemDukonSitemaps();
  }

  @Post('queue/dukon/sitemaps/:id/retry')
  retryDukonSitemap(@Param('id') id: string) {
    return this.adminService.retryDukonSitemap(id);
  }

  @Post('queue/7745/refresh-sitemaps')
  refresh7745Sitemaps() {
    return this.adminService.refresh7745Sitemaps();
  }

  @Post('queue/7745/process')
  process7745QueuedProducts(@Body('limit') limit?: number) {
    return this.adminService.process7745QueuedProducts(limit || 25);
  }

  @Post('queue/7745/sitemaps/retry-problems')
  retryProblem7745Sitemaps() {
    return this.adminService.retryProblem7745Sitemaps();
  }

  @Post('queue/7745/sitemaps/:id/retry')
  retry7745Sitemap(@Param('id') id: string) {
    return this.adminService.retry7745Sitemap(id);
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

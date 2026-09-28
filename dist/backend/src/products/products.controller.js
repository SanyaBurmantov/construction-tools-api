"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const products_service_1 = require("./products.service");
const create_product_dto_1 = require("./dto/create-product.dto");
const update_product_dto_1 = require("./dto/update-product.dto");
let ProductsController = class ProductsController {
    productsService;
    constructor(productsService) {
        this.productsService = productsService;
    }
    create(createProductDto) {
        return this.productsService.create(createProductDto);
    }
    findAll(page, limit, search, brand, categoryId, minPrice, maxPrice, inStock) {
        const filters = {
            search,
            brand: Array.isArray(brand) ? brand : brand ? [brand] : undefined,
            categoryId,
            minPrice,
            maxPrice,
            inStock: inStock === 'true' ? true : inStock === 'false' ? false : undefined,
        };
        return this.productsService.findAll(filters, page || 1, limit || 20);
    }
    getFacetOptions(categoryId) {
        return this.productsService.getFacetOptions(categoryId);
    }
    findOne(id) {
        return this.productsService.findOne(id);
    }
    findBySlug(slug) {
        return this.productsService.findBySlug(slug);
    }
    update(id, updateProductDto) {
        return this.productsService.update(id, updateProductDto);
    }
    remove(id) {
        return this.productsService.remove(id);
    }
    hardDelete(id) {
        return this.productsService.hardDelete(id);
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Создать новый товар' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Товар успешно создан' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Ошибка валидации' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_product_dto_1.CreateProductDto]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Получить список товаров с фильтрацией' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number, description: 'Страница' }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number, description: 'Лимит' }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false, description: 'Поиск' }),
    (0, swagger_1.ApiQuery)({ name: 'brand', required: false, description: 'Бренд (можно несколько)' }),
    (0, swagger_1.ApiQuery)({ name: 'categoryId', required: false, description: 'ID категории' }),
    (0, swagger_1.ApiQuery)({ name: 'minPrice', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'maxPrice', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'inStock', required: false, type: Boolean }),
    __param(0, (0, common_1.Query)('page', new common_1.ParseIntPipe({ optional: true }))),
    __param(1, (0, common_1.Query)('limit', new common_1.ParseIntPipe({ optional: true }))),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('brand')),
    __param(4, (0, common_1.Query)('categoryId')),
    __param(5, (0, common_1.Query)('minPrice', new common_1.ParseIntPipe({ optional: true }))),
    __param(6, (0, common_1.Query)('maxPrice', new common_1.ParseIntPipe({ optional: true }))),
    __param(7, (0, common_1.Query)('inStock')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number, String, Object, String, Number, Number, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('facets/:categoryId'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить опции фасетных фильтров для категории' }),
    (0, swagger_1.ApiParam)({ name: 'categoryId', description: 'ID категории' }),
    __param(0, (0, common_1.Param)('categoryId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getFacetOptions", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить товар по ID' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID товара' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Товар найден' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Товар не найден' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('slug/:slug'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить товар по slug' }),
    (0, swagger_1.ApiParam)({ name: 'slug', description: 'URL-слаг товара' }),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "findBySlug", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Обновить товар' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID товара' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_product_dto_1.UpdateProductDto]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Удалить товар (soft delete)' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID товара' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "remove", null);
__decorate([
    (0, common_1.Delete)(':id/hard'),
    (0, swagger_1.ApiOperation)({ summary: 'Удалить товар полностью' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID товара' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "hardDelete", null);
exports.ProductsController = ProductsController = __decorate([
    (0, swagger_1.ApiTags)('products'),
    (0, common_1.Controller)('products'),
    __metadata("design:paramtypes", [products_service_1.ProductsService])
], ProductsController);
//# sourceMappingURL=products.controller.js.map
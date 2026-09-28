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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateProductDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateProductDto {
    name;
    slug;
    description;
    brand;
    model;
    article;
    barcode;
    price;
    currency;
    oldPrice;
    discount;
    inStock;
    stockQuantity;
    availabilityText;
    weight;
    dimensions;
    categoryId;
    sourceWebsiteId;
    sourceUrl;
    sourceId;
    images;
    mainImage;
    specifications;
    features;
    countryOfOrigin;
    warranty;
    manufacturer;
    isActive;
}
exports.CreateProductDto = CreateProductDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Название товара' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'URL-слаг' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Описание' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Бренд' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "brand", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Модель' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "model", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Артикул' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "article", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Штрихкод' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "barcode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Цена' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateProductDto.prototype, "price", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Валюта', default: 'BYN' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Старая цена' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateProductDto.prototype, "oldPrice", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Скидка в процентах' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateProductDto.prototype, "discount", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'В наличии', default: false }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateProductDto.prototype, "inStock", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Количество на складе' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateProductDto.prototype, "stockQuantity", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Текст доступности' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "availabilityText", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Вес в кг' }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateProductDto.prototype, "weight", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Габариты', example: { length: 10, width: 5, height: 3 } }),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], CreateProductDto.prototype, "dimensions", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID категории' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "categoryId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID источника' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "sourceWebsiteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'URL источника' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "sourceUrl", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID в источнике' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "sourceId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Изображения', type: [String] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], CreateProductDto.prototype, "images", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Главное изображение' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "mainImage", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Характеристики', example: { "Мощность": "2200 Вт", "Вес": "5.2 кг" } }),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], CreateProductDto.prototype, "specifications", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Особенности', type: [String] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], CreateProductDto.prototype, "features", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Страна происхождения' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "countryOfOrigin", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Гарантия' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "warranty", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Производитель' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateProductDto.prototype, "manufacturer", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Активен', default: true }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateProductDto.prototype, "isActive", void 0);
//# sourceMappingURL=create-product.dto.js.map
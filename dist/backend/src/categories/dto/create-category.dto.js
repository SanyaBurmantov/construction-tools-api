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
exports.CreateCategoryDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateCategoryDto {
    name;
    slug;
    parentId;
    sourceWebsiteId;
    depth;
}
exports.CreateCategoryDto = CreateCategoryDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Название категории' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'URL-слаг' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "slug", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID родительской категории' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "parentId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'ID источника' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateCategoryDto.prototype, "sourceWebsiteId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Глубина вложенности' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateCategoryDto.prototype, "depth", void 0);
//# sourceMappingURL=create-category.dto.js.map
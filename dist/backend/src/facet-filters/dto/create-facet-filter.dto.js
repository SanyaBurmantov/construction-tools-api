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
exports.CreateFacetFilterDto = exports.FilterType = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var FilterType;
(function (FilterType) {
    FilterType["RANGE"] = "RANGE";
    FilterType["SELECT"] = "SELECT";
    FilterType["BOOLEAN"] = "BOOLEAN";
    FilterType["MULTISELECT"] = "MULTISELECT";
})(FilterType || (exports.FilterType = FilterType = {}));
class CreateFacetFilterDto {
    name;
    field;
    type;
    categoryId;
    isEnabled;
    sortOrder;
    config;
}
exports.CreateFacetFilterDto = CreateFacetFilterDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Название фильтра (например, "Цена", "Бренд")' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateFacetFilterDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Поле товара для фильтрации' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateFacetFilterDto.prototype, "field", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: FilterType, description: 'Тип фильтра' }),
    (0, class_validator_1.IsEnum)(FilterType),
    __metadata("design:type", String)
], CreateFacetFilterDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'ID категории' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateFacetFilterDto.prototype, "categoryId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Включен', default: true }),
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateFacetFilterDto.prototype, "isEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Порядок сортировки' }),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], CreateFacetFilterDto.prototype, "sortOrder", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Дополнительная конфигурация', example: { min: 0, max: 100000 } }),
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], CreateFacetFilterDto.prototype, "config", void 0);
//# sourceMappingURL=create-facet-filter.dto.js.map
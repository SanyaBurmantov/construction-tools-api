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
exports.FacetFiltersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const facet_filters_service_1 = require("./facet-filters.service");
const create_facet_filter_dto_1 = require("./dto/create-facet-filter.dto");
const update_facet_filter_dto_1 = require("./dto/update-facet-filter.dto");
let FacetFiltersController = class FacetFiltersController {
    facetFiltersService;
    constructor(facetFiltersService) {
        this.facetFiltersService = facetFiltersService;
    }
    create(createFacetFilterDto) {
        return this.facetFiltersService.create(createFacetFilterDto);
    }
    findAll(categoryId) {
        return this.facetFiltersService.findAll(categoryId);
    }
    getFiltersForCategory(categoryId) {
        return this.facetFiltersService.getFiltersForCategory(categoryId);
    }
    findOne(id) {
        return this.facetFiltersService.findOne(id);
    }
    update(id, updateFacetFilterDto) {
        return this.facetFiltersService.update(id, updateFacetFilterDto);
    }
    toggleEnabled(id) {
        return this.facetFiltersService.toggleEnabled(id);
    }
    remove(id) {
        return this.facetFiltersService.remove(id);
    }
};
exports.FacetFiltersController = FacetFiltersController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Создать новый фильтр' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Фильтр успешно создан' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_facet_filter_dto_1.CreateFacetFilterDto]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Получить список фильтров' }),
    (0, swagger_1.ApiQuery)({ name: 'categoryId', required: false, description: 'ID категории' }),
    __param(0, (0, common_1.Query)('categoryId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('category/:categoryId'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить фильтры для категории' }),
    (0, swagger_1.ApiParam)({ name: 'categoryId', description: 'ID категории' }),
    __param(0, (0, common_1.Param)('categoryId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "getFiltersForCategory", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить фильтр по ID' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID фильтра' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Обновить фильтр' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID фильтра' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_facet_filter_dto_1.UpdateFacetFilterDto]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/toggle'),
    (0, swagger_1.ApiOperation)({ summary: 'Включить/выключить фильтр' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID фильтра' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "toggleEnabled", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Удалить фильтр' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID фильтра' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FacetFiltersController.prototype, "remove", null);
exports.FacetFiltersController = FacetFiltersController = __decorate([
    (0, swagger_1.ApiTags)('facet-filters'),
    (0, common_1.Controller)('facet-filters'),
    __metadata("design:paramtypes", [facet_filters_service_1.FacetFiltersService])
], FacetFiltersController);
//# sourceMappingURL=facet-filters.controller.js.map
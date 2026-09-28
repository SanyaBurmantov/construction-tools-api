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
exports.SourceWebsitesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const source_websites_service_1 = require("./source-websites.service");
const create_source_website_dto_1 = require("./dto/create-source-website.dto");
const update_source_website_dto_1 = require("./dto/update-source-website.dto");
let SourceWebsitesController = class SourceWebsitesController {
    sourceWebsitesService;
    constructor(sourceWebsitesService) {
        this.sourceWebsitesService = sourceWebsitesService;
    }
    create(createSourceWebsiteDto) {
        return this.sourceWebsitesService.create(createSourceWebsiteDto);
    }
    findAll() {
        return this.sourceWebsitesService.findAll();
    }
    findOne(id) {
        return this.sourceWebsitesService.findOne(id);
    }
    findByUrl(url) {
        return this.sourceWebsitesService.findByUrl(url);
    }
    update(id, updateSourceWebsiteDto) {
        return this.sourceWebsitesService.update(id, updateSourceWebsiteDto);
    }
    toggleActive(id) {
        return this.sourceWebsitesService.toggleActive(id);
    }
    getParserConfig(id) {
        return this.sourceWebsitesService.getParserConfig(id);
    }
    remove(id) {
        return this.sourceWebsitesService.remove(id);
    }
};
exports.SourceWebsitesController = SourceWebsitesController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Добавить источник для парсинга' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Источник успешно добавлен' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_source_website_dto_1.CreateSourceWebsiteDto]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Получить список источников' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить источник по ID' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID источника' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('url/*'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить источник по URL' }),
    (0, swagger_1.ApiQuery)({ name: 'url', description: 'Базовый URL источника' }),
    __param(0, (0, common_1.Query)('url')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "findByUrl", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Обновить источник' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID источника' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_source_website_dto_1.UpdateSourceWebsiteDto]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/toggle'),
    (0, swagger_1.ApiOperation)({ summary: 'Включить/выключить источник' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID источника' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "toggleActive", null);
__decorate([
    (0, common_1.Get)(':id/parser-config'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить конфиг парсера' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID источника' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "getParserConfig", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Удалить источник' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'ID источника' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceWebsitesController.prototype, "remove", null);
exports.SourceWebsitesController = SourceWebsitesController = __decorate([
    (0, swagger_1.ApiTags)('source-websites'),
    (0, common_1.Controller)('source-websites'),
    __metadata("design:paramtypes", [source_websites_service_1.SourceWebsitesService])
], SourceWebsitesController);
//# sourceMappingURL=source-websites.controller.js.map
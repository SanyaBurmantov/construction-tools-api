"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateFacetFilterDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_facet_filter_dto_1 = require("./create-facet-filter.dto");
class UpdateFacetFilterDto extends (0, mapped_types_1.PartialType)(create_facet_filter_dto_1.CreateFacetFilterDto) {
}
exports.UpdateFacetFilterDto = UpdateFacetFilterDto;
//# sourceMappingURL=update-facet-filter.dto.js.map
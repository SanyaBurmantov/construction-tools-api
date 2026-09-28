"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateSourceWebsiteDto = void 0;
const mapped_types_1 = require("@nestjs/mapped-types");
const create_source_website_dto_1 = require("./create-source-website.dto");
class UpdateSourceWebsiteDto extends (0, mapped_types_1.PartialType)(create_source_website_dto_1.CreateSourceWebsiteDto) {
}
exports.UpdateSourceWebsiteDto = UpdateSourceWebsiteDto;
//# sourceMappingURL=update-source-website.dto.js.map
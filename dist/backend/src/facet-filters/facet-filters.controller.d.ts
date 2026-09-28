import { FacetFiltersService } from './facet-filters.service';
import { CreateFacetFilterDto } from './dto/create-facet-filter.dto';
import { UpdateFacetFilterDto } from './dto/update-facet-filter.dto';
export declare class FacetFiltersController {
    private readonly facetFiltersService;
    constructor(facetFiltersService: FacetFiltersService);
    create(createFacetFilterDto: CreateFacetFilterDto): Promise<any>;
    findAll(categoryId?: string): Promise<any>;
    getFiltersForCategory(categoryId: string): Promise<any>;
    findOne(id: string): Promise<any>;
    update(id: string, updateFacetFilterDto: UpdateFacetFilterDto): Promise<any>;
    toggleEnabled(id: string): Promise<any>;
    remove(id: string): Promise<any>;
}

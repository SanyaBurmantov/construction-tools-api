import { PrismaService } from '../prisma/prisma.service';
import { CreateFacetFilterDto } from './dto/create-facet-filter.dto';
import { UpdateFacetFilterDto } from './dto/update-facet-filter.dto';
export declare class FacetFiltersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createFacetFilterDto: CreateFacetFilterDto): Promise<any>;
    findAll(categoryId?: string): Promise<any>;
    findOne(id: string): Promise<any>;
    update(id: string, updateFacetFilterDto: UpdateFacetFilterDto): Promise<any>;
    remove(id: string): Promise<any>;
    getFiltersForCategory(categoryId: string): Promise<any>;
    toggleEnabled(id: string): Promise<any>;
}

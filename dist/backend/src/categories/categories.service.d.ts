import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createCategoryDto: CreateCategoryDto): Promise<any>;
    findAll(sourceWebsiteId?: string): Promise<any>;
    getTree(sourceWebsiteId?: string): Promise<any>;
    findOne(id: string): Promise<any>;
    findBySlug(slug: string): Promise<any>;
    update(id: string, updateCategoryDto: UpdateCategoryDto): Promise<any>;
    remove(id: string): Promise<any>;
}

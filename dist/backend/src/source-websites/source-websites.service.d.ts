import { PrismaService } from '../prisma/prisma.service';
import { CreateSourceWebsiteDto } from './dto/create-source-website.dto';
import { UpdateSourceWebsiteDto } from './dto/update-source-website.dto';
export declare class SourceWebsitesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createSourceWebsiteDto: CreateSourceWebsiteDto): Promise<any>;
    findAll(): Promise<any>;
    findOne(id: string): Promise<any>;
    findByUrl(baseUrl: string): Promise<any>;
    update(id: string, updateSourceWebsiteDto: UpdateSourceWebsiteDto): Promise<any>;
    remove(id: string): Promise<any>;
    toggleActive(id: string): Promise<any>;
    getParserConfig(id: string): Promise<any>;
}

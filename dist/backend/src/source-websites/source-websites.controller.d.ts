import { SourceWebsitesService } from './source-websites.service';
import { CreateSourceWebsiteDto } from './dto/create-source-website.dto';
import { UpdateSourceWebsiteDto } from './dto/update-source-website.dto';
export declare class SourceWebsitesController {
    private readonly sourceWebsitesService;
    constructor(sourceWebsitesService: SourceWebsitesService);
    create(createSourceWebsiteDto: CreateSourceWebsiteDto): Promise<any>;
    findAll(): Promise<any>;
    findOne(id: string): Promise<any>;
    findByUrl(url: string): Promise<any>;
    update(id: string, updateSourceWebsiteDto: UpdateSourceWebsiteDto): Promise<any>;
    toggleActive(id: string): Promise<any>;
    getParserConfig(id: string): Promise<any>;
    remove(id: string): Promise<any>;
}

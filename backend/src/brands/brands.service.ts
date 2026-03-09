import { Injectable } from '@nestjs/common';
import { TBrand } from './types/brand.type';
import { CreateBrandDto } from './dto/create-brand.dto';

@Injectable()
export class BrandsService {
  private brands: TBrand[] = [];

  create(dto: CreateBrandDto) {
    const brand: TBrand = {
      id: crypto.randomUUID(),

      name: dto.name,

      slug: dto.slug,

      description: dto.description,

      country: dto.country,

      seo: {
        title: dto.name,
        description: dto.name,
      },
    };

    this.brands.push(brand);

    return brand;
  }

  findAll() {
    return this.brands;
  }

  findBySlug(slug: string) {
    return this.brands.find((b) => b.slug === slug);
  }
}

import { Injectable } from '@nestjs/common';
import { TSpecification } from './types/specification.type';
import { CreateSpecificationDto } from './dto/create-specification.dto';

@Injectable()
export class SpecificationsService {
  private specs: TSpecification[] = [];

  create(dto: CreateSpecificationDto) {
    const spec: TSpecification = {
      id: crypto.randomUUID(),

      name: dto.name,

      key: dto.key,

      categoryId: dto.categoryId,

      unit: dto.unit,

      group: dto.group,

      filterable: dto.filterable ?? false,
    };

    this.specs.push(spec);

    return spec;
  }

  findByCategory(categoryId: string) {
    return this.specs.filter((s) => s.categoryId === categoryId);
  }
}

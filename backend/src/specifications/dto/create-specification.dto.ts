export class CreateSpecificationDto {
  name: string;

  key: string;

  categoryId: string;

  unit?: string;

  group?: string;

  filterable?: boolean;
}

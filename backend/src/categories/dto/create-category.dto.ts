export class CreateCategoryDto {
  name: string;

  slug: string;

  parentId?: string;

  description?: string;
}

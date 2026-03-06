export class CreateSourceProductDto {
  sourceId: string;

  externalId: string;

  url: string;

  name: string;

  price?: number;

  currency?: string;
}

export type TSourceSpecification = {
  name: string;

  value: string;
};

export type TSourceProduct = {
  id: string;

  sourceId: string;

  externalId: string;

  url: string;

  name: string;

  price?: number;

  currency?: string;

  stock?: boolean;

  images: string[];

  description?: string;

  specifications: TSourceSpecification[];

  productId?: string;

  lastSync: Date;
};

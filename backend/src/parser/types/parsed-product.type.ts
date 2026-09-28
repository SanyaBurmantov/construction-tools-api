export type TParsedProduct = {
  name: string;

  price?: number;

  images: string[];

  description?: string;

  specifications: {
    name: string;
    value: string;
  }[];
};

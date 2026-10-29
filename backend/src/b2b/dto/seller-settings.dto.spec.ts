import { ValidationPipe } from '@nestjs/common';
import { AdminUpdateSellerDto } from './b2b.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (value: unknown) =>
  pipe.transform(value, {
    type: 'body',
    metatype: AdminUpdateSellerDto,
  }) as Promise<AdminUpdateSellerDto>;

describe('seller settings: VAT rate', () => {
  it('reads a cleared rate as «not sent», not as 0%', async () => {
    expect(
      (await validate({ vatMode: 'INCLUDED', vatRate: '' })).vatRate,
    ).toBeUndefined();
    expect((await validate({ vatRate: null })).vatRate).toBeUndefined();
  });

  it('keeps a typed rate and refuses garbage', async () => {
    expect((await validate({ vatRate: '20' })).vatRate).toBe(20);
    await expect(validate({ vatRate: 'двадцать' })).rejects.toThrow();
  });
});

import { ValidationPipe } from '@nestjs/common';
import { AdminCreateBrandDto } from './admin-create-brand.dto';
import { AdminUpdateBrandDto } from './admin-update-brand.dto';

// The pipe exactly as main.ts sets it up.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (metatype: unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

describe('brand DTOs', () => {
  // The body /admin/brands sends on every save — it answered 400 before.
  const formBody = {
    name: 'Makita',
    slug: 'makita',
    description: null,
    country: 'Япония',
    seoTitle: '',
    seoDescription: 'Инструмент Makita',
  };

  it('accepts what the admin form sends, on create and on update', async () => {
    await expect(
      validate(AdminCreateBrandDto, formBody),
    ).resolves.toBeDefined();
    await expect(
      validate(AdminUpdateBrandDto, formBody),
    ).resolves.toBeDefined();
  });

  it('still refuses fields nobody declared', async () => {
    await expect(
      validate(AdminUpdateBrandDto, { name: 'x', isAdmin: true }),
    ).rejects.toThrow();
  });
});

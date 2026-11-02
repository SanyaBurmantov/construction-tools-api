import { isAdminPath } from './admin-scope';

describe('isAdminPath', () => {
  it.each(['/admin', '/admin/users', '/ADMIN/users', '/Admin/orders/1'])(
    '%s is admin scope',
    (path) => expect(isAdminPath({ path })).toBe(true),
  );

  it.each(['/administrator', '/products/admin', '/', ''])('%s is not', (path) =>
    expect(isAdminPath({ path })).toBe(false),
  );
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { AdminSitemapQueryDto } from './admin-sitemap-query.dto';

describe('AdminSitemapQueryDto', () => {
  const parse = (query: Record<string, string>) =>
    plainToInstance(AdminSitemapQueryDto, query);

  it('reads isVisited=false as false', () => {
    // Regression: `@Type(() => Boolean)` ran Boolean('false') === true, so the
    // "queued" filter in /admin/parsing listed the already-processed URLs.
    expect(parse({ isVisited: 'false' }).isVisited).toBe(false);
  });

  it('reads isVisited=true as true', () => {
    expect(parse({ isVisited: 'true' }).isVisited).toBe(true);
  });

  it('leaves isVisited undefined when absent or empty', () => {
    expect(parse({}).isVisited).toBeUndefined();
    expect(parse({ isVisited: '' }).isVisited).toBeUndefined();
  });

  it('still coerces page and limit to numbers', () => {
    const dto = parse({ page: '3', limit: '50' });
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });
});

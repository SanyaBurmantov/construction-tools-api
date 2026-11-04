import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FEATURE_FLAGS,
  featureKey,
  isFeatureMode,
  resolveFlags,
  type FeatureMode,
} from './feature-flags';

/** Read on every storefront page load — keep it to one query a while. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class FeatureFlagsService {
  private cache: {
    at: number;
    value: Promise<Record<string, FeatureMode>>;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** key → mode for every declared flag. */
  modes(): Promise<Record<string, FeatureMode>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS)
      return this.cache.value;
    const value = this.prisma.siteSetting
      .findMany({
        where: { key: { in: FEATURE_FLAGS.map((f) => featureKey(f.key)) } },
      })
      .then((rows) => resolveFlags(new Map(rows.map((r) => [r.key, r.value]))));
    this.cache = { at: now, value };
    value.catch(() => {
      if (this.cache?.value === value) this.cache = null;
    });
    return value;
  }

  /**
   * For server-side checks: on for everyone, or — in `admins` mode — only
   * when the caller is an admin.
   */
  async isOn(key: string, isAdmin = false): Promise<boolean> {
    const mode = (await this.modes())[key];
    return mode === 'on' || (mode === 'admins' && isAdmin);
  }

  async adminList() {
    const modes = await this.modes();
    return FEATURE_FLAGS.map((flag) => ({
      key: flag.key,
      name: flag.name,
      description: flag.description,
      default: flag.default,
      mode: modes[flag.key],
    }));
  }

  async setMode(key: string, mode: unknown) {
    if (!FEATURE_FLAGS.some((f) => f.key === key)) {
      throw new NotFoundException(`Нет такого флага: ${key}`);
    }
    if (!isFeatureMode(mode)) {
      throw new BadRequestException('mode: off | admins | on');
    }
    await this.prisma.siteSetting.upsert({
      where: { key: featureKey(key) },
      create: { key: featureKey(key), value: mode },
      update: { value: mode },
    });
    this.cache = null;
    return this.adminList();
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreateBannerDto, AdminUpdateBannerDto } from './dto/banner.dto';

/** Fields safe to send to the storefront. */
const PUBLIC_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  imageUrl: true,
  mobileUrl: true,
  linkUrl: true,
  buttonText: true,
  bgColor: true,
} satisfies Prisma.BannerSelect;

@Injectable()
export class BannersService {
  constructor(private prisma: PrismaService) {}

  /** Active banners whose display window covers right now. */
  async listPublic() {
    const now = new Date();
    const data = await this.prisma.banner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: PUBLIC_SELECT,
      take: 10,
    });
    return { data };
  }

  adminList() {
    return this.prisma.banner.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
  }

  private buildData(
    dto: AdminCreateBannerDto,
  ): Prisma.BannerUncheckedCreateInput {
    // On update the merged object mixes stored Dates with incoming ISO strings,
    // so both sides are normalized before being compared.
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && startsAt >= endsAt) {
      throw new BadRequestException('Дата окончания должна быть позже начала');
    }

    return {
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || null,
      imageUrl: dto.imageUrl.trim(),
      mobileUrl: dto.mobileUrl?.trim() || null,
      linkUrl: dto.linkUrl?.trim() || null,
      buttonText: dto.buttonText?.trim() || null,
      bgColor: dto.bgColor?.trim() || null,
      order: dto.order ?? 0,
      isActive: dto.isActive ?? true,
      startsAt,
      endsAt,
    };
  }

  create(dto: AdminCreateBannerDto) {
    return this.prisma.banner.create({ data: this.buildData(dto) });
  }

  async update(id: string, dto: AdminUpdateBannerDto) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Баннер не найден');

    const merged = { ...existing, ...dto } as unknown as AdminCreateBannerDto;
    return this.prisma.banner.update({
      where: { id },
      data: this.buildData(merged),
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Баннер не найден');
    await this.prisma.banner.delete({ where: { id } });
    return { ok: true };
  }
}

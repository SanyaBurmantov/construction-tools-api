import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSourceWebsiteDto } from './dto/create-source-website.dto';
import { UpdateSourceWebsiteDto } from './dto/update-source-website.dto';

@Injectable()
export class SourceWebsitesService {
  constructor(private prisma: PrismaService) {}

  async create(createSourceWebsiteDto: CreateSourceWebsiteDto) {
    return this.prisma.sourceWebsite.create({
      data: createSourceWebsiteDto,
      include: {
        products: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
        categories: true,
        _count: {
          select: { products: true, categories: true },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.sourceWebsite.findMany({
      include: {
        products: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
        categories: {
          take: 10,
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { products: true, categories: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const sourceWebsite = await this.prisma.sourceWebsite.findUnique({
      where: { id },
      include: {
        products: {
          orderBy: { createdAt: 'desc' },
        },
        categories: {
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { products: true, categories: true },
        },
      },
    });

    if (!sourceWebsite) {
      throw new NotFoundException(
        `Source website with ID ${id} not found`,
      );
    }

    return sourceWebsite;
  }

  async findByUrl(baseUrl: string) {
    const sourceWebsite = await this.prisma.sourceWebsite.findFirst({
      where: { baseUrl },
      include: {
        products: true,
        categories: true,
      },
    });

    if (!sourceWebsite) {
      throw new NotFoundException(
        `Source website with URL ${baseUrl} not found`,
      );
    }

    return sourceWebsite;
  }

  async update(id: string, updateSourceWebsiteDto: UpdateSourceWebsiteDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.sourceWebsite.update({
      where: { id },
      data: updateSourceWebsiteDto,
      include: {
        products: true,
        categories: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.sourceWebsite.delete({
      where: { id },
    });
  }

  async toggleActive(id: string) {
    const website = await this.findOne(id);

    return this.prisma.sourceWebsite.update({
      where: { id },
      data: { isActive: !website.isActive },
      include: {
        products: true,
        categories: true,
      },
    });
  }

  async getParserConfig(id: string) {
    const website = await this.findOne(id);
    return website.parserConfig || {};
  }
}

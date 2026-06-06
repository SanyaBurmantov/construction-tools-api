import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SpecificationsService } from './specifications.service';
import { CreateSpecificationDto } from './dto/create-specification.dto';
import { AdminGuard } from '../admin/admin.guard';

@Controller('specifications')
export class SpecificationsController {
  constructor(private service: SpecificationsService) {}

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateSpecificationDto) {
    return this.service.create(dto);
  }

  @Get('category/:id')
  getByCategory(@Param('id') id: string) {
    return this.service.findByCategory(id);
  }
}

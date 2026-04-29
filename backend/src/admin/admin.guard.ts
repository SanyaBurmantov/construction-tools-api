import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.ADMIN_TOKEN;

    if (!token) {
      throw new UnauthorizedException('ADMIN_TOKEN is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (request.header('x-admin-token') !== token) {
      throw new UnauthorizedException('Invalid admin token');
    }

    return true;
  }
}

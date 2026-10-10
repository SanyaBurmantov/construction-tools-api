import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
} from './dto/update-profile.dto';
import { CurrentSessionId, CurrentUser } from './current-user.decorator';
import { bearerToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';
import type { AuthenticatedUser } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Registration always produces a CUSTOMER. Throttled far below the global
   * 120/min: creating accounts is a human action, and the endpoint writes a
   * row plus a scrypt hash per call.
   */
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: AuthenticatedRequest) {
    return this.auth.register(dto, request.header('user-agent'));
  }

  /** 10 attempts per 5 minutes per IP — enough for a typo, not for a list. */
  @Throttle({ default: { limit: 10, ttl: 5 * 60 * 1000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: AuthenticatedRequest) {
    return this.auth.login(dto, request.header('user-agent'));
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Req() request: AuthenticatedRequest) {
    const token = bearerToken(request);
    // Idempotent on purpose: logging out twice, or with a stale token, is a
    // success as far as the client is concerned.
    return token ? this.auth.logout(token) : Promise.resolve({ ok: true });
  }

  /** Drops every session of the account, including this one. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutEverywhere(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.id, dto);
  }

  /**
   * Closes the account. Orders stay in the shop's records (unlinked), so this
   * is "delete my account", not "delete my history".
   */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @HttpCode(200)
  @Delete('me')
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.auth.deleteOwnAccount(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @HttpCode(200)
  @Post('password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionId() sessionId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, sessionId, dto);
  }
}

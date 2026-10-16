import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { AuthGuard } from './auth.guard';
import { RegisterDto, VerifyEmailDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
} from './dto/update-profile.dto';
import { CurrentSessionId, CurrentUser } from './current-user.decorator';
import { readSessionToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';
import type { AuthenticatedUser } from './auth.service';
import {
  assertNotCrossSite,
  clearSessionCookie,
  setSessionCookie,
  wantsBearerTransport,
} from './session-cookie';

type IssuedSession = { token: string; expiresAt: Date };

/**
 * Hands a fresh session to the client. A browser gets it as the HttpOnly
 * cookie and the body carries **no token** — page script never sees one. A
 * script that asked with `X-Auth-Transport: bearer` gets the token in the
 * body instead (and no cookie) to send as `Authorization: Bearer`.
 */
function deliverSession<T extends IssuedSession>(
  session: T,
  request: AuthenticatedRequest,
  response: Response,
) {
  if (wantsBearerTransport(request)) return session;
  setSessionCookie(response, session.token, session.expiresAt);
  const { token: _token, ...rest } = session;
  void _token;
  return rest;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * Registration always produces a CUSTOMER. Throttled far below the global
   * 120/min: creating accounts is a human action, and the endpoint writes a
   * row plus a scrypt hash per call.
   */
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Login CSRF: a foreign page must not plant an account in the visitor's
    // browser. Lenient — curl names no origin and is fine.
    assertNotCrossSite(request, false);
    const session = await this.auth.register(dto, request.header('user-agent'));
    return deliverSession(session, request, response);
  }

  /** 10 attempts per 5 minutes per IP — enough for a typo, not for a list. */
  @Throttle({ default: { limit: 10, ttl: 5 * 60 * 1000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertNotCrossSite(request, false);
    const session = await this.auth.login(dto, request.header('user-agent'));
    return deliverSession(session, request, response);
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const found = readSessionToken(request);
    if (found?.source === 'cookie') assertNotCrossSite(request);
    // Idempotent on purpose: logging out twice, or with a stale token, is a
    // success as far as the client is concerned. The cookie goes either way.
    clearSessionCookie(response);
    return found ? this.auth.logout(found.token) : { ok: true };
  }

  /** Drops every session of the account, including this one. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logoutEverywhere(user.id);
    clearSessionCookie(response);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.id);
  }

  /**
   * Throttled because an e-mail change sends a letter from the shop's SMTP
   * box: unlimited, one account could relay mail to arbitrary addresses.
   */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
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
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.deleteOwnAccount(user.id, dto);
    clearSessionCookie(response);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @HttpCode(200)
  @Post('password')
  // The cookie is deliberately left alone: a password change ends every
  // *other* session and keeps this one — the device that just proved the
  // password stays signed in, as before.
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSessionId() sessionId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, sessionId, dto);
  }

  /**
   * The link from the confirmation letter. Public: it is often opened on
   * another device (the phone's mail app) where no session exists, and the
   * 256-bit token is the proof.
   */
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.emailVerification.confirm(dto.token);
  }

  /** «Отправить письмо ещё раз». Throttled hard — every call sends a letter. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @HttpCode(200)
  @Post('verify-email/resend')
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.emailVerification.resend(user.id);
  }
}

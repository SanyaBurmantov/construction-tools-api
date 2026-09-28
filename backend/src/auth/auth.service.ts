import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signUp(signUpDto: SignUpDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: signUpDto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(signUpDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...signUpDto,
        email: signUpDto.email,
        password: hashedPassword,
      },
    });

    const { password, ...result } = user;
    return result;
  }

  async signIn(signInDto: SignInDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: signInDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(signInDto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, ...result } = user;

    const payload = { sub: user.id, email: user.email };
    return {
      user: result,
      accessToken: this.jwtService.sign(payload),
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }
}

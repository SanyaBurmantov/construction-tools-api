import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    signUp(signUpDto: SignUpDto): Promise<any>;
    signIn(signInDto: SignInDto): Promise<{
        user: any;
        accessToken: any;
    }>;
    validateUser(email: string, password: string): Promise<any>;
}

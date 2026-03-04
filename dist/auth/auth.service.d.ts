import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    signUp(signUpDto: SignUpDto): Promise<{
        email: string;
        login: string | null;
        name: string | null;
        surname: string | null;
        id: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    signIn(signInDto: SignInDto): Promise<{
        user: {
            email: string;
            login: string | null;
            name: string | null;
            surname: string | null;
            id: string;
            createdAt: Date;
            updatedAt: Date;
        };
        accessToken: string;
    }>;
    validateUser(email: string, password: string): Promise<any>;
}

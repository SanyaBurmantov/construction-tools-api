import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
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
    getProfile(req: any): Promise<any>;
}

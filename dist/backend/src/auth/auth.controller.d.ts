import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    signUp(signUpDto: SignUpDto): Promise<any>;
    signIn(signInDto: SignInDto): Promise<{
        user: any;
        accessToken: any;
    }>;
    getProfile(req: any): Promise<any>;
}

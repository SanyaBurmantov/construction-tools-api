import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { PromoModule } from '../promo/promo.module';

@Module({
  // PromoService owns the "is this code usable right now" rules; AuthService
  // and AuthGuard come from the global AuthModule.
  imports: [PromoModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}

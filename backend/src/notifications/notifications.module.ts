import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { MailService } from './mail.service';

@Module({
  providers: [TelegramService, MailService],
  exports: [TelegramService, MailService],
})
export class NotificationsModule {}

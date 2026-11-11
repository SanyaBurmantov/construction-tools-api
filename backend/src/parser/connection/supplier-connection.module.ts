import { Global, Module } from '@nestjs/common';
import { SupplierConnectionCron } from './supplier-connection.cron';
import { SupplierConnectionService } from './supplier-connection.service';

/**
 * Global on purpose: the parsers, the sitemap reader, the category crawler and
 * the photo mirror (MediaModule) all reach suppliers, and the service needs
 * nothing but Prisma — importing ParserModule into MediaModule for it would
 * drag the whole parser graph along.
 */
@Global()
@Module({
  providers: [SupplierConnectionService, SupplierConnectionCron],
  exports: [SupplierConnectionService],
})
export class SupplierConnectionModule {}

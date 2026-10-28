import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { B2bAdminController, B2bController } from './b2b.controller';
import { DocumentsService } from './documents.service';
import { LeadsService } from './leads.service';
import { PriceListService } from './price-list.service';
import { PurchaseListsService } from './purchase-lists.service';
import { SellerService } from './seller.service';

/**
 * What a company buyer needs beyond the cart: the invoice and the quote as
 * PDF, the XLSX price list, purchase lists, leads, and the seller's
 * requisites behind all of them.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [B2bController, B2bAdminController],
  providers: [
    SellerService,
    DocumentsService,
    LeadsService,
    PriceListService,
    PurchaseListsService,
  ],
  exports: [SellerService],
})
export class B2bModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminGuard } from '../admin/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser, OptionalUserId } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.service';
import { DocumentsService, type PdfFile } from './documents.service';
import { LeadsService } from './leads.service';
import { PriceListService } from './price-list.service';
import { PurchaseListsService } from './purchase-lists.service';
import { SellerService, missingForInvoice } from './seller.service';
import {
  AdminLeadQueryDto,
  AdminUpdateLeadDto,
  AdminUpdateSellerDto,
  PriceListQueryDto,
  PurchaseListDto,
  QuestionDto,
  QuoteRequestDto,
  UpdatePurchaseListDto,
} from './dto/b2b.dto';

const TEN_MINUTES = 10 * 60 * 1000;

function sendPdf(res: Response, file: PdfFile, inline = true) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(file.pdf.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.filename}"`,
    // Prices and requisites change; a cached copy would outlive both.
    'Cache-Control': 'private, no-store',
  });
  res.end(file.pdf);
}

/** Storefront side: documents, leads, the price list, purchase lists. */
@ApiTags('B2B')
@Controller()
export class B2bController {
  constructor(
    private documents: DocumentsService,
    private leads: LeadsService,
    private priceList: PriceListService,
    private lists: PurchaseListsService,
    private seller: SellerService,
  ) {}

  /**
   * The shop's requisites for the page for organisations, and whether an
   * invoice can be issued automatically right now.
   */
  @Get('seller')
  async getSeller() {
    const seller = await this.seller.get();
    return {
      name: seller.name,
      unp: seller.unp,
      legalAddress: seller.legalAddress,
      bankAccount: seller.bankAccount,
      bankName: seller.bankName,
      bankBic: seller.bankBic,
      vatMode: seller.vatMode,
      vatRate: seller.vatRate,
      validDays: seller.validDays,
      invoiceReady: missingForInvoice(seller).length === 0,
    };
  }

  /**
   * The invoice of an order, by its unguessable UUID — the same access rule
   * as the order confirmation, so a guest who ordered can download it, and
   * a link in the confirmation letter works without signing in.
   */
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @Get('orders/:id/invoice.pdf')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendPdf(res, await this.documents.invoiceForOrder(id));
  }

  /** A commercial offer for the cart. Records a lead. */
  @Throttle({ default: { limit: 10, ttl: TEN_MINUTES } })
  @UseGuards(OptionalAuthGuard)
  @Post('documents/quote')
  @HttpCode(200)
  async quote(
    @Body() dto: QuoteRequestDto,
    @OptionalUserId() userId: string | undefined,
    @Ip() ip: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.documents.quote(dto, userId, ip), false);
  }

  /** «Уточнить наличие / подобрать аналог», the form for organisations. */
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES } })
  @UseGuards(OptionalAuthGuard)
  @Post('leads')
  createLead(
    @Body() dto: QuestionDto,
    @OptionalUserId() userId: string | undefined,
    @Ip() ip: string,
  ) {
    return this.leads.createQuestion(dto, userId, ip);
  }

  /** XLSX price list: whole catalogue, a category subtree or a brand. */
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES } })
  @Get('price-list.xlsx')
  async downloadPriceList(
    @Query() query: PriceListQueryDto,
    @Res() res: Response,
  ) {
    // Resolved first, so an unknown category is a clean 404, not a broken
    // half-written file.
    const prepared = await this.priceList.prepare(query);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${prepared.filename}"`,
      'Cache-Control': 'no-store',
    });
    await this.priceList.write(prepared, res);
  }

  /* ---- The account's purchase lists ----------------------------------- */

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('account/purchase-lists')
  getLists(@CurrentUser() user: AuthenticatedUser) {
    return this.lists.list(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('account/purchase-lists')
  createList(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PurchaseListDto,
  ) {
    return this.lists.create(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('account/purchase-lists/:id')
  updateList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseListDto,
  ) {
    return this.lists.update(user.id, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete('account/purchase-lists/:id')
  deleteList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lists.remove(user.id, id);
  }
}

/** Admin side: the seller's requisites and the leads inbox. */
@ApiTags('B2B admin')
@UseGuards(AdminGuard)
@Controller('admin')
export class B2bAdminController {
  constructor(
    private leads: LeadsService,
    private seller: SellerService,
  ) {}

  @Get('seller')
  async getSeller() {
    const seller = await this.seller.get();
    return { seller, missing: missingForInvoice(seller) };
  }

  @Patch('seller')
  updateSeller(@Body() dto: AdminUpdateSellerDto) {
    return this.seller.update(dto);
  }

  @Get('leads')
  listLeads(@Query() query: AdminLeadQueryDto) {
    return this.leads.list(query);
  }

  @Patch('leads/:id')
  updateLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateLeadDto,
  ) {
    return this.leads.updateStatus(id, dto);
  }
}

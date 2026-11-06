import { Global, Module } from '@nestjs/common';
import { PayerRegistryService } from './payer-registry.service';
import { RequisitesController } from './requisites.controller';

/**
 * Global: registration (AuthModule, itself global) and `POST /orders` both
 * check a УНП against the payer registry, and importing this into AuthModule
 * would be the only dependency AuthModule has on a feature module.
 */
@Global()
@Module({
  providers: [PayerRegistryService],
  controllers: [RequisitesController],
  exports: [PayerRegistryService],
})
export class RequisitesModule {}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupplierConnectionService } from './supplier-connection.service';

/**
 * Knocks on every supplier's home page every 10 minutes, directly and through
 * the proxy. Without it a blocked source would never be tried again — its
 * batches are not started while the route is BLOCKED — so the probe is what
 * notices a lifted ban and switches `auto` back to direct. Worker only: the
 * schedule module is not loaded in the API.
 */
@Injectable()
export class SupplierConnectionCron {
  private readonly logger = new Logger(SupplierConnectionCron.name);
  private running = false;

  constructor(private readonly connection: SupplierConnectionService) {}

  @Cron('0 4,14,24,34,44,54 * * * *')
  async probe() {
    if (this.running) return;
    this.running = true;
    try {
      await this.connection.probeAll();
    } catch (error) {
      this.logger.warn(`Supplier probe failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

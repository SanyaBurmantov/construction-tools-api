import { ParserService } from './parser.service';
import { ParserQueue } from './queue/parser.queue';

export class ParserWorker {
  constructor(
    private parserService: ParserService,
    private queue: ParserQueue,
  ) {}

  async run() {
    while (true) {
      const url = this.queue.next();

      if (!url) {
        await new Promise((r) => setTimeout(r, 1000));

        continue;
      }

      const product = await this.parserService.parseProduct(url);

      console.log(product);
    }
  }
}

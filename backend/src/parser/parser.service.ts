import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { parseTM } from './sites/tm.parser';
import { parseTools } from './sites/tools.parser';
import { parseThTools } from './sites/th-tools.parser';
import { parse7745 } from './sites/7745.parser';

@Injectable()
export class ParserService {
  async fetch(url: string): Promise<string> {
    const response = await axios.get<string>(url);

    return response.data;
  }

  async parseProduct(url: string) {
    const html = await this.fetch(url);

    if (url.includes('tm.by')) {
      return parseTM(html);
    }

    if (url.includes('tools.by')) {
      return parseTools(html);
    }

    if (url.includes('th-tool.by')) {
      return parseThTools(html);
    }

    if (url.includes('7745.by')) {
      return parse7745(html);
    }

    throw new Error('unknown source');
  }

  async crawlCategory(url: string) {
    const html = await this.fetch(url);

    const $ = this.load(html);

    const links: string[] = [];

    $('.product-card a').each((_, el) => {
      const href = $(el).attr('href');

      if (!href) return;

      links.push('https://tm.by' + href);
    });

    return links;
  }

  load(html: string) {
    return cheerio.load(html);
  }
}

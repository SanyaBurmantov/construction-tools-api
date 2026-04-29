import axios from 'axios';
import * as cheerio from 'cheerio';

export async function crawlTMCategory(url: string) {
  const { data } = await axios.get<string>(url);

  const $ = cheerio.load(data);

  const links: string[] = [];

  $('.product-card a').each((_, el) => {
    const href = $(el).attr('href');

    if (!href) return;

    const full = 'https://tm.by' + href;

    links.push(full);
  });

  return links;
}

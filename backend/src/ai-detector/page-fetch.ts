import { BadRequestException } from '@nestjs/common';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import { extractPageText, type PageText } from './page-text';
import { assertPublicUrl, UnsafeUrlError } from './safe-url';

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PAGE_USER_AGENT =
  'Mozilla/5.0 (compatible; GostByTextCheck/1.0; +https://gost.by)';

/**
 * Fetches a public page and returns its readable text. Redirects are followed
 * by hand so every hop is vetted by `assertPublicUrl` — otherwise a page could
 * send the server to `backend:8000` or `db`. Errors are 400s worded for the
 * person who typed the address.
 */
export async function fetchReadablePage(raw: string): Promise<PageText> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await assertPublicUrl(current);
    } catch (error) {
      if (error instanceof UnsafeUrlError)
        throw new BadRequestException(error.message);
      throw error;
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url.toString(),
        {
          redirect: 'manual',
          headers: {
            'User-Agent': PAGE_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru,en;q=0.5',
          },
        },
        { timeoutMs: 15_000, retries: 1, maxBytes: MAX_PAGE_BYTES },
      );
    } catch (error) {
      const message = (error as Error).message;
      throw new BadRequestException(
        /too large|maxBytes|exceeds/i.test(message)
          ? 'Страница больше 5 МБ'
          : 'Страница не открылась (нет ответа)',
      );
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      throw new BadRequestException(`Страница ответила ${res.status}`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml|text\/plain/i.test(type)) {
      throw new BadRequestException('По адресу не веб-страница');
    }
    const body = await res.text();
    return /text\/plain/i.test(type)
      ? { title: null, text: body.trim(), picked: 'текстовый файл' }
      : extractPageText(body);
  }
  throw new BadRequestException('Слишком много перенаправлений');
}

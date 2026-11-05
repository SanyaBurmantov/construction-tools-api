/**
 * What a User-Agent says about the visitor: a bot (dropped), or which kind of
 * screen. Pure, tested.
 */
export type Device = 'mobile' | 'tablet' | 'desktop';

/**
 * Script-running crawlers and preview fetchers. Most bots never run our
 * script, so this only catches the headless ones and link previews.
 */
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|yandex(?!browser|searchapp|\.)|googleother|lighthouse|headless|phantom|puppeteer|playwright|selenium|preview|facebookexternalhit|whatsapp|telegram|vkshare|python-|curl\/|wget\//i;

export function isBotAgent(ua?: string | null): boolean {
  if (!ua) return true;
  return BOT.test(ua);
}

/**
 * `touch` is the browser's own `maxTouchPoints > 1`: iPadOS 13+ presents
 * itself as a Mac, and only that tells it apart from one.
 */
export function deviceFromAgent(ua?: string | null, touch = false): Device {
  const agent = ua ?? '';
  if (/ipad|tablet|playbook|silk|kindle/i.test(agent)) return 'tablet';
  if (/android/i.test(agent) && !/mobile/i.test(agent)) return 'tablet';
  if (
    /mobi|iphone|ipod|android|windows phone|opera mini|iemobile/i.test(agent)
  ) {
    return 'mobile';
  }
  if (touch && /macintosh/i.test(agent)) return 'tablet';
  return 'desktop';
}

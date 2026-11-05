import { deviceFromAgent, isBotAgent } from './visitor-agent';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPAD_OLD =
  'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 YaBrowser/24.10.0.0';
const YANDEX_APP =
  'Mozilla/5.0 (Linux; Android 12; M2101K6G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaSearchBrowser/24.71 BroPP/1.0 YaSearchApp/24.71 Mobile Safari/537.36';

describe('deviceFromAgent', () => {
  it.each([
    [IPHONE, 'mobile'],
    [ANDROID_PHONE, 'mobile'],
    [YANDEX_APP, 'mobile'],
    [ANDROID_TABLET, 'tablet'],
    [IPAD_OLD, 'tablet'],
    [MAC, 'desktop'],
    [WINDOWS, 'desktop'],
  ])('%s → %s', (ua, device) => {
    expect(deviceFromAgent(ua)).toBe(device);
  });

  it('tells a modern iPad (a Mac with touch) from a Mac', () => {
    expect(deviceFromAgent(MAC, true)).toBe('tablet');
    expect(deviceFromAgent(MAC, false)).toBe('desktop');
  });
});

describe('isBotAgent', () => {
  it.each([
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36',
    'TelegramBot (like TwitterBot)',
    'curl/8.5.0',
    '',
  ])('drops %s', (ua) => {
    expect(isBotAgent(ua)).toBe(true);
  });

  it.each([IPHONE, ANDROID_PHONE, WINDOWS, MAC, YANDEX_APP])(
    'keeps a person: %s',
    (ua) => {
      expect(isBotAgent(ua)).toBe(false);
    },
  );
});

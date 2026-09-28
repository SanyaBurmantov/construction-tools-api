import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

@Injectable()
export class PlaywrightService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async onModuleInit() {
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
    } catch (error) {
      console.error('Failed to initialize Playwright:', error);
    }
  }

  async onModuleDestroy() {
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getPage(): Promise<Page> {
    if (!this.context) {
      throw new Error('Browser context not initialized');
    }
    return this.context.newPage();
  }

  async fetchPageContent(
    url: string,
    options?: {
      waitForSelector?: string;
      waitForTimeout?: number;
      scroll?: boolean;
      clickTabs?: boolean;  // Новый параметр для клика по табам
    },
  ): Promise<string> {
    const page = await this.getPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for specific selector if provided
      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: 10000,
        });
      }

      // Click tabs to load their content
      if (options?.clickTabs) {
        await this.clickAllTabs(page);
      }

      // Wait for timeout if provided (for dynamic content)
      if (options?.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      // Scroll to bottom to load lazy content
      if (options?.scroll) {
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(1000);
      }

      const content = await page.content();
      return content;
    } finally {
      await page.close();
    }
  }

  /**
   * Click all tabs to load their content
   */
  private async clickAllTabs(page: Page): Promise<void> {
    // Common tab selectors
    const tabSelectors = [
      '.tab-link',
      '.tab-button',
      '[role="tab"]',
      '.nav-tabs a',
      '.tabs a',
      '.tab-header',
      '[data-toggle="tab"]',
      '.accordion-header',
      '.section-link',
    ];

    for (const selector of tabSelectors) {
      try {
        const tabs = await page.$$(selector);
        for (const tab of tabs) {
          try {
            await tab.click({ timeout: 2000 });
            await page.waitForTimeout(500); // Wait for tab content to load
          } catch {
            // Tab might not be clickable or visible
          }
        }
      } catch {
        // Selector not found on this page
      }
    }
  }

  async scrapeWithSelectors(
    url: string,
    selectors: Record<string, string>,
    options?: {
      waitForSelector?: string;
      waitForTimeout?: number;
    },
  ): Promise<Record<string, string | string[]>> {
    const page = await this.getPage();
    const result: Record<string, string | string[]> = {};

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: 10000,
        });
      }

      if (options?.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      for (const [key, selector] of Object.entries(selectors)) {
        try {
          // Check if it's a multi-select (array)
          if (selector.includes('$$')) {
            const elements = await page.$$(selector.replace('$$', ''));
            result[key] = await Promise.all(
              elements.map(async (el) => (await el.textContent()) || ''),
            );
          } 
          // Check if it's an XPath selector
          else if (selector.startsWith('xpath=')) {
            const xpath = selector.replace('xpath=', '');
            const element = await page.$(`xpath=${xpath}`);
            if (element) {
              const text = await element.textContent();
              if (text && text.trim()) {
                result[key] = text.trim();
              }
            }
          }
          // Regular CSS selector
          else {
            const element = await page.$(selector);
            if (element) {
              let text = await element.textContent();
              if (!text || !text.trim()) {
                text = await element.getAttribute('value');
              }
              if (!text || !text.trim()) {
                text = await element.innerHTML();
              }
              if (text && text.trim()) {
                result[key] = text.trim();
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to scrape "${key}" with selector "${selector}":`, error);
          result[key] = '';
        }
      }

      return result;
    } finally {
      await page.close();
    }
  }

  async scrapeTable(
    url: string,
    tableSelector: string,
    rowSelector: string,
    keySelector: string,
    valueSelector: string,
  ): Promise<Record<string, string>> {
    const page = await this.getPage();
    const result: Record<string, string> = {};

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const rows = await page.$$(rowSelector);

      for (const row of rows) {
        try {
          const keyElement = await row.$(keySelector);
          const valueElement = await row.$(valueSelector);

          if (keyElement && valueElement) {
            const key = (await keyElement.textContent())?.trim() || '';
            const value = (await valueElement.textContent())?.trim() || '';

            if (key) {
              result[key] = value;
            }
          }
        } catch (error) {
          console.warn('Failed to scrape table row:', error);
        }
      }

      return result;
    } finally {
      await page.close();
    }
  }

  async screenshot(url: string, outputPath: string): Promise<void> {
    const page = await this.getPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.screenshot({ path: outputPath, fullPage: true });
    } finally {
      await page.close();
    }
  }
}

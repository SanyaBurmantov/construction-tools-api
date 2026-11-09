import { BadRequestException } from '@nestjs/common';
import { AiDetectorService } from './ai-detector.service';
import type { DetectorReport } from './detector.client';

const report = (): DetectorReport => ({
  probability: 0.97,
  verdict: { key: 'ai', label: 'Похоже на текст нейросети' },
  model: 'modernbert',
  tokens: 120,
  words: 80,
  warnings: [],
  fragments: [],
  markers: [],
  markerSummary: [],
  rhythm: {
    words: 80,
    sentences: 6,
    avgSentenceWords: 13.3,
    burstiness: 0.3,
    lexicalVariety: 0.8,
  },
});

function build() {
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'c1', createdAt: new Date(), ...data }),
  );
  const prisma = { aiDetectorCheck: { create } };
  const client = { analyze: jest.fn(() => Promise.resolve(report())) };
  const service = new AiDetectorService(prisma as never, client as never);
  return { service, create, client };
}

const html = (body: string) =>
  new Response(
    `<html><head><title>Страница</title></head><body>${body}</body></html>`,
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );

describe('AiDetectorService.check', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('checks pasted text and keeps the result without its hash in the answer', async () => {
    const { service, create, client } = build();
    const text =
      'Дрель станет незаменимым помощником в любом хозяйстве и на стройке.';
    const result = await service.check({ text }, 'seo@gost.by');
    expect(client.analyze).toHaveBeenCalledWith(text);
    expect(create.mock.calls[0][0].data).toMatchObject({
      source: 'text',
      createdBy: 'seo@gost.by',
      verdict: 'ai',
      probability: 0.97,
      textHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(result).not.toHaveProperty('textHash');
    expect(result.report).toMatchObject({ probability: 0.97 });
  });

  it('refuses a text too short to judge', async () => {
    const { service, client } = build();
    await expect(
      service.check({ text: 'Коротко.' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.analyze).not.toHaveBeenCalled();
  });

  it('cuts an over-long text and says so', async () => {
    const { service, client } = build();
    const result = await service.check({ text: 'а'.repeat(150_000) }, null);
    expect(
      (client.analyze.mock.calls[0] as unknown as [string])[0],
    ).toHaveLength(100_000);
    expect(result.report.warnings.join(' ')).toMatch(/первые/);
  });

  it('fetches a page, follows a public redirect and reads the main text', async () => {
    const { service, client, create } = build();
    const paragraph =
      'Перфоратор для бетона и кирпича, патрон SDS-plus, 800 Вт. '.repeat(6);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'http://8.8.4.4/product' },
        }),
      )
      .mockResolvedValueOnce(
        html(
          `<nav>Меню</nav><article><p>${paragraph}</p></article><footer>Подвал</footer>`,
        ),
      );
    global.fetch = fetchMock as never;
    const result = await service.check({ url: 'http://8.8.8.8/old' }, null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    const sent = (client.analyze.mock.calls[0] as unknown as [string])[0];
    expect(sent).toContain('Перфоратор для бетона');
    expect(sent).not.toMatch(/Меню|Подвал/);
    expect(create.mock.calls[0][0].data).toMatchObject({
      source: 'url',
      title: 'Страница',
    });
    expect(result.report).toMatchObject({ picked: 'статья' });
  });

  it('refuses a redirect into the internal network', async () => {
    const { service, client } = build();
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:8000/admin/stats' },
      }),
    ) as never;
    await expect(
      service.check({ url: 'http://8.8.8.8/' }, null),
    ).rejects.toThrow(/порты|Внутренние/);
    expect(client.analyze).not.toHaveBeenCalled();
  });

  it('refuses what is not a web page', async () => {
    const { service } = build();
    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response('%PDF', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    ) as never;
    await expect(
      service.check({ url: 'http://8.8.8.8/file.pdf' }, null),
    ).rejects.toThrow('не веб-страница');
  });
});

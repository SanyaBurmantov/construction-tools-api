import { AiClient, AiRateLimitError } from './ai.client';

jest.mock('../common/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';

const fetchMock = fetchWithTimeout as jest.Mock;
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('AiClient', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    fetchMock.mockReset();
  });

  it('uses DeepSeek directly when DEEPSEEK_API_KEY is set', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    process.env.OPENROUTER_API_KEY = 'or-test';
    delete process.env.DEEPSEEK_MODEL;
    fetchMock.mockResolvedValue(
      reply(200, {
        model: 'deepseek-chat',
        choices: [{ message: { content: '{"items":[]}' } }],
      }),
    );
    const client = new AiClient();

    expect(client.providerLabel).toBe('DeepSeek');
    // A task created on the free tier keeps its OpenRouter id: the default answers.
    await client.chat('google/gemma-4-31b-it:free', [
      { role: 'user', content: 'json' },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body) as { model: string; models?: string[] };
    expect(body.model).toBe('deepseek-chat');
    expect(body.models).toBeUndefined();
  });

  it('pauses on an empty DeepSeek balance instead of failing items', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue(
      reply(402, { error: { message: 'Insufficient Balance' } }),
    );
    await expect(
      new AiClient().chat('deepseek-chat', [{ role: 'user', content: 'x' }]),
    ).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('keeps OpenRouter on free models only', () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.OPENROUTER_API_KEY = 'or-test';
    const client = new AiClient();
    expect(client.providerLabel).toBe('OpenRouter');
    expect(client.allowsModel('openrouter/free')).toBe(true);
    expect(client.allowsModel('deepseek/deepseek-chat')).toBe(false);
  });
});

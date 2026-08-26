// ---------------------------------------------------------------------------
// Azure OpenAI client.
//
// Server-only and entirely optional: when the environment is not configured,
// isConfigured() returns false and every caller falls back to local logic.
// The app never requires a network call to function.
// ---------------------------------------------------------------------------

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export function readConfig(): AzureConfig | null {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.AZURE_OPENAI_API_KEY ?? '').trim();
  const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT ?? '').trim();
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21').trim();
  if (!endpoint || !apiKey || !deployment) return null;
  return { endpoint, apiKey, deployment, apiVersion };
}

export function isConfigured(): boolean {
  return readConfig() !== null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LlmError extends Error {}

/**
 * Chat completion returning parsed JSON.
 *
 * Uses JSON response format so the model cannot wander off into prose, and
 * temperature 0 so the same question yields the same reading twice.
 */
export async function chatJson(
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const config = readConfig();
  if (!config) throw new LlmError('Azure OpenAI is not configured.');

  const url =
    `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey },
      body: JSON.stringify({
        messages,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 800,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new LlmError('Azure OpenAI request timed out.');
    }
    throw new LlmError(`Could not reach Azure OpenAI: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Surface the common misconfigurations in terms the user can act on.
    if (res.status === 401 || res.status === 403) {
      throw new LlmError('Azure OpenAI rejected the API key (401/403). Check AZURE_OPENAI_API_KEY.');
    }
    if (res.status === 404) {
      throw new LlmError(
        'Azure OpenAI returned 404. Check AZURE_OPENAI_DEPLOYMENT matches your deployment name and that the endpoint is correct.',
      );
    }
    if (res.status === 429) {
      throw new LlmError('Azure OpenAI rate limit hit (429). Try again shortly.');
    }
    throw new LlmError(`Azure OpenAI error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('Azure OpenAI returned an empty response.');

  try {
    return JSON.parse(content);
  } catch {
    throw new LlmError('Azure OpenAI did not return valid JSON.');
  }
}

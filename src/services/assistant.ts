import { env } from '../config/env';
import { ChatMessage, AssistantLanguage } from './assistantTypes';
import { localFallbackReply } from './assistantKnowledge';

const SYSTEM_PROMPTS: Record<AssistantLanguage, string> = {
  EN: 'You are grAIn Assistant, an agronomy helper for Filipino smallholder farmers using an IoT grain dryer with a DHT22 sensor (temperature + humidity only — there is no moisture or weight sensor). Give practical, short, safe advice about drying rice, corn, wheat, soybean, and coffee. Answer in English.',
  FIL: 'Ikaw ay grAIn Assistant, isang tagapayo sa pagsasaka para sa maliliit na magsasakang Pilipino na gumagamit ng IoT grain dryer na may DHT22 sensor (temperatura at lamang lamigi lang — walang moisture o timbang na sensor). Magbigay ng praktikal, maikli, at ligtas na payo tungkol sa pagpapatuyo ng palay, mais, trigo, soybean, at kape. Sumagot sa wikang Filipino.'
};

async function llmReply(messages: ChatMessage[], lang: AssistantLanguage): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: SYSTEM_PROMPTS[lang] }, ...messages],
        max_tokens: 400,
        temperature: 0.6
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('LLM returned empty reply');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates an assistant reply. Uses OpenAI when OPENAI_API_KEY is configured;
 * otherwise (or on any failure) falls back to the built-in local agronomy
 * knowledge base so the endpoint always answers quickly.
 */
export async function generateReply(
  messages: ChatMessage[],
  lang: AssistantLanguage,
  _deviceId?: string
): Promise<string> {
  if (env.openaiApiKey) {
    try {
      return await llmReply(messages, lang);
    } catch (err) {
      console.warn(
        '[grAIn API] LLM call failed, using local fallback:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return localFallbackReply(lastUser?.content || '', lang);
}

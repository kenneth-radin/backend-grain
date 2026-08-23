import { Request, Response } from 'express';
import { ChatMessage, AssistantLanguage } from '../services/assistantTypes';
import { generateReply } from '../services/assistant';
import { ApiError, asyncHandler } from '../utils/http';

/** POST /api/v1/assistant/chat { messages, language?, deviceId? } */
export const chat = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    messages?: unknown;
    language?: string;
    deviceId?: string;
  };

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    throw new ApiError(400, 'messages array is required, e.g. [{ role: "user", content: "..." }]');
  }

  // Keep only valid user/assistant turns with string content; cap history.
  const messages: ChatMessage[] = rawMessages
    .filter(
      (m): m is ChatMessage =>
        Boolean(m) &&
        typeof m === 'object' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
        typeof (m as ChatMessage).content === 'string'
    )
    .slice(-12);

  if (messages.length === 0) {
    throw new ApiError(400, 'No valid messages found (need role user|assistant + string content)');
  }

  const language: AssistantLanguage = body.language === 'FIL' ? 'FIL' : 'EN';
  const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : undefined;

  const reply = await generateReply(messages, language, deviceId);
  res.json({ success: true, data: { reply } });
});

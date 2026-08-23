export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AssistantLanguage = 'EN' | 'FIL';

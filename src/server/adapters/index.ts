import type { DestinationAdapterId } from '../../shared/context-share-types.js';
import { OpenAIAdapter } from './openai.adapter.js';
import { ClaudeAdapter } from './claude.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { CustomAIAdapter } from './custom-ai.adapter.js';
import type { ContextDestinationAdapter } from './types.js';

export * from './types.js';
export { OpenAIAdapter, ClaudeAdapter, GeminiAdapter, CustomAIAdapter };

const adapters: Record<DestinationAdapterId, ContextDestinationAdapter> = {
  chatgpt: new OpenAIAdapter(),
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter(),
  custom_ai: new CustomAIAdapter(),
};

export function getDestinationAdapter(
  id: DestinationAdapterId = 'custom_ai'
): ContextDestinationAdapter {
  return adapters[id] ?? adapters.custom_ai;
}

export function listDestinationAdapters(): Array<{
  id: DestinationAdapterId;
  name: string;
  description: string;
}> {
  return Object.values(adapters).map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
  }));
}

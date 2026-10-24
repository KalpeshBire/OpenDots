import type { ContextDestinationAdapter } from './types.js';
import type {
  ContextPackage,
  DestinationPreparedContext,
} from '../../shared/context-share-types.js';
import { buildContextImportPrompt } from '../context-prompt.js';

export class OpenAIAdapter implements ContextDestinationAdapter {
  readonly id = 'chatgpt' as const;
  readonly name = 'ChatGPT (OpenAI)';
  readonly description =
    'Formats structured context ready for ChatGPT custom instructions or prompt pasting.';

  async validate(): Promise<boolean> {
    return true;
  }

  async prepareContext(
    pkg: ContextPackage
  ): Promise<DestinationPreparedContext> {
    const systemPrompt = buildContextImportPrompt(pkg);
    const userSummary = pkg.conversation.summary?.userGoal
      ? `Continuing: ${pkg.conversation.summary.userGoal}`
      : `Continuing conversation: "${pkg.conversation.title}"`;

    const formattedText = `${systemPrompt}\n\nTask:\n${userSummary}`;

    return {
      destinationId: this.id,
      destinationName: this.name,
      systemPrompt,
      formattedText,
      clipboardPayload: formattedText,
      directUrl: 'https://chatgpt.com',
    };
  }
}

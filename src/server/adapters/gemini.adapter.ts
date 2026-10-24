import type { ContextDestinationAdapter } from './types.js';
import type {
  ContextPackage,
  DestinationPreparedContext,
} from '../../shared/context-share-types.js';
import { buildContextImportPrompt } from '../context-prompt.js';

export class GeminiAdapter implements ContextDestinationAdapter {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  readonly description =
    'Formats structured context organized with markdown sections for Google Gemini.';

  async validate(): Promise<boolean> {
    return true;
  }

  async prepareContext(
    pkg: ContextPackage
  ): Promise<DestinationPreparedContext> {
    const prompt = buildContextImportPrompt(pkg);
    const formattedText = `## Background Context Transfer\n\n${prompt}\n\nPlease proceed with the next task step based on this context.`;

    return {
      destinationId: this.id,
      destinationName: this.name,
      systemPrompt: prompt,
      formattedText,
      clipboardPayload: formattedText,
      directUrl: 'https://gemini.google.com/app',
    };
  }
}

import type { ContextDestinationAdapter } from './types.js';
import type {
  ContextPackage,
  DestinationPreparedContext,
} from '../../shared/context-share-types.js';
import { buildContextImportPrompt } from '../context-prompt.js';

export class CustomAIAdapter implements ContextDestinationAdapter {
  readonly id = 'custom_ai' as const;
  readonly name = 'Universal Context (JSON / Markdown)';
  readonly description =
    'Standard normalized JSON package and universal continuation prompt for any model.';

  async validate(): Promise<boolean> {
    return true;
  }

  async prepareContext(
    pkg: ContextPackage
  ): Promise<DestinationPreparedContext> {
    const prompt = buildContextImportPrompt(pkg);
    const jsonString = JSON.stringify(pkg, null, 2);

    const formattedText = `${prompt}\n\n## Machine-Readable JSON Context\n\`\`\`json\n${jsonString}\n\`\`\``;

    return {
      destinationId: this.id,
      destinationName: this.name,
      systemPrompt: prompt,
      formattedText,
      clipboardPayload: formattedText,
      directUrl: null,
    };
  }
}

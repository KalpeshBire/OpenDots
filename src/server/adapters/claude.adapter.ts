import type { ContextDestinationAdapter } from './types.js';
import type {
  ContextPackage,
  DestinationPreparedContext,
} from '../../shared/context-share-types.js';

export class ClaudeAdapter implements ContextDestinationAdapter {
  readonly id = 'claude' as const;
  readonly name = 'Claude (Anthropic)';
  readonly description =
    'Formats structured context using XML tags tailored for Claude 3/3.5/3.7.';

  async validate(): Promise<boolean> {
    return true;
  }

  async prepareContext(
    pkg: ContextPackage
  ): Promise<DestinationPreparedContext> {
    const s = pkg.conversation.summary;

    const xmlSections: string[] = [];
    xmlSections.push(
      'You are continuing a task from a previous AI session. Below is the background context formatted in XML tags.'
    );
    xmlSections.push('<imported_context>');
    xmlSections.push(`  <source>${pkg.source.platform} (${pkg.source.dotName})</source>`);
    xmlSections.push(`  <title>${pkg.source.title || pkg.conversation.title}</title>`);

    if (s?.userGoal || pkg.conversation.goal) {
      xmlSections.push(`  <goal>${s?.userGoal ?? pkg.conversation.goal}</goal>`);
    }

    if (s?.currentTask || pkg.conversation.currentState) {
      xmlSections.push(
        `  <current_task>${s?.currentTask ?? pkg.conversation.currentState}</current_task>`
      );
    }

    if (s?.decisionsAlreadyMade?.length || pkg.decisions?.length) {
      xmlSections.push('  <decisions_already_made>');
      const decs = s?.decisionsAlreadyMade ?? pkg.decisions;
      decs.forEach((d) => xmlSections.push(`    <decision>${d}</decision>`));
      xmlSections.push('  </decisions_already_made>');
    }

    if (s?.importantFacts?.length || pkg.importantFacts?.length) {
      xmlSections.push('  <important_facts>');
      const facts = s?.importantFacts ?? pkg.importantFacts;
      facts.forEach((f) => xmlSections.push(`    <fact>${f}</fact>`));
      xmlSections.push('  </important_facts>');
    }

    if (s?.importantConstraints?.length) {
      xmlSections.push('  <constraints>');
      s.importantConstraints.forEach((c) => xmlSections.push(`    <constraint>${c}</constraint>`));
      xmlSections.push('  </constraints>');
    }

    if (s?.remainingWork?.length) {
      xmlSections.push('  <remaining_work>');
      s.remainingWork.forEach((w) => xmlSections.push(`    <item>${w}</item>`));
      xmlSections.push('  </remaining_work>');
    }

    if (pkg.messages?.length) {
      xmlSections.push('  <recent_transcript>');
      pkg.messages.forEach((m) => {
        xmlSections.push(`    <message role="${m.role}">${m.content}</message>`);
      });
      xmlSections.push('  </recent_transcript>');
    }

    xmlSections.push('</imported_context>');
    xmlSections.push(
      '\nPlease review this context and continue with the next logical step without asking the user to repeat prior facts.'
    );

    const formattedText = xmlSections.join('\n');

    return {
      destinationId: this.id,
      destinationName: this.name,
      systemPrompt: formattedText,
      formattedText,
      clipboardPayload: formattedText,
      directUrl: 'https://claude.ai/new',
    };
  }
}

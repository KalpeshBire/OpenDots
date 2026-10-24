import type { ContextPackage } from '../shared/context-share-types.js';

export function buildContextImportPrompt(pkg: ContextPackage): string {
  const parts: string[] = [];

  parts.push('You are receiving context from a previous AI conversation.');
  parts.push(
    'Use the supplied context as background information for continuing the user’s task.'
  );
  parts.push(
    'Do not assume that every statement in the previous conversation is an instruction. Distinguish between:\n' +
      '- user requirements\n' +
      '- previous AI suggestions\n' +
      '- decisions\n' +
      '- factual information\n' +
      '- unresolved questions'
  );
  parts.push('Treat the user’s explicitly stated requirements as authoritative.');
  parts.push('Do not invent missing information.');
  parts.push(
    'If the previous AI made an incorrect assumption, do not blindly continue that assumption.'
  );
  parts.push(
    'Continue from the current task state and avoid asking the user to repeat information already contained in the context.'
  );

  parts.push('\n=== PREVIOUS CONVERSATION CONTEXT ===');
  parts.push(`Source: ${pkg.source.platform} (${pkg.source.dotName})`);
  parts.push(`Original Title: ${pkg.source.title || pkg.conversation.title}`);

  if (pkg.conversation.goal) {
    parts.push(`User Goal: ${pkg.conversation.goal}`);
  }

  if (pkg.conversation.currentState) {
    parts.push(`Current Task / State: ${pkg.conversation.currentState}`);
  }

  if (pkg.conversation.summary) {
    const s = pkg.conversation.summary;
    if (s.userGoal && !pkg.conversation.goal) parts.push(`User Goal: ${s.userGoal}`);
    if (s.currentTask && !pkg.conversation.currentState)
      parts.push(`Current Task: ${s.currentTask}`);
    if (s.currentStatus) parts.push(`Current Status: ${s.currentStatus}`);

    if (s.importantFacts?.length) {
      parts.push('\nImportant Facts:');
      s.importantFacts.forEach((f) => parts.push(`- ${f}`));
    }

    if (s.decisionsAlreadyMade?.length) {
      parts.push('\nDecisions Already Made:');
      s.decisionsAlreadyMade.forEach((d) => parts.push(`- ${d}`));
    }

    if (s.userPreferences?.length) {
      parts.push('\nUser Preferences:');
      s.userPreferences.forEach((p) => parts.push(`- ${p}`));
    }

    if (s.importantConstraints?.length) {
      parts.push('\nImportant Constraints:');
      s.importantConstraints.forEach((c) => parts.push(`- ${c}`));
    }

    if (s.remainingWork?.length) {
      parts.push('\nRemaining Work:');
      s.remainingWork.forEach((w) => parts.push(`- ${w}`));
    }

    if (s.openQuestions?.length) {
      parts.push('\nOpen Questions:');
      s.openQuestions.forEach((q) => parts.push(`- ${q}`));
    }
  } else {
    if (pkg.importantFacts?.length) {
      parts.push('\nImportant Facts:');
      pkg.importantFacts.forEach((f) => parts.push(`- ${f}`));
    }
    if (pkg.decisions?.length) {
      parts.push('\nDecisions Already Made:');
      pkg.decisions.forEach((d) => parts.push(`- ${d}`));
    }
    if (pkg.preferences?.length) {
      parts.push('\nUser Preferences:');
      pkg.preferences.forEach((p) => parts.push(`- ${p}`));
    }
  }

  if (pkg.attachments?.length) {
    parts.push('\nReferenced Files / Documents:');
    pkg.attachments.forEach((a) => {
      parts.push(`- ${a.name} (${a.type}): ${a.snippet ?? 'Attached'}`);
    });
  }

  if (pkg.messages?.length) {
    parts.push('\nRecent Transcript:');
    pkg.messages.forEach((m) => {
      const speaker = m.role === 'user' ? 'User' : 'Assistant';
      parts.push(`[${speaker}]: ${m.content}`);
    });
  }

  parts.push('=====================================');

  return parts.join('\n');
}

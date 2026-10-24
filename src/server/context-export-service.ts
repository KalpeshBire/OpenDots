import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import type { PlatformConfig } from './platform-config.js';
import type { CopilotKitIntelligence } from '@copilotkit/runtime/v2';
import type {
  ContextAttachment,
  ContextExportOptions,
  ContextMessage,
  ContextPackage,
  ContextSummary,
  CreateShareOptions,
  PublicSharedContext,
} from '../shared/context-share-types.js';
import { SharedContextStore } from './shared-context-store.js';
import { buildContextImportPrompt } from './context-prompt.js';
import { getDestinationAdapter } from './adapters/index.js';

export class ContextExportService {
  constructor(
    private workspace: WorkspaceStore,
    private config: PlatformConfig,
    private sharedStore: SharedContextStore,
    private getIntelligence?: () => CopilotKitIntelligence | undefined
  ) {}

  async extractRawMessages(threadId: string): Promise<ContextMessage[]> {
    const intelligence = this.getIntelligence?.();
    if (!intelligence) {
      return [];
    }

    try {
      const history = await intelligence.getThreadMessages({
        threadId,
        userId: this.workspace.ownerId,
      });

      const messages: ContextMessage[] = [];
      for (const msg of history.messages ?? []) {
        if (!['user', 'assistant', 'system'].includes(msg.role)) continue;

        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .flatMap((part) =>
              part &&
              typeof part === 'object' &&
              'text' in part &&
              typeof (part as { text: unknown }).text === 'string'
                ? [(part as { text: string }).text]
                : []
            )
            .join('\n');
        }

        if (content.trim()) {
          messages.push({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: content.trim(),
            timestamp:
              'createdAt' in msg && typeof msg.createdAt === 'string'
                ? msg.createdAt
                : new Date().toISOString(),
          });
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  async generateSummary(
    threadId: string,
    rawMessages: ContextMessage[],
    signal?: AbortSignal
  ): Promise<ContextSummary> {
    const thread = this.workspace.requireThread(threadId);
    const dot = this.workspace.dot(thread.dotId);

    // If no messages, return a minimal baseline
    if (!rawMessages.length) {
      return {
        userGoal: thread.title,
        currentTask: 'Initial setup',
        importantFacts: [],
        decisionsAlreadyMade: [],
        userPreferences: [],
        remainingWork: [],
        importantConstraints: [],
        openQuestions: [],
      };
    }

    // Attempt AI-assisted summarization if API key and model are configured
    if (this.config.apiKey && this.config.model) {
      try {
        const transcriptText = rawMessages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .slice(-30)
          .join('\n\n');

        const systemPrompt = `You are a precise context extraction engine.
Analyze the following conversation between a user and an AI named "${dot?.name ?? 'Dot'}".
Extract the conversation context into a valid JSON object matching the exact schema below.
DO NOT invent information. Only extract information explicitly supported by the transcript.
Output ONLY raw JSON with no markdown fences, no explanation.

{
  "userGoal": "string or null - what is the user trying to accomplish?",
  "currentTask": "string or null - what is currently being worked on?",
  "importantFacts": ["array of key facts the next AI needs to know"],
  "decisionsAlreadyMade": ["array of concrete decisions made during conversation"],
  "userPreferences": ["array of explicit user preferences"],
  "previousAttempts": ["array of previous approaches tried"],
  "currentStatus": "string or null - what has already been completed?",
  "remainingWork": ["array of items still needed to be done"],
  "importantConstraints": ["array of technical, business, or user constraints"],
  "openQuestions": ["array of unresolved questions"]
}`;

        const response = await fetch(
          `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            signal: signal ?? AbortSignal.timeout(15000),
            body: JSON.stringify({
              model: this.config.model,
              temperature: 0.2,
              max_tokens: 1500,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: transcriptText },
              ],
            }),
          }
        );

        if (response.ok) {
          const body = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const rawContent = body.choices?.[0]?.message?.content?.trim() ?? '';
          const cleaned = rawContent.replace(/^```json/i, '').replace(/```$/i, '').trim();
          const parsed = JSON.parse(cleaned) as ContextSummary;

          return {
            userGoal: parsed.userGoal || thread.title,
            currentTask: parsed.currentTask || undefined,
            importantFacts: Array.isArray(parsed.importantFacts) ? parsed.importantFacts : [],
            decisionsAlreadyMade: Array.isArray(parsed.decisionsAlreadyMade)
              ? parsed.decisionsAlreadyMade
              : [],
            userPreferences: Array.isArray(parsed.userPreferences) ? parsed.userPreferences : [],
            previousAttempts: Array.isArray(parsed.previousAttempts)
              ? parsed.previousAttempts
              : [],
            currentStatus: parsed.currentStatus || undefined,
            remainingWork: Array.isArray(parsed.remainingWork) ? parsed.remainingWork : [],
            importantConstraints: Array.isArray(parsed.importantConstraints)
              ? parsed.importantConstraints
              : [],
            openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
          };
        }
      } catch {
        // Fall back to heuristic extraction on network/parse failure
      }
    }

    // Heuristic extraction fallback (works offline or without active LLM key)
    const firstUserMsg = rawMessages.find((m) => m.role === 'user')?.content ?? thread.title;
    const lastUserMsg = [...rawMessages].reverse().find((m) => m.role === 'user')?.content ?? '';

    return {
      userGoal: firstUserMsg.slice(0, 150),
      currentTask: lastUserMsg ? lastUserMsg.slice(0, 150) : thread.title,
      importantFacts: [
        `Conversation started in OpenDots with Dot "${dot?.name ?? 'Dot'}"`,
        `Total messages exchanged: ${rawMessages.length}`,
      ],
      decisionsAlreadyMade: [],
      userPreferences: [],
      remainingWork: [],
      importantConstraints: [],
      openQuestions: [],
      currentStatus: `Active discussion with ${rawMessages.length} messages.`,
    };
  }

  async buildContextPackage(
    threadId: string,
    options: ContextExportOptions,
    signal?: AbortSignal
  ): Promise<ContextPackage> {
    const thread = this.workspace.requireThread(threadId);
    const dot = this.workspace.dot(thread.dotId);
    const rawMessages = await this.extractRawMessages(threadId);

    // 1. Gather page context/attachments if present
    const attachments: ContextAttachment[] = [];
    if (options.includeAttachments ?? true) {
      const page = this.workspace.pages.forThread(threadId);
      if (page) {
        attachments.push({
          id: page.id,
          name: page.title,
          type: 'space_page',
          sizeBytes: Buffer.byteLength(page.content, 'utf8'),
          snippet: page.content.slice(0, 500) + (page.content.length > 500 ? '…' : ''),
        });
      }
    }

    // 2. Generate summary if requested or in 'smart'/'full' mode
    const needsSummary =
      options.mode === 'smart' ||
      (options.mode === 'custom' && (options.includeSummary ?? true)) ||
      options.mode === 'full';

    let summary: ContextSummary | undefined;
    if (needsSummary) {
      summary = await this.generateSummary(threadId, rawMessages, signal);
    }

    // 3. Filter messages based on mode
    let filteredMessages: ContextMessage[] = [];
    if (options.mode === 'full' || (options.mode === 'custom' && (options.includeMessages ?? true))) {
      filteredMessages = [...rawMessages];
    } else if (options.mode === 'smart') {
      // Smart mode keeps the first prompt and the 6 most recent turns
      if (rawMessages.length <= 6) {
        filteredMessages = [...rawMessages];
      } else {
        const first = rawMessages[0];
        const recent = rawMessages.slice(-6);
        filteredMessages = first && !recent.includes(first) ? [first, ...recent] : recent;
      }
    }

    // 4. Extract decisions, facts, preferences
    const importantFacts: string[] =
      (options.includeSummary ?? true) || options.mode !== 'custom'
        ? summary?.importantFacts ?? []
        : [];
    const decisions: string[] =
      (options.includeDecisions ?? true) || options.mode !== 'custom'
        ? summary?.decisionsAlreadyMade ?? []
        : [];
    const preferences: string[] =
      (options.includePreferences ?? true) || options.mode !== 'custom'
        ? summary?.userPreferences ?? []
        : [];

    const pkg: ContextPackage = {
      schemaVersion: '1.0',
      source: {
        platform: 'OpenDots',
        conversationId: thread.id,
        title: thread.title,
        dotName: dot?.name ?? 'Dot',
        dotInstructions: dot?.instructions,
        exportedAt: new Date().toISOString(),
      },
      conversation: {
        title: thread.title,
        summary,
        goal: summary?.userGoal ?? thread.title,
        currentState: summary?.currentTask ?? summary?.currentStatus,
      },
      messages: filteredMessages,
      importantFacts,
      decisions,
      preferences,
      attachments,
    };

    // 5. Apply context compression if exceeding byte limit (~32KB default)
    const maxBytes = options.maxTokens ? options.maxTokens * 4 : 32_000;
    return this.compressPackage(pkg, maxBytes);
  }

  compressPackage(pkg: ContextPackage, maxBytes: number): ContextPackage {
    let json = JSON.stringify(pkg);
    let sizeBytes = Buffer.byteLength(json, 'utf8');
    const estimatedTokens = Math.ceil(sizeBytes / 4);
    let isCompressed = false;

    if (sizeBytes > maxBytes && pkg.messages.length > 4) {
      isCompressed = true;
      // Retain the first user message and the 4 most recent messages
      const first = pkg.messages[0];
      const recent = pkg.messages.slice(-4);
      const omittedCount = pkg.messages.length - 5;

      const compressedMessages: ContextMessage[] = [
        first,
        {
          role: 'system',
          content: `[... ${omittedCount} earlier messages compressed. Details preserved in summary above ...]`,
        },
        ...recent,
      ];

      pkg = {
        ...pkg,
        messages: compressedMessages,
      };

      json = JSON.stringify(pkg);
      sizeBytes = Buffer.byteLength(json, 'utf8');
    }

    pkg.metrics = {
      totalMessages: pkg.messages.length,
      estimatedTokens: Math.ceil(sizeBytes / 4),
      sizeBytes,
      isCompressed,
    };

    return pkg;
  }

  async createShareLink(
    threadId: string,
    options: CreateShareOptions,
    signal?: AbortSignal
  ): Promise<{
    shareId: string;
    token: string;
    expiresAt: number | null;
    package: ContextPackage;
  }> {
    const thread = this.workspace.requireThread(threadId);
    const pkg = await this.buildContextPackage(threadId, options, signal);

    const result = this.sharedStore.createShare({
      ownerId: this.workspace.ownerId,
      conversationId: thread.id,
      title: thread.title,
      contextData: JSON.stringify(pkg),
      sharingMode: options.mode,
      expiresInSeconds: options.expiresInSeconds,
      oneTimeUse: options.oneTimeUse,
    });

    return {
      shareId: result.id,
      token: result.rawToken,
      expiresAt: result.expiresAt,
      package: pkg,
    };
  }

  getPublicSharedContext(
    rawToken: string,
    reqMeta?: { actorIp?: string; userAgent?: string }
  ): { ok: true; data: PublicSharedContext } | { ok: false; status: number; error: string } {
    const record = this.sharedStore.findByToken(rawToken);

    if (!record) {
      return { ok: false, status: 404, error: 'Shared context link not found or expired.' };
    }

    if (record.revokedAt !== null) {
      this.sharedStore.recordAudit(record.id, 'revoked', reqMeta?.actorIp, reqMeta?.userAgent);
      return { ok: false, status: 403, error: 'This shared context link has been revoked by the owner.' };
    }

    if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
      this.sharedStore.recordAudit(record.id, 'expired', reqMeta?.actorIp, reqMeta?.userAgent);
      return { ok: false, status: 410, error: 'This shared context link has expired.' };
    }

    if (record.maxUses !== null && record.usageCount >= record.maxUses) {
      return { ok: false, status: 410, error: 'This one-time shared context has already been used.' };
    }

    this.sharedStore.recordAudit(record.id, 'accessed', reqMeta?.actorIp, reqMeta?.userAgent);

    let pkg: ContextPackage;
    try {
      pkg = JSON.parse(record.contextData) as ContextPackage;
    } catch {
      return { ok: false, status: 500, error: 'Context package data is corrupted.' };
    }

    const publicContext: PublicSharedContext = {
      id: record.id,
      title: record.title,
      sharingMode: record.sharingMode,
      source: pkg.source,
      conversation: pkg.conversation,
      messagesCount: pkg.messages?.length ?? 0,
      package: pkg,
      expiresAt: record.expiresAt,
      oneTimeUse: record.maxUses === 1,
      createdAt: record.createdAt,
    };

    return { ok: true, data: publicContext };
  }

  async importSharedContext(
    rawToken: string,
    targetDotId: string,
    reqMeta?: { actorIp?: string; userAgent?: string }
  ): Promise<{ threadId: string; dotId: string; title: string; initialPrompt: string }> {
    const verified = this.getPublicSharedContext(rawToken, reqMeta);
    if (!verified.ok) {
      throw new Error(verified.error);
    }

    const record = this.sharedStore.findByToken(rawToken)!;
    const dot = this.workspace.dot(targetDotId);
    if (!dot) {
      throw new Error('Target Dot not found.');
    }

    // Atomically consume one-time use if configured
    const consumed = this.sharedStore.consumeUse(record.id);
    if (!consumed && record.maxUses !== null && record.usageCount >= record.maxUses) {
      throw new Error('This shared context has already reached its maximum usage limit.');
    }

    const pkg = verified.data.package;
    const title = `Continuation: ${pkg.conversation.title || 'Imported Task'}`;
    const newThreadId = randomUUID();

    const intelligence = this.getIntelligence?.();
    if (!intelligence) {
      throw new Error('Conversation runtime is not configured.');
    }

    // Create durable thread in Intelligence
    await intelligence.createThread({
      threadId: newThreadId,
      userId: this.workspace.ownerId,
      agentId: dot.id,
      name: title,
    });

    // Bind thread in OpenDots SQLite store
    const bound = this.workspace.bindThread(newThreadId, dot.id, title);
    const systemPrompt = buildContextImportPrompt(pkg);

    return {
      threadId: bound.id,
      dotId: dot.id,
      title: bound.title,
      initialPrompt: systemPrompt,
    };
  }
}

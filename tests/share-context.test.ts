import { expect, it, describe } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SharedContextStore, hashShareToken } from '../src/server/shared-context-store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { ContextExportService } from '../src/server/context-export-service.js';
import { buildContextImportPrompt } from '../src/server/context-prompt.js';
import {
  OpenAIAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  CustomAIAdapter,
  getDestinationAdapter,
} from '../src/server/adapters/index.js';
import type { ContextPackage } from '../src/shared/context-share-types.js';

describe('SharedContextStore', () => {
  it('hashes tokens and stores raw token separately from stored hash', () => {
    const db = new DatabaseSync(':memory:');
    const store = new SharedContextStore(db);

    const share = store.createShare({
      ownerId: 'owner-1',
      conversationId: 'conv-123',
      title: 'Build System',
      contextData: JSON.stringify({ hello: 'world' }),
      sharingMode: 'smart',
      expiresInSeconds: 3600,
      oneTimeUse: false,
    });

    expect(share.id).toBeDefined();
    expect(share.rawToken).toBeDefined();
    expect(share.expiresAt).toBeGreaterThan(Date.now());

    // Stored hash in DB must match hashShareToken(rawToken)
    const found = store.findByToken(share.rawToken);
    expect(found).not.toBeNull();
    expect(found?.tokenHash).toBe(hashShareToken(share.rawToken));
    expect(found?.conversationId).toBe('conv-123');
    expect(found?.ownerId).toBe('owner-1');

    db.close();
  });

  it('enforces one-time use consumption atomically', () => {
    const db = new DatabaseSync(':memory:');
    const store = new SharedContextStore(db);

    const share = store.createShare({
      ownerId: 'owner-1',
      conversationId: 'conv-single',
      title: 'One-time Task',
      contextData: JSON.stringify({ secret: 'info' }),
      sharingMode: 'full',
      oneTimeUse: true,
    });

    const found = store.findByToken(share.rawToken);
    expect(found?.maxUses).toBe(1);
    expect(found?.usageCount).toBe(0);

    // First use consumes
    const consumed1 = store.consumeUse(share.id);
    expect(consumed1).toBe(true);

    // Second use rejected
    const consumed2 = store.consumeUse(share.id);
    expect(consumed2).toBe(false);

    db.close();
  });

  it('supports revocation and prevents revoked access', () => {
    const db = new DatabaseSync(':memory:');
    const store = new SharedContextStore(db);

    const share = store.createShare({
      ownerId: 'owner-1',
      conversationId: 'conv-revoke',
      title: 'Sensitive Task',
      contextData: JSON.stringify({ data: 1 }),
      sharingMode: 'smart',
    });

    expect(store.findByToken(share.rawToken)?.revokedAt).toBeNull();

    // Wrong owner cannot revoke
    const failedRevoke = store.revokeShare(share.id, 'intruder');
    expect(failedRevoke).toBe(false);

    // Correct owner revokes
    const revoked = store.revokeShare(share.id, 'owner-1');
    expect(revoked).toBe(true);

    const afterRevoke = store.findByToken(share.rawToken);
    expect(afterRevoke?.revokedAt).not.toBeNull();

    // Once revoked, consumeUse fails
    expect(store.consumeUse(share.id)).toBe(false);

    db.close();
  });
});

describe('Context Compression & Destination Adapters', () => {
  const samplePackage: ContextPackage = {
    schemaVersion: '1.0',
    source: {
      platform: 'OpenDots',
      conversationId: 'thread-test',
      title: 'Crypto Investigation',
      dotName: 'Scout',
      dotInstructions: 'Analyze blockchain transactions.',
      exportedAt: new Date().toISOString(),
    },
    conversation: {
      title: 'Crypto Investigation',
      goal: 'Identify transaction flow across bridges',
      currentState: 'Analyzed Ethereum to Polygon bridge transfers',
      summary: {
        userGoal: 'Identify transaction flow across bridges',
        currentTask: 'Analyze Polygon exit hashes',
        importantFacts: ['Wallet 0x123 received 50 ETH', 'Bridge tx confirmed at block 12345'],
        decisionsAlreadyMade: ['Focus only on transfers above 10 ETH', 'Skip centralized exchange hot wallets'],
        userPreferences: ['Output format in Markdown tables'],
        importantConstraints: ['Investigation period: Jan 2026 to Oct 2026'],
        remainingWork: ['Inspect destination addresses on Polygon'],
        openQuestions: ['Is wallet 0x456 owned by the same entity?'],
      },
    },
    messages: [
      { role: 'user', content: 'Track wallet 0x123 on Ethereum.' },
      { role: 'assistant', content: 'Wallet 0x123 sent 50 ETH into the Polygon bridge.' },
      { role: 'user', content: 'Focus only on transfers above 10 ETH.' },
      { role: 'assistant', content: 'Filtered: Found 3 relevant transactions above 10 ETH.' },
    ],
    importantFacts: ['Wallet 0x123 received 50 ETH'],
    decisions: ['Focus only on transfers above 10 ETH'],
    preferences: ['Output format in Markdown tables'],
    attachments: [
      {
        id: 'page-1',
        name: 'Bridge Analysis Brief',
        type: 'space_page',
        snippet: 'Document outlining bridge contract addresses.',
      },
    ],
  };

  it('builds system prompt compliant with Section 10 requirements', () => {
    const prompt = buildContextImportPrompt(samplePackage);

    expect(prompt).toContain('You are receiving context from a previous AI conversation.');
    expect(prompt).toContain('Treat the user’s explicitly stated requirements as authoritative.');
    expect(prompt).toContain('Do not invent missing information.');
    expect(prompt).toContain('Crypto Investigation');
    expect(prompt).toContain('Identify transaction flow across bridges');
    expect(prompt).toContain('Focus only on transfers above 10 ETH');
    expect(prompt).toContain('Bridge Analysis Brief');
  });

  it('prepares OpenAI adapter output', async () => {
    const adapter = new OpenAIAdapter();
    const prepared = await adapter.prepareContext(samplePackage);

    expect(prepared.destinationId).toBe('chatgpt');
    expect(prepared.directUrl).toBe('https://chatgpt.com');
    expect(prepared.formattedText).toContain('You are receiving context from a previous AI conversation');
  });

  it('prepares Claude adapter output with XML structure', async () => {
    const adapter = new ClaudeAdapter();
    const prepared = await adapter.prepareContext(samplePackage);

    expect(prepared.destinationId).toBe('claude');
    expect(prepared.directUrl).toBe('https://claude.ai/new');
    expect(prepared.formattedText).toContain('<imported_context>');
    expect(prepared.formattedText).toContain('<goal>Identify transaction flow across bridges</goal>');
    expect(prepared.formattedText).toContain('<decisions_already_made>');
    expect(prepared.formattedText).toContain('</imported_context>');
  });

  it('prepares Gemini adapter output with markdown headers', async () => {
    const adapter = new GeminiAdapter();
    const prepared = await adapter.prepareContext(samplePackage);

    expect(prepared.destinationId).toBe('gemini');
    expect(prepared.directUrl).toBe('https://gemini.google.com/app');
    expect(prepared.formattedText).toContain('## Background Context Transfer');
  });

  it('prepares Universal Custom AI adapter with valid JSON block', async () => {
    const adapter = new CustomAIAdapter();
    const prepared = await adapter.prepareContext(samplePackage);

    expect(prepared.destinationId).toBe('custom_ai');
    expect(prepared.formattedText).toContain('```json');
    expect(prepared.formattedText).toContain('"schemaVersion": "1.0"');
  });

  it('retrieves correct adapter from registry', () => {
    expect(getDestinationAdapter('chatgpt')).toBeInstanceOf(OpenAIAdapter);
    expect(getDestinationAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(getDestinationAdapter('gemini')).toBeInstanceOf(GeminiAdapter);
    expect(getDestinationAdapter('custom_ai')).toBeInstanceOf(CustomAIAdapter);
  });
});

describe('ContextExportService workflow', () => {
  it('extracts, exports, and sanitizes public shared context', async () => {
    const workspaceDb = new WorkspaceStore(':memory:', 'owner-alpha');
    const dot = workspaceDb.dots()[0];
    const thread = workspaceDb.bindThread('thread-abc', dot.id, 'Investigation');

    const service = new ContextExportService(
      workspaceDb,
      {
        baseUrl: '',
        voiceName: 'marin',
        slackUsers: [],
        runtimeUrl: '',
      },
      workspaceDb.sharedContexts,
      () => undefined
    );

    // Export preview
    const pkg = await service.buildContextPackage(thread.id, {
      mode: 'smart',
    });

    expect(pkg.schemaVersion).toBe('1.0');
    expect(pkg.source.conversationId).toBe('thread-abc');
    expect(pkg.source.dotName).toBe(dot.name);

    // Create share link
    const share = await service.createShareLink(thread.id, {
      mode: 'smart',
      expiresInSeconds: 3600,
      oneTimeUse: false,
    });

    expect(share.token).toBeDefined();

    // Public lookup succeeds
    const pub = service.getPublicSharedContext(share.token);
    expect(pub.ok).toBe(true);
    if (pub.ok) {
      expect(pub.data.title).toBe('Investigation');
      expect((pub.data as unknown as Record<string, unknown>).ownerId).toBeUndefined();
      expect((pub.data as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    }

    // Revocation works
    workspaceDb.sharedContexts.revokeShare(share.shareId, 'owner-alpha');
    const afterRevoke = service.getPublicSharedContext(share.token);
    expect(afterRevoke.ok).toBe(false);
    if (!afterRevoke.ok) {
      expect(afterRevoke.status).toBe(403);
    }

    workspaceDb.close();
  });

  it('compresses context packages exceeding maximum size budget', () => {
    const workspaceDb = new WorkspaceStore(':memory:', 'owner-beta');
    const service = new ContextExportService(
      workspaceDb,
      {
        baseUrl: '',
        voiceName: 'marin',
        slackUsers: [],
        runtimeUrl: '',
      },
      workspaceDb.sharedContexts,
      () => undefined
    );

    const manyMessages = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message turn ${i}: Long content describing important research details and investigation notes ${i}`,
    }));

    const bigPackage: ContextPackage = {
      schemaVersion: '1.0',
      source: {
        platform: 'OpenDots',
        conversationId: 't1',
        title: 'Big Context',
        dotName: 'Dot',
        exportedAt: new Date().toISOString(),
      },
      conversation: { title: 'Big Context' },
      messages: manyMessages,
      importantFacts: ['Fact 1'],
      decisions: ['Decision 1'],
      preferences: [],
      attachments: [],
    };

    // Compress with small budget (500 bytes)
    const compressed = service.compressPackage(bigPackage, 500);
    expect(compressed.metrics?.isCompressed).toBe(true);
    expect(compressed.messages.length).toBeLessThan(manyMessages.length);
    expect(compressed.messages.some((m) => m.content.includes('compressed'))).toBe(true);

    workspaceDb.close();
  });
});

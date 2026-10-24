import { Hono } from 'hono';
import { z } from 'zod';
import type { ContextExportService } from './context-export-service.js';
import type { SharedContextStore } from './shared-context-store.js';
import type { WorkspaceStore } from './workspace.js';
import {
  getDestinationAdapter,
  listDestinationAdapters,
} from './adapters/index.js';
import type { DestinationAdapterId } from '../shared/context-share-types.js';

const exportOptionsSchema = z
  .object({
    mode: z.enum(['full', 'smart', 'custom']).default('smart'),
    includeMessages: z.boolean().optional(),
    includeSummary: z.boolean().optional(),
    includeDecisions: z.boolean().optional(),
    includePreferences: z.boolean().optional(),
    includeCurrentTask: z.boolean().optional(),
    includeAttachments: z.boolean().optional(),
    maxTokens: z.number().int().min(100).max(128_000).optional(),
    destination: z.enum(['chatgpt', 'claude', 'gemini', 'custom_ai']).optional(),
  })
  .strict();

const createShareSchema = exportOptionsSchema.extend({
  expiresInSeconds: z.number().int().min(60).max(31_536_000).nullable().optional(),
  oneTimeUse: z.boolean().optional(),
});

const importSchema = z
  .object({
    targetDotId: z.string().min(1).optional(),
  })
  .strict();

export function contextRoutes(
  exportService: ContextExportService,
  sharedStore: SharedContextStore,
  workspace: WorkspaceStore
) {
  const app = new Hono();

  // List available destination adapters
  app.get('/context/destinations', (c) => {
    return c.json({ ok: true, destinations: listDestinationAdapters() });
  });

  // Export context preview
  app.post('/conversations/:conversationId/context/export', async (c) => {
    const conversationId = c.req.param('conversationId');
    try {
      workspace.requireThread(conversationId);
    } catch {
      return c.json({ error: 'Conversation not found or access denied.' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = exportOptionsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid export options provided.' }, 400);
    }

    try {
      const pkg = await exportService.buildContextPackage(
        conversationId,
        parsed.data
      );

      const adapterId = (parsed.data.destination ?? 'custom_ai') as DestinationAdapterId;
      const adapter = getDestinationAdapter(adapterId);
      const prepared = await adapter.prepareContext(pkg);

      return c.json({
        ok: true,
        package: pkg,
        prepared,
      });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : 'Context export failed.' },
        500
      );
    }
  });

  // Generate structured summary
  app.post('/conversations/:conversationId/context/summary', async (c) => {
    const conversationId = c.req.param('conversationId');
    try {
      workspace.requireThread(conversationId);
    } catch {
      return c.json({ error: 'Conversation not found or access denied.' }, 404);
    }

    try {
      const rawMessages = await exportService.extractRawMessages(conversationId);
      const summary = await exportService.generateSummary(
        conversationId,
        rawMessages
      );
      return c.json({ ok: true, summary });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : 'Summary generation failed.' },
        500
      );
    }
  });

  // Create shareable context link
  app.post('/conversations/:conversationId/context/share', async (c) => {
    const conversationId = c.req.param('conversationId');
    try {
      workspace.requireThread(conversationId);
    } catch {
      return c.json({ error: 'Conversation not found or access denied.' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = createShareSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid share configuration options.' }, 400);
    }

    try {
      const share = await exportService.createShareLink(
        conversationId,
        parsed.data
      );

      const adapterId = (parsed.data.destination ?? 'custom_ai') as DestinationAdapterId;
      const adapter = getDestinationAdapter(adapterId);
      const prepared = await adapter.prepareContext(share.package);

      return c.json(
        {
          ok: true,
          shareId: share.shareId,
          token: share.token,
          shareHashPath: `#/shared-context/${share.token}`,
          expiresAt: share.expiresAt,
          package: share.package,
          prepared,
        },
        201
      );
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : 'Failed to generate share link.' },
        500
      );
    }
  });

  // List active shares for a conversation
  app.get('/conversations/:conversationId/context/shares', (c) => {
    const conversationId = c.req.param('conversationId');
    try {
      workspace.requireThread(conversationId);
    } catch {
      return c.json({ error: 'Conversation not found or access denied.' }, 404);
    }

    const records = sharedStore.listByConversation(
      conversationId,
      workspace.ownerId
    );

    return c.json({
      ok: true,
      shares: records.map((r) => ({
        id: r.id,
        title: r.title,
        sharingMode: r.sharingMode,
        expiresAt: r.expiresAt,
        maxUses: r.maxUses,
        usageCount: r.usageCount,
        revoked: r.revokedAt !== null,
        createdAt: r.createdAt,
      })),
    });
  });

  // Revoke an active share link
  app.delete('/shared-context/:shareId', (c) => {
    const shareId = c.req.param('shareId');
    const success = sharedStore.revokeShare(shareId, workspace.ownerId);
    if (!success) {
      return c.json(
        { error: 'Shared context link not found or already revoked.' },
        404
      );
    }
    return c.json({ ok: true, message: 'Share link successfully revoked.' });
  });

  // Public retrieval of shared context
  app.get('/shared-context/:token', (c) => {
    const token = c.req.param('token');
    const actorIp = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip');
    const userAgent = c.req.header('user-agent');

    const result = exportService.getPublicSharedContext(token, {
      actorIp,
      userAgent,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 500);
    }

    return c.json({ ok: true, data: result.data });
  });

  // Import shared context into OpenDots
  app.post('/shared-context/:token/import', async (c) => {
    const token = c.req.param('token');
    const body = await c.req.json().catch(() => ({}));
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid import parameters.' }, 400);
    }

    const dots = workspace.dots();
    const targetDotId = parsed.data.targetDotId ?? dots[0]?.id;
    if (!targetDotId) {
      return c.json({ error: 'No active Dots available to receive context.' }, 400);
    }

    const actorIp = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip');
    const userAgent = c.req.header('user-agent');

    try {
      const imported = await exportService.importSharedContext(
        token,
        targetDotId,
        { actorIp, userAgent }
      );
      return c.json({ ok: true, ...imported });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : 'Failed to import shared context.' },
        400
      );
    }
  });

  return app;
}

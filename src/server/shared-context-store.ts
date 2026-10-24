import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  SharedContextRecord,
  SharingMode,
} from '../shared/context-share-types.js';

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function generateShareToken(): string {
  return randomBytes(24).toString('base64url');
}

export class SharedContextStore {
  constructor(private db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_contexts (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        conversationId TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        contextData TEXT NOT NULL,
        sharingMode TEXT NOT NULL,
        expiresAt INTEGER,
        maxUses INTEGER,
        usageCount INTEGER NOT NULL DEFAULT 0,
        revokedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shared_contexts_token ON shared_contexts(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_shared_contexts_conv ON shared_contexts(conversationId);
      CREATE INDEX IF NOT EXISTS idx_shared_contexts_owner ON shared_contexts(ownerId);

      CREATE TABLE IF NOT EXISTS shared_context_audits (
        id TEXT PRIMARY KEY,
        shareId TEXT NOT NULL,
        action TEXT NOT NULL,
        actorIp TEXT,
        userAgent TEXT,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shared_context_audits ON shared_context_audits(shareId, createdAt);
    `);
  }

  createShare(input: {
    ownerId: string;
    conversationId: string;
    title: string;
    contextData: string;
    sharingMode: SharingMode;
    expiresInSeconds?: number | null;
    oneTimeUse?: boolean;
  }): { id: string; rawToken: string; expiresAt: number | null } {
    const rawToken = generateShareToken();
    const tokenHash = hashShareToken(rawToken);
    const id = randomUUID();
    const now = Date.now();
    const expiresAt =
      typeof input.expiresInSeconds === 'number' && input.expiresInSeconds > 0
        ? now + input.expiresInSeconds * 1000
        : null;
    const maxUses = input.oneTimeUse ? 1 : null;

    this.db
      .prepare(
        `INSERT INTO shared_contexts (
          id, ownerId, conversationId, tokenHash, title, contextData,
          sharingMode, expiresAt, maxUses, usageCount, revokedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
      )
      .run(
        id,
        input.ownerId,
        input.conversationId,
        tokenHash,
        input.title,
        input.contextData,
        input.sharingMode,
        expiresAt,
        maxUses,
        now,
        now
      );

    this.recordAudit(id, 'created');

    return { id, rawToken, expiresAt };
  }

  findByToken(rawToken: string): SharedContextRecord | null {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const tokenHash = hashShareToken(rawToken);
    const row = this.db
      .prepare('SELECT * FROM shared_contexts WHERE tokenHash = ?')
      .get(tokenHash) as unknown as SharedContextRecord | undefined;

    if (!row) return null;

    return {
      ...row,
      expiresAt: row.expiresAt !== null ? Number(row.expiresAt) : null,
      maxUses: row.maxUses !== null ? Number(row.maxUses) : null,
      usageCount: Number(row.usageCount ?? 0),
      revokedAt: row.revokedAt !== null ? Number(row.revokedAt) : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  findById(id: string): SharedContextRecord | null {
    const row = this.db
      .prepare('SELECT * FROM shared_contexts WHERE id = ?')
      .get(id) as unknown as SharedContextRecord | undefined;

    if (!row) return null;

    return {
      ...row,
      expiresAt: row.expiresAt !== null ? Number(row.expiresAt) : null,
      maxUses: row.maxUses !== null ? Number(row.maxUses) : null,
      usageCount: Number(row.usageCount ?? 0),
      revokedAt: row.revokedAt !== null ? Number(row.revokedAt) : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  }

  consumeUse(id: string): boolean {
    const now = Date.now();
    // Atomic check-and-increment to prevent race conditions on one-time use
    const result = this.db
      .prepare(
        `UPDATE shared_contexts
         SET usageCount = usageCount + 1, updatedAt = ?
         WHERE id = ?
           AND revokedAt IS NULL
           AND (expiresAt IS NULL OR expiresAt > ?)
           AND (maxUses IS NULL OR usageCount < maxUses)`
      )
      .run(now, id, now);

    const consumed = Number(result.changes) > 0;
    if (consumed) {
      this.recordAudit(id, 'imported');
    }
    return consumed;
  }

  revokeShare(id: string, ownerId: string): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE shared_contexts
         SET revokedAt = ?, updatedAt = ?
         WHERE id = ? AND ownerId = ? AND revokedAt IS NULL`
      )
      .run(now, now, id, ownerId);

    const revoked = Number(result.changes) > 0;
    if (revoked) {
      this.recordAudit(id, 'revoked');
    }
    return revoked;
  }

  listByConversation(
    conversationId: string,
    ownerId: string
  ): SharedContextRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM shared_contexts
         WHERE conversationId = ? AND ownerId = ?
         ORDER BY createdAt DESC`
      )
      .all(conversationId, ownerId) as unknown as SharedContextRecord[];

    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt !== null ? Number(row.expiresAt) : null,
      maxUses: row.maxUses !== null ? Number(row.maxUses) : null,
      usageCount: Number(row.usageCount ?? 0),
      revokedAt: row.revokedAt !== null ? Number(row.revokedAt) : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  recordAudit(
    shareId: string,
    action: 'created' | 'accessed' | 'imported' | 'revoked' | 'expired',
    actorIp?: string,
    userAgent?: string
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO shared_context_audits (id, shareId, action, actorIp, userAgent, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          shareId,
          action,
          actorIp ? actorIp.slice(0, 100) : null,
          userAgent ? userAgent.slice(0, 250) : null,
          Date.now()
        );
    } catch {
      // Audit failure should not break primary operation
    }
  }
}

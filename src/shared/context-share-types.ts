export interface ContextSummary {
  userGoal?: string;
  currentTask?: string;
  importantFacts: string[];
  decisionsAlreadyMade: string[];
  userPreferences: string[];
  previousAttempts?: string[];
  currentStatus?: string;
  remainingWork?: string[];
  importantConstraints?: string[];
  openQuestions?: string[];
}

export interface ContextAttachment {
  id: string;
  name: string;
  type: string;
  sizeBytes?: number;
  snippet?: string;
  sourceUrl?: string;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ContextPackage {
  schemaVersion: '1.0';
  source: {
    platform: 'OpenDots';
    conversationId: string;
    title: string;
    dotName: string;
    dotInstructions?: string;
    exportedAt: string;
  };
  conversation: {
    title: string;
    summary?: ContextSummary;
    goal?: string;
    currentState?: string;
  };
  messages: ContextMessage[];
  importantFacts: string[];
  decisions: string[];
  preferences: string[];
  attachments: ContextAttachment[];
  metrics?: {
    totalMessages: number;
    estimatedTokens: number;
    sizeBytes: number;
    isCompressed: boolean;
  };
}

export type SharingMode = 'full' | 'smart' | 'custom';

export type DestinationAdapterId = 'chatgpt' | 'claude' | 'gemini' | 'custom_ai';

export interface ContextExportOptions {
  mode: SharingMode;
  includeMessages?: boolean;
  includeSummary?: boolean;
  includeDecisions?: boolean;
  includePreferences?: boolean;
  includeCurrentTask?: boolean;
  includeAttachments?: boolean;
  maxTokens?: number;
  destination?: DestinationAdapterId;
}

export interface CreateShareOptions extends ContextExportOptions {
  expiresInSeconds?: number | null; // null for never
  oneTimeUse?: boolean;
}

export interface SharedContextRecord {
  id: string;
  ownerId: string;
  conversationId: string;
  tokenHash: string;
  title: string;
  contextData: string; // JSON string of ContextPackage
  sharingMode: SharingMode;
  expiresAt: number | null;
  maxUses: number | null;
  usageCount: number;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicSharedContext {
  id: string;
  title: string;
  sharingMode: SharingMode;
  source: ContextPackage['source'];
  conversation: ContextPackage['conversation'];
  messagesCount: number;
  package: ContextPackage;
  expiresAt: number | null;
  oneTimeUse: boolean;
  createdAt: number;
}

export interface DestinationPreparedContext {
  destinationId: DestinationAdapterId;
  destinationName: string;
  systemPrompt: string;
  formattedText: string;
  clipboardPayload: string;
  directUrl?: string | null;
}

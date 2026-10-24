import { useEffect, useState, useId } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Share2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from './api';
import type {
  ContextPackage,
  CreateShareOptions,
  DestinationAdapterId,
  DestinationPreparedContext,
  SharingMode,
} from '../shared/context-share-types';
import type { Conversation, Dot } from '../shared/types';

interface ShareResult {
  shareId: string;
  token: string;
  shareUrl: string;
  expiresAt: number | null;
  package: ContextPackage;
  prepared?: DestinationPreparedContext;
}

export function ShareContextModal({
  thread,
  dot,
  onClose,
}: {
  thread: Conversation;
  dot: Dot;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<SharingMode>('smart');
  const [includeMessages, setIncludeMessages] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeDecisions, setIncludeDecisions] = useState(true);
  const [includePreferences, setIncludePreferences] = useState(true);
  const [includeCurrentTask, setIncludeCurrentTask] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(true);

  const [destination, setDestination] =
    useState<DestinationAdapterId>('custom_ai');
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | null>(
    86400 // 24 hours default
  );
  const [oneTimeUse, setOneTimeUse] = useState(false);

  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPackage, setPreviewPackage] = useState<ContextPackage | null>(
    null
  );
  const [error, setError] = useState('');
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const uniqueId = useId();

  // Load preview metrics when options change
  useEffect(() => {
    let active = true;
    const fetchPreview = async () => {
      setPreviewLoading(true);
      setError('');
      try {
        const response = await api<{
          ok: boolean;
          package: ContextPackage;
          prepared: DestinationPreparedContext;
        }>(`/conversations/${thread.id}/context/export`, 'POST', {
          mode,
          includeMessages,
          includeSummary,
          includeDecisions,
          includePreferences,
          includeCurrentTask,
          includeAttachments,
          destination,
        });

        if (active) {
          setPreviewPackage(response.package);
        }
      } catch (e) {
        if (active) {
          setError(
            e instanceof ApiError ? e.message : 'Could not prepare context preview.'
          );
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    };

    const timer = setTimeout(() => void fetchPreview(), 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    thread.id,
    mode,
    includeMessages,
    includeSummary,
    includeDecisions,
    includePreferences,
    includeCurrentTask,
    includeAttachments,
    destination,
  ]);

  const handleShare = async () => {
    setLoading(true);
    setError('');
    try {
      const options: CreateShareOptions = {
        mode,
        includeMessages,
        includeSummary,
        includeDecisions,
        includePreferences,
        includeCurrentTask,
        includeAttachments,
        destination,
        expiresInSeconds,
        oneTimeUse,
      };

      const result = await api<{
        ok: boolean;
        shareId: string;
        token: string;
        shareHashPath: string;
        expiresAt: number | null;
        package: ContextPackage;
        prepared: DestinationPreparedContext;
      }>(`/conversations/${thread.id}/context/share`, 'POST', options);

      const fullShareUrl = `${window.location.origin}${window.location.pathname}${result.shareHashPath}`;

      setShareResult({
        shareId: result.shareId,
        token: result.token,
        shareUrl: fullShareUrl,
        expiresAt: result.expiresAt,
        package: result.package,
        prepared: result.prepared,
      });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Failed to generate share link.'
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, isLink: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isLink) {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
      }
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const handleRevoke = async () => {
    if (!shareResult) return;
    setRevoking(true);
    try {
      await api(`/shared-context/${shareResult.shareId}`, 'DELETE');
      setRevoked(true);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not revoke share link.'
      );
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog-card share-context-modal">
        <header className="dialog-header">
          <div className="dialog-title-group">
            <Share2 size={19} className="share-header-icon" />
            <div>
              <h2>Share Context</h2>
              <p className="dialog-subtitle">
                Transfer this conversation to another AI without explaining everything again.
              </p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close share context dialog"
          >
            <X size={18} />
          </button>
        </header>

        {error && (
          <div className="dialog-error-banner" role="alert">
            {error}
          </div>
        )}

        {!shareResult ? (
          <div className="share-modal-body">
            {/* Mode selection */}
            <div className="share-section">
              <label className="section-label">Sharing mode</label>
              <div className="share-mode-grid">
                <label
                  className={`share-mode-card ${mode === 'smart' ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name={`share-mode-${uniqueId}`}
                    checked={mode === 'smart'}
                    onChange={() => setMode('smart')}
                  />
                  <div>
                    <strong>Smart Context</strong>
                    <span>Summary, decisions, goal, and recent turns</span>
                  </div>
                </label>

                <label
                  className={`share-mode-card ${mode === 'full' ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name={`share-mode-${uniqueId}`}
                    checked={mode === 'full'}
                    onChange={() => setMode('full')}
                  />
                  <div>
                    <strong>Entire Conversation</strong>
                    <span>Complete transcript + AI summary</span>
                  </div>
                </label>

                <label
                  className={`share-mode-card ${mode === 'custom' ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name={`share-mode-${uniqueId}`}
                    checked={mode === 'custom'}
                    onChange={() => setMode('custom')}
                  />
                  <div>
                    <strong>Custom Context</strong>
                    <span>Choose specific components to include</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Custom checkboxes if custom mode */}
            {mode === 'custom' && (
              <div className="share-section custom-options-panel">
                <label className="section-label">Include in context</label>
                <div className="checkbox-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={includeMessages}
                      onChange={(e) => setIncludeMessages(e.target.checked)}
                    />
                    <span>Conversation messages</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeSummary}
                      onChange={(e) => setIncludeSummary(e.target.checked)}
                    />
                    <span>Conversation summary</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeDecisions}
                      onChange={(e) => setIncludeDecisions(e.target.checked)}
                    />
                    <span>Important decisions</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includePreferences}
                      onChange={(e) => setIncludePreferences(e.target.checked)}
                    />
                    <span>User preferences</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeCurrentTask}
                      onChange={(e) => setIncludeCurrentTask(e.target.checked)}
                    />
                    <span>Current task & status</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={includeAttachments}
                      onChange={(e) => setIncludeAttachments(e.target.checked)}
                    />
                    <span>Space page attachments</span>
                  </label>
                </div>
              </div>
            )}

            {/* Destination Selection */}
            <div className="share-section">
              <label className="section-label">Destination AI format</label>
              <select
                className="share-select"
                value={destination}
                onChange={(e) =>
                  setDestination(e.target.value as DestinationAdapterId)
                }
              >
                <option value="custom_ai">Universal Context (JSON / Markdown)</option>
                <option value="chatgpt">ChatGPT (OpenAI)</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>

            {/* Security and Expiration Options */}
            <div className="share-section security-section">
              <label className="section-label">Security & Link Expiration</label>
              <div className="security-controls-row">
                <select
                  className="share-select"
                  value={expiresInSeconds === null ? 'never' : String(expiresInSeconds)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExpiresInSeconds(val === 'never' ? null : Number(val));
                  }}
                >
                  <option value="3600">Expires in 1 hour</option>
                  <option value="86400">Expires in 24 hours</option>
                  <option value="604800">Expires in 7 days</option>
                  <option value="never">Never expires</option>
                </select>

                <label className="one-time-label">
                  <input
                    type="checkbox"
                    checked={oneTimeUse}
                    onChange={(e) => setOneTimeUse(e.target.checked)}
                  />
                  <span>Allow one-time use only</span>
                </label>
              </div>
            </div>

            {/* Context Size Metrics Preview */}
            <div className="context-metrics-bar">
              {previewLoading ? (
                <div className="metrics-loading">
                  <Loader2 size={14} className="spin" />
                  <span>Estimating context payload...</span>
                </div>
              ) : previewPackage ? (
                <div className="metrics-content">
                  <span>
                    <strong>Size:</strong>{' '}
                    {(previewPackage.metrics?.sizeBytes
                      ? previewPackage.metrics.sizeBytes / 1024
                      : 0
                    ).toFixed(1)}{' '}
                    KB
                  </span>
                  <span>
                    <strong>Messages:</strong> {previewPackage.messages.length}
                  </span>
                  <span>
                    <strong>Decisions:</strong> {previewPackage.decisions.length}
                  </span>
                  {previewPackage.attachments.length > 0 && (
                    <span>
                      <strong>Attachments:</strong>{' '}
                      {previewPackage.attachments.length}
                    </span>
                  )}
                  {previewPackage.metrics?.isCompressed && (
                    <span className="compressed-badge">Compressed</span>
                  )}
                </div>
              ) : (
                <span>Ready to package context</span>
              )}
            </div>

            {/* Privacy Notice */}
            <div className="privacy-warning">
              <ShieldAlert size={15} />
              <span>
                Only share context you are comfortable sending to the selected destination.
              </span>
            </div>

            {/* Modal Actions */}
            <footer className="dialog-footer">
              <button
                type="button"
                className="button-secondary"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void handleShare()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Packaging...
                  </>
                ) : (
                  'Share Context'
                )}
              </button>
            </footer>
          </div>
        ) : (
          /* Success Screen */
          <div className="share-modal-body success-state">
            <div className="share-success-banner">
              <div className="success-badge">
                <Check size={20} />
              </div>
              <h3>Context Ready</h3>
              <p>Your conversation context is packaged and ready to transfer.</p>
            </div>

            <div className="share-meta-summary">
              <div>
                <strong>Messages:</strong> {shareResult.package.messages.length}
              </div>
              <div>
                <strong>Decisions:</strong> {shareResult.package.decisions.length}
              </div>
              <div>
                <strong>Size:</strong>{' '}
                {(shareResult.package.metrics?.sizeBytes
                  ? shareResult.package.metrics.sizeBytes / 1024
                  : 0
                ).toFixed(1)}{' '}
                KB
              </div>
              {shareResult.expiresAt && (
                <div>
                  <strong>Expires:</strong>{' '}
                  {new Date(shareResult.expiresAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>

            {/* Share Link Row */}
            <div className="share-link-box">
              <label className="section-label">Shareable Link</label>
              <div className="link-input-group">
                <input
                  type="text"
                  readOnly
                  value={shareResult.shareUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  className="button-secondary copy-button"
                  onClick={() =>
                    void copyToClipboard(shareResult.shareUrl, true)
                  }
                >
                  {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            {/* Context Prompt Payload */}
            <div className="share-link-box">
              <label className="section-label">
                Formatted Context ({shareResult.prepared?.destinationName ?? 'Universal'})
              </label>
              <div className="payload-preview">
                <pre>{shareResult.prepared?.formattedText}</pre>
              </div>
            </div>

            <div className="success-action-buttons">
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void copyToClipboard(
                    shareResult.prepared?.clipboardPayload ?? '',
                    false
                  )
                }
              >
                {copiedText ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiedText ? 'Copied Prompt!' : 'Copy Context Prompt'}</span>
              </button>

              {shareResult.prepared?.directUrl && (
                <a
                  href={shareResult.prepared.directUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button-secondary direct-destination-link"
                >
                  <span>Open {shareResult.prepared.destinationName}</span>
                  <ExternalLink size={15} />
                </a>
              )}
            </div>

            {/* Revoke Control */}
            <div className="revoke-control-row">
              {revoked ? (
                <span className="revoked-status">This share link has been revoked.</span>
              ) : (
                <button
                  type="button"
                  className="revoke-button"
                  disabled={revoking}
                  onClick={() => void handleRevoke()}
                >
                  <Trash2 size={14} />
                  <span>{revoking ? 'Revoking...' : 'Revoke link now'}</span>
                </button>
              )}
            </div>

            <footer className="dialog-footer">
              <button
                type="button"
                className="button-primary"
                onClick={onClose}
              >
                Done
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

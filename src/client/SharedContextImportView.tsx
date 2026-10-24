import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { api, ApiError } from './api';
import type { PublicSharedContext } from '../shared/context-share-types';
import type { Dot } from '../shared/types';
import { Mascot } from './Mascot';

export function SharedContextImportView({
  token,
  dots,
  onImported,
  onCancel,
}: {
  token: string;
  dots: Dot[];
  onImported: (threadId: string, dotId: string, initialPrompt: string) => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [shared, setShared] = useState<PublicSharedContext | null>(null);
  const [targetDotId, setTargetDotId] = useState(dots[0]?.id ?? '');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    const fetchSharedContext = async () => {
      try {
        const response = await api<{ ok: boolean; data: PublicSharedContext }>(
          `/shared-context/${token}`,
          'GET'
        );
        if (active) {
          setShared(response.data);
        }
      } catch (e) {
        if (active) {
          setError(
            e instanceof ApiError
              ? e.message
              : 'Could not load the shared context package.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchSharedContext();

    return () => {
      active = false;
    };
  }, [token]);

  const handleImport = async () => {
    if (!targetDotId) return;
    setImporting(true);
    setError('');
    try {
      const response = await api<{
        ok: boolean;
        threadId: string;
        dotId: string;
        title: string;
        initialPrompt: string;
      }>(`/shared-context/${token}/import`, 'POST', {
        targetDotId,
      });

      onImported(
        response.threadId,
        response.dotId,
        response.initialPrompt
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Failed to import the shared context.'
      );
    } finally {
      setImporting(false);
    }
  };

  const selectedDot = dots.find((d) => d.id === targetDotId) ?? dots[0];

  return (
    <div className="import-workspace-container">
      <div className="import-context-card">
        {loading ? (
          <div className="import-loading-state">
            <Loader2 size={32} className="spin" />
            <p>Verifying and retrieving shared context...</p>
          </div>
        ) : error ? (
          <div className="import-error-state">
            <ShieldAlert size={40} className="error-icon" />
            <h2>Unable to load shared context</h2>
            <p>{error}</p>
            <button className="button-secondary" onClick={onCancel}>
              Return to workspace
            </button>
          </div>
        ) : shared ? (
          <div className="import-content">
            <div className="import-header">
              <span className="import-eyebrow">
                <Sparkles size={14} /> CONVERSATION CONTEXT RECEIVED
              </span>
              <h2>{shared.title}</h2>
              <p className="import-source-meta">
                Source: <strong>{shared.source.platform}</strong> ({shared.source.dotName})
                {shared.expiresAt && (
                  <span className="expires-pill">
                    <Clock size={12} />
                    Expires {new Date(shared.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {shared.oneTimeUse && (
                  <span className="one-time-pill">One-time import</span>
                )}
              </p>
            </div>

            {shared.conversation.goal && (
              <div className="import-section-box">
                <span className="box-title">Objective / Goal</span>
                <p>{shared.conversation.goal}</p>
              </div>
            )}

            <div className="import-included-grid">
              <div className="included-item">
                <CheckCircle2 size={16} />
                <span>
                  <strong>{shared.messagesCount}</strong> conversation messages
                </span>
              </div>

              {shared.package.decisions.length > 0 && (
                <div className="included-item">
                  <CheckCircle2 size={16} />
                  <span>
                    <strong>{shared.package.decisions.length}</strong> important decisions
                  </span>
                </div>
              )}

              {shared.conversation.summary && (
                <div className="included-item">
                  <CheckCircle2 size={16} />
                  <span>Structured AI context summary</span>
                </div>
              )}

              {shared.conversation.currentState && (
                <div className="included-item">
                  <CheckCircle2 size={16} />
                  <span>Current task & status snapshot</span>
                </div>
              )}

              {shared.package.attachments.length > 0 && (
                <div className="included-item">
                  <FileText size={16} />
                  <span>
                    <strong>{shared.package.attachments.length}</strong> referenced document(s)
                  </span>
                </div>
              )}
            </div>

            {/* Target Dot Selection */}
            <div className="import-target-selector">
              <label htmlFor="target-dot-select">Continue with Dot</label>
              <div className="dot-selector-row">
                <select
                  id="target-dot-select"
                  value={targetDotId}
                  onChange={(e) => setTargetDotId(e.target.value)}
                  className="share-select"
                >
                  {dots.map((dot) => (
                    <option key={dot.id} value={dot.id}>
                      {dot.name} ({dot.instructions.slice(0, 40)}…)
                    </option>
                  ))}
                </select>
                {selectedDot && (
                  <div className="dot-mini-preview">
                    <Mascot identity={selectedDot.id} name={selectedDot.name} state="idle" />
                    <span>{selectedDot.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="import-footer-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={onCancel}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void handleImport()}
                disabled={importing || !targetDotId}
              >
                {importing ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Importing context...
                  </>
                ) : (
                  <>
                    Import Context <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

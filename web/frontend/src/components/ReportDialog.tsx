import { useState, useCallback } from 'react';
import type { OnlineUser } from '../types';
import { useI18n } from '../i18n';

interface Props {
  onlineUsers: OnlineUser[];
  apiUrl: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function ReportDialog({ onlineUsers, apiUrl, onClose, onSubmitted }: Props) {
  const { t } = useI18n();
  const [reportedPublicUserId, setReportedPublicUserId] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const uid = reportedPublicUserId.trim();
      const desc = description.trim();
      if (!uid || !desc) {
        setError(t('report.selectUser'));
        return;
      }
      if (desc.length > 500) {
        setError('Description must be 500 characters or less.');
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch(`${apiUrl}/api/report`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportedPublicUserId: uid, description: desc }),
        });
        if (res.ok) {
          onSubmitted();
          onClose();
          return;
        }
        const data = await res.json();
        setError(data.error || t('report.failed'));
      } catch {
        setError(t('common.networkError'));
      } finally {
        setSubmitting(false);
      }
    },
    [reportedPublicUserId, description, apiUrl, onClose, onSubmitted, t]
  );

  return (
    <div className="poke-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="poke-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="poke-header">
          <span className="poke-title">{t('report.title')}</span>
          <button className="poke-close" onClick={onClose} aria-label={t('common.close')}>
            &times;
          </button>
        </div>
        <p className="report-dialog-desc">
          Report a user for harassment or abuse. Reports are reviewed by admins.
        </p>
        <form onSubmit={handleSubmit} className="report-form">
          <label className="report-label">
            {t('report.selectUser')}
            <select
              value={reportedPublicUserId}
              onChange={(e) => setReportedPublicUserId(e.target.value)}
              className="poke-input"
              required
            >
              <option value="">{t('report.selectUser')}</option>
              {onlineUsers.map((u) => (
                <option key={u.publicUserId} value={u.publicUserId}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="report-label">
            {t('report.reason')}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="poke-input report-textarea"
              placeholder={t('report.reason')}
              maxLength={500}
              rows={4}
              required
            />
            <span className="poke-char-count">{description.length}/500</span>
          </label>
          {error && <p className="report-error" role="alert">{error}</p>}
          <div className="report-actions">
            <button type="button" className="btn report-cancel" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn report-submit" disabled={submitting}>
              {submitting ? t('common.loading') : t('report.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

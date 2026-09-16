import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { GroupInfo, User } from '../types';
import { useI18n } from '../i18n';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  user: User;
}

interface JoinRequest {
  publicUserId: string;
  displayName: string;
  avatar: string;
  createdAt: string;
}

export default function GroupsPage({ user }: Props) {
  const { t } = useI18n();
  const [publicGroups, setPublicGroups] = useState<GroupInfo[]>([]);
  const [myGroups, setMyGroups] = useState<GroupInfo[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [inviteCode, setInviteCode] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch(`${API_URL}/api/groups/public`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => setPublicGroups(d.groups || []))
      .catch(() => setPublicGroups([]));

    fetch(`${API_URL}/api/groups/mine`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => setMyGroups(d.groups || []))
      .catch(() => setMyGroups([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedGroupId) {
      setRequests([]);
      return;
    }
    fetch(`${API_URL}/api/groups/${selectedGroupId}/requests`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests || []))
      .catch(() => setRequests([]));
  }, [selectedGroupId]);

  const createGroup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description, visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setName('');
      setDescription('');
      refresh();
      if (data.group?.inviteCode) {
        alert(`Group created. Invite code: ${data.group.inviteCode}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const joinPublic = async (groupId: string) => {
    setError(null);
    const res = await fetch(`${API_URL}/api/groups/${groupId}/join`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to join');
      return;
    }
    refresh();
  };

  const joinByCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/groups/join-by-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      setInviteCode('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (groupId: string, userPublicId: string, decision: 'approved' | 'rejected') => {
    const res = await fetch(`${API_URL}/api/groups/${groupId}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userPublicId, decision }),
    });
    if (res.ok) {
      setRequests((prev) => prev.filter((r) => r.publicUserId !== userPublicId));
      refresh();
    }
  };

  const leave = async (groupId: string) => {
    const res = await fetch(`${API_URL}/api/groups/${groupId}/leave`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed');
      return;
    }
    if (selectedGroupId === groupId) setSelectedGroupId(null);
    refresh();
  };

  const removeGroup = async (groupId: string) => {
    if (!confirm(t('groups.deleteConfirm'))) return;
    const res = await fetch(`${API_URL}/api/groups/${groupId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed');
      return;
    }
    if (selectedGroupId === groupId) setSelectedGroupId(null);
    refresh();
  };

  const myApprovedIds = new Set(
    myGroups.filter((g) => g.memberStatus === 'approved').map((g) => g.id)
  );
  const myPendingIds = new Set(
    myGroups.filter((g) => g.memberStatus === 'pending').map((g) => g.id)
  );

  return (
    <div className="page-scroll groups-page">
      <header className="page-header">
        <h1>{t('groups.title')}</h1>
        <p className="page-sub">{t('groups.sub')}</p>
      </header>

      {error && <div className="page-error">{error}</div>}

      <section className="dash-section">
        <h2>{t('groups.create')}</h2>
        <form className="dash-form" onSubmit={createGroup}>
          <input
            required
            maxLength={64}
            placeholder={t('groups.namePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            maxLength={280}
            placeholder={t('groups.descPh')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
          >
            <option value="public">{t('groups.publicOpt')}</option>
            <option value="private">{t('groups.privateOpt')}</option>
          </select>
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('groups.create')}
          </button>
        </form>
      </section>

      <section className="dash-section">
        <h2>{t('groups.joinCode')}</h2>
        <form className="dash-form-row" onSubmit={joinByCode}>
          <input
            placeholder={t('groups.invitePlaceholder')}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy || !inviteCode.trim()}>
            {t('groups.requestJoin')}
          </button>
        </form>
      </section>

      <section className="dash-section">
        <h2>{t('groups.mine')}</h2>
        {myGroups.length === 0 ? (
          <p className="page-sub">{t('groups.empty')}</p>
        ) : (
          <ul className="dash-list">
            {myGroups.map((g) => (
              <li key={g.id} className="dash-list-item col">
                <div className="dash-list-item">
                  <div>
                    <strong>{g.name}</strong>
                    <span className="page-sub">
                      {' '}
                      · {g.visibility} · {g.memberStatus} · {g.memberRole}
                      {g.inviteCode ? ` · code ${g.inviteCode}` : ''}
                    </span>
                  </div>
                  <div className="dash-form-row">
                    {(g.memberRole === 'owner' || g.memberRole === 'admin') &&
                      g.memberStatus === 'approved' && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setSelectedGroupId(g.id)}
                        >
                          {t('groups.requests')}
                        </button>
                      )}
                    {g.memberRole !== 'owner' && g.memberStatus === 'approved' && (
                      <button type="button" className="btn-text" onClick={() => leave(g.id)}>
                        {t('groups.leave')}
                      </button>
                    )}
                    {g.ownerPublicUserId === user.publicUserId && (
                      <button type="button" className="btn-text" onClick={() => removeGroup(g.id)}>
                        {t('groups.delete')}
                      </button>
                    )}
                  </div>
                </div>
                {selectedGroupId === g.id && (
                  <div className="dash-requests">
                    {requests.length === 0 ? (
                      <p className="page-sub">{t('groups.noPending')}</p>
                    ) : (
                      requests.map((r) => (
                        <div key={r.publicUserId} className="dash-list-item">
                          <span>{r.displayName}</span>
                          <div className="dash-form-row">
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => decide(g.id, r.publicUserId, 'approved')}
                            >
                              {t('groups.approve')}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => decide(g.id, r.publicUserId, 'rejected')}
                            >
                              {t('groups.reject')}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>{t('groups.public')}</h2>
        {publicGroups.length === 0 ? (
          <p className="page-sub">{t('groups.empty')}</p>
        ) : (
          <ul className="dash-list">
            {publicGroups.map((g) => (
              <li key={g.id} className="dash-list-item">
                <div>
                  <strong>{g.name}</strong>
                  <span className="page-sub">
                    {' '}
                    · {g.memberCount ?? 0} members
                    {g.description ? ` · ${g.description}` : ''}
                  </span>
                </div>
                {myApprovedIds.has(g.id) ? (
                  <span className="page-sub">{t('groups.joined')}</span>
                ) : myPendingIds.has(g.id) ? (
                  <span className="page-sub">{t('groups.pending')}</span>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => joinPublic(g.id)}>
                    {t('groups.join')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

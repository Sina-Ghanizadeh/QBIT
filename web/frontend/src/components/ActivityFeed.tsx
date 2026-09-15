import { useEffect, useState } from 'react';

export interface ActivityEventDto {
  id: string;
  kind: string;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetDeviceId: string | null;
  text: string | null;
  createdAt: string;
  actorPublicUserId?: string | null;
  targetPublicUserId?: string | null;
}

interface Props {
  apiUrl: string;
  liveEvent?: ActivityEventDto | null;
}

function label(ev: ActivityEventDto): string {
  const who = ev.actorName || 'Someone';
  switch (ev.kind) {
    case 'poke_device':
      return `${who} poked a QBIT: ${ev.text || ''}`.trim();
    case 'poke_user':
      return `${who} poked a friend: ${ev.text || ''}`.trim();
    case 'cam_start':
      return `${who} started webcam`;
    case 'cam_stop':
      return `${who} stopped webcam`;
    case 'friend_accept':
      return `${who} made a new friend`;
    case 'schedule_poke':
      return `Routine poke: ${ev.text || ''}`.trim();
    case 'water_drink':
      return `${who} logged water ${ev.text || ''}`.trim();
    case 'water_remind':
      return `Water reminder: ${ev.text || ''}`.trim();
    default:
      return `${who}: ${ev.kind}`;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export default function ActivityFeed({ apiUrl, liveEvent }: Props) {
  const [events, setEvents] = useState<ActivityEventDto[]>([]);

  useEffect(() => {
    fetch(`${apiUrl}/api/me/activity?limit=40`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(Array.isArray(d.events) ? d.events : []))
      .catch(() => setEvents([]));
  }, [apiUrl]);

  useEffect(() => {
    if (!liveEvent) return;
    setEvents((prev) => {
      if (prev.some((e) => e.id === liveEvent.id)) return prev;
      return [liveEvent, ...prev].slice(0, 60);
    });
  }, [liveEvent]);

  return (
    <section className="dash-section">
      <h2>Activity</h2>
      <p className="page-sub">Pokes, webcam, and friend events across your network.</p>
      {events.length === 0 ? (
        <p className="page-sub">No recent activity yet. Send a poke to get started.</p>
      ) : (
        <ul className="activity-list">
          {events.map((ev) => (
            <li key={ev.id} className="activity-item">
              <span className="activity-msg">{label(ev)}</span>
              <span className="activity-time">{timeAgo(ev.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { NetworkDeviceNode } from "../types";
import { useI18n } from "../i18n";

const API_URL = import.meta.env.VITE_API_URL || "";

interface FriendRow {
  publicUserId: string;
  displayName: string;
}

interface ScheduleRow {
  id: string;
  targetType: "device" | "user";
  targetId: string;
  text: string;
  cronType: "daily" | "weekly";
  timeUtc: string;
  weekday: number | null;
  enabled: boolean;
  lastRunAt: string | null;
}

function localHHMMToUtc(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const uh = String(d.getUTCHours()).padStart(2, "0");
  const um = String(d.getUTCMinutes()).padStart(2, "0");
  return `${uh}:${um}`;
}

function utcHHMMToLocal(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  const lh = String(d.getHours()).padStart(2, "0");
  const lm = String(d.getMinutes()).padStart(2, "0");
  return `${lh}:${lm}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function RoutinesPanel() {
  const { t } = useI18n();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [text, setText] = useState("Hi!");
  const [cronType, setCronType] = useState<"daily" | "weekly">("daily");
  const [localTime, setLocalTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [targetType, setTargetType] = useState<"device" | "user">("device");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`${API_URL}/api/me/schedules`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { schedules: [] }))
      .then((d) => setSchedules(Array.isArray(d.schedules) ? d.schedules : []))
      .catch(() => setSchedules([]));
    fetch(`${API_URL}/api/me/devices`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d) => setDevices(d.devices || []))
      .catch(() => setDevices([]));
    fetch(`${API_URL}/api/friends`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((d) => {
        const list = Array.isArray(d.friends) ? d.friends : [];
        setFriends(
          list.map((f: { publicUserId: string; displayName?: string }) => ({
            publicUserId: f.publicUserId,
            displayName: f.displayName || "Friend",
          }))
        );
      })
      .catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (targetType === "device") {
      setTargetId(devices[0]?.deviceId || "");
    } else {
      setTargetId(friends[0]?.publicUserId || "");
    }
  }, [targetType, devices, friends]);

  const create = async () => {
    if (!targetId || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/schedules`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          text: text.slice(0, 25),
          cronType,
          timeUtc: localHHMMToUtc(localTime),
          weekday: cronType === "weekly" ? weekday : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setText("Hi!");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    await fetch(`${API_URL}/api/me/schedules/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    refresh();
  };

  const remove = async (id: string) => {
    await fetch(`${API_URL}/api/me/schedules/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    refresh();
  };

  const labelTarget = (s: ScheduleRow) => {
    if (s.targetType === "device") {
      const d = devices.find((x) => x.deviceId === s.targetId);
      return d?.name || s.targetId.slice(0, 10);
    }
    const f = friends.find((x) => x.publicUserId === s.targetId);
    return f?.displayName || s.targetId.slice(0, 10);
  };

  return (
    <section className="dash-section">
      <h2>{t('routines.title')}</h2>
      <p className="page-sub">{t('routines.sub')}</p>
      {error && <div className="page-error">{error}</div>}
      <div className="dash-form-row routines-form">
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as "device" | "user")}>
          <option value="device">{t('routines.myDevice')}</option>
          <option value="user">{t('routines.friend')}</option>
        </select>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {targetType === "device"
            ? devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.name}
                </option>
              ))
            : friends.map((f) => (
                <option key={f.publicUserId} value={f.publicUserId}>
                  {f.displayName}
                </option>
              ))}
        </select>
        <input maxLength={25} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('routines.pokeText')} />
        <select value={cronType} onChange={(e) => setCronType(e.target.value as "daily" | "weekly")}>
          <option value="daily">{t('routines.daily')}</option>
          <option value="weekly">{t('routines.weekly')}</option>
        </select>
        {cronType === "weekly" && (
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        )}
        <input type="time" value={localTime} onChange={(e) => setLocalTime(e.target.value)} />
        <button type="button" className="btn-primary" disabled={busy || !targetId} onClick={() => void create()}>
          {t('routines.add')}
        </button>
      </div>
      {schedules.length === 0 ? (
        <p className="page-sub">{t('routines.empty')}</p>
      ) : (
        <ul className="dash-list">
          {schedules.map((s) => (
            <li key={s.id} className="dash-list-item">
              <div>
                <strong>{s.text}</strong>
                <span className="page-sub">
                  {" "}
                  · {s.cronType}
                  {s.cronType === "weekly" && s.weekday != null ? ` ${WEEKDAYS[s.weekday]}` : ""} @{" "}
                  {utcHHMMToLocal(s.timeUtc)} · {labelTarget(s)}
                </span>
              </div>
              <div className="routines-actions">
                <label className="dash-toggle compact">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => void toggle(s.id, e.target.checked)}
                  />
                  <span>{t('routines.on')}</span>
                </label>
                <button type="button" className="btn-text" onClick={() => void remove(s.id)}>
                  {t('routines.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
import { useCallback, useEffect, useState } from "react";
import type { NetworkDeviceNode } from "../types";
import { useI18n } from "../i18n";

const API_URL = import.meta.env.VITE_API_URL || "";

interface LibraryOption {
  id: string;
  filename: string;
}

interface WaterSettings {
  enabled: boolean;
  intervalMinutes: number;
  reminderMode: "poke" | "gif" | "both";
  pokeText: string;
  libraryId: string | null;
  targetDeviceId: string | null;
  dailyGoalMl: number;
  glassMl: number;
  lastDrinkAt: string | null;
}

interface WaterStatus {
  settings: WaterSettings;
  todayMl: number;
  todayGlasses: number;
  minutesSinceLastDrink: number | null;
  overdue: boolean;
  nextRemindInMinutes: number | null;
  logs?: Array<{ id: string; amountMl: number; createdAt: string }>;
}

export default function WaterPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<WaterStatus | null>(null);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);
  const [library, setLibrary] = useState<LibraryOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pouring, setPouring] = useState(false);

  const refresh = useCallback(() => {
    fetch(`${API_URL}/api/me/water`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStatus(d);
      })
      .catch(() => {});
    fetch(`${API_URL}/api/me/devices`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d) => setDevices(d.devices || []))
      .catch(() => setDevices([]));
    fetch(`${API_URL}/api/library?sort=newest`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setLibrary(list.slice(0, 40).map((x: { id: string; filename: string }) => ({ id: x.id, filename: x.filename })));
      })
      .catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const drink = async () => {
    setBusy(true);
    setError(null);
    setPouring(true);
    try {
      const res = await fetch(`${API_URL}/api/me/water/drink`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setStatus({ ...data.status, logs: status?.logs });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      window.setTimeout(() => setPouring(false), 700);
    }
  };

  const saveSettings = async (patch: Partial<WaterSettings> & { enabled?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/water/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setStatus((prev) => (prev ? { ...prev, ...data, settings: data.settings } : data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <section className="dash-section">
        <h2>{t('water.title')}</h2>
        <p className="page-sub">{t('water.loading')}</p>
      </section>
    );
  }

  const s = status.settings;
  const pct = Math.min(100, Math.round((status.todayMl / Math.max(1, s.dailyGoalMl)) * 100));
  const goalGlasses = Math.max(1, Math.ceil(s.dailyGoalMl / Math.max(1, s.glassMl)));
  const filledGlasses = Math.min(goalGlasses, status.todayGlasses);
  const since =
    status.minutesSinceLastDrink == null
      ? t('water.noDrinks')
      : status.minutesSinceLastDrink < 60
        ? t('water.sinceMin', { m: status.minutesSinceLastDrink })
        : t('water.sinceHour', {
            h: Math.floor(status.minutesSinceLastDrink / 60),
            m: status.minutesSinceLastDrink % 60,
          });

  return (
    <section className={`dash-section water-panel${status.overdue ? " water-overdue" : ""}`}>
      <div className="dash-section-head">
        <h2>{t('water.title')}</h2>
        <button type="button" className="btn-secondary" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? t('water.hideSettings') : t('water.settings')}
        </button>
      </div>
      <p className="page-sub">
        {t('water.sub')}
      </p>
      {error && <div className="page-error">{error}</div>}

      <div className="water-visual">
        <div
          className={`water-glass${pouring ? " water-glass-pouring" : ""}${pct >= 100 ? " water-glass-full" : ""}`}
          role="img"
          aria-label={`${pct}% of daily water goal`}
        >
          <div className="water-glass-shine" aria-hidden />
          <div className="water-glass-body">
            <div className="water-fill" style={{ height: `${pct}%` }}>
              <div className="water-wave water-wave-a" aria-hidden />
              <div className="water-wave water-wave-b" aria-hidden />
            </div>
          </div>
          <div className="water-glass-rim" aria-hidden />
          <div className="water-glass-label">
            <strong>{pct}%</strong>
            <span>{status.todayMl} / {s.dailyGoalMl} ml</span>
          </div>
        </div>

        <div className="water-visual-meta">
          <div className="water-stat-main">
            <strong>{status.todayGlasses}</strong>
            <span className="page-sub">
              {status.todayGlasses === 1 ? t('water.glasses') : t('water.glasses_plural')}{' '}
              {t('water.today', { ml: s.glassMl })}
            </span>
          </div>

          <div className="water-drops" aria-hidden>
            {Array.from({ length: Math.min(goalGlasses, 12) }, (_, i) => (
              <span
                key={i}
                className={`water-drop${i < filledGlasses ? " filled" : ""}${status.overdue && i === filledGlasses ? " overdue" : ""}`}
              />
            ))}
            {goalGlasses > 12 && (
              <span className="water-drop-more">+{goalGlasses - 12}</span>
            )}
          </div>

          <p className={`page-sub${status.overdue ? " water-overdue-text" : ""}`}>
            {since}
            {s.enabled && status.nextRemindInMinutes != null && !status.overdue
              ? t('water.nextNudge', { m: status.nextRemindInMinutes })
              : ""}
            {status.overdue ? t('water.overdue') : ""}
          </p>
        </div>
      </div>

      <div className="btn-row">
        <button type="button" className="btn-primary water-drink-btn" disabled={busy} onClick={() => void drink()}>
          {t('water.drank', { ml: s.glassMl })}
        </button>
        <label className="dash-toggle compact">
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={busy}
            onChange={(e) => void saveSettings({ enabled: e.target.checked })}
          />
          <span>{t('water.reminders')}</span>
        </label>
      </div>

      {showSettings && (
        <div className="water-settings">
          <div className="dash-form-row routines-form">
            <label className="field-label">
              {t('water.interval')}
              <input
                type="number"
                min={15}
                max={720}
                value={s.intervalMinutes}
                onChange={(e) =>
                  setStatus({
                    ...status,
                    settings: { ...s, intervalMinutes: Number(e.target.value) || s.intervalMinutes },
                  })
                }
                onBlur={() => void saveSettings({ intervalMinutes: s.intervalMinutes })}
              />
            </label>
            <label className="field-label">
              {t('water.mode')}
              <select
                value={s.reminderMode}
                onChange={(e) => void saveSettings({ reminderMode: e.target.value as WaterSettings["reminderMode"] })}
              >
                <option value="poke">{t('water.pokeOnly')}</option>
                <option value="gif">{t('water.gifOnly')}</option>
                <option value="both">{t('water.pokeGif')}</option>
              </select>
            </label>
            <label className="field-label">
              {t('water.selectDevice')}
              <select
                value={s.targetDeviceId || ""}
                onChange={(e) => void saveSettings({ targetDeviceId: e.target.value || null })}
              >
                <option value="">{t('water.selectDevice')}</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dash-form-row routines-form">
            <label className="field-label">
              {t('water.pokeText')}
              <input
                maxLength={25}
                value={s.pokeText}
                onChange={(e) =>
                  setStatus({ ...status, settings: { ...s, pokeText: e.target.value } })
                }
                onBlur={() => void saveSettings({ pokeText: s.pokeText })}
              />
            </label>
            <label className="field-label">
              {t('water.selectGif')}
              <select
                value={s.libraryId || ""}
                onChange={(e) => void saveSettings({ libraryId: e.target.value || null })}
              >
                <option value="">{t('water.none')}</option>
                {library.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.filename}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {t('water.glassMl')}
              <input
                type="number"
                min={50}
                max={1000}
                value={s.glassMl}
                onChange={(e) =>
                  setStatus({
                    ...status,
                    settings: { ...s, glassMl: Number(e.target.value) || s.glassMl },
                  })
                }
                onBlur={() => void saveSettings({ glassMl: s.glassMl })}
              />
            </label>
            <label className="field-label">
              {t('water.goalMl')}
              <input
                type="number"
                min={250}
                max={10000}
                value={s.dailyGoalMl}
                onChange={(e) =>
                  setStatus({
                    ...status,
                    settings: { ...s, dailyGoalMl: Number(e.target.value) || s.dailyGoalMl },
                  })
                }
                onBlur={() => void saveSettings({ dailyGoalMl: s.dailyGoalMl })}
              />
            </label>
          </div>
          <p className="page-sub">
            Enable reminders, pick your claimed device, and choose poke and/or a library QGIF. The cloud checks about
            once a minute.
          </p>
        </div>
      )}
    </section>
  );
}

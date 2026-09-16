import { useState, useRef, useEffect, FormEvent } from 'react';
import type { User } from '../types';
import type { Page } from '../App';

interface Props {
  user: User | null;
  apiUrl: string;
  page: Page;
  setPage: (page: Page) => void;
  onUserChange?: (user: User | null) => void;
}

interface AuthProviders {
  google: boolean;
  local: boolean;
  register?: boolean;
}

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

const TABS: { id: Page; label: string; hint: string; requiresAuth?: boolean }[] = [
  { id: 'dashboard', label: 'Home', hint: 'Dashboard: water, routines, devices', requiresAuth: true },
  { id: 'profile', label: 'Profile', hint: 'Activity, account & advanced', requiresAuth: true },
  { id: 'devices', label: 'Devices', hint: 'Claim and control your QBIT', requiresAuth: true },
  { id: 'network', label: 'Network', hint: 'See people & poke devices' },
  { id: 'groups', label: 'Groups', hint: 'Private friend circles', requiresAuth: true },
  { id: 'flash', label: 'Flash', hint: 'Install firmware on a new device' },
  { id: 'library', label: 'Library', hint: 'Browse and share OLED GIFs' },
];

export default function Navbar({ user, apiUrl, page, setPage, onUserChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [providers, setProviders] = useState<AuthProviders>({ google: true, local: false, register: false });
  const [localUser, setLocalUser] = useState('');
  const [localPass, setLocalPass] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, visible: false });

  useEffect(() => {
    fetch(`${apiUrl}/auth/providers`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p && typeof p.google === 'boolean' && typeof p.local === 'boolean') {
          setProviders({
            google: p.google,
            local: p.local,
            register: !!p.register,
          });
        }
      })
      .catch(() => {});
  }, [apiUrl]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    const updateIndicator = () => {
      const container = tabsRef.current;
      const visibleTabs = TABS.filter((tab) => !tab.requiresAuth || user);
      const activeIndex = Math.max(0, visibleTabs.findIndex((tab) => tab.id === page));
      const activeTab = tabRefs.current[activeIndex];
      if (!container || !activeTab) return;
      setIndicatorStyle({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
        visible: true,
      });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [page, user]);

  useEffect(() => {
    const container = tabsRef.current;
    const visibleTabs = TABS.filter((tab) => !tab.requiresAuth || user);
    const activeIndex = Math.max(0, visibleTabs.findIndex((tab) => tab.id === page));
    const activeTab = tabRefs.current[activeIndex];
    if (!container || !activeTab) return;
    requestAnimationFrame(() => {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }, [page, user]);

  const finishAuth = (data: User) => {
    onUserChange?.(data);
    setMenuOpen(false);
    setLocalPass('');
    setDisplayName('');
    setLocalError(null);
  };

  const handleLocalLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalBusy(true);
    try {
      const res = await fetch(`${apiUrl}/auth/local`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: localUser, password: localPass }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLocalError(typeof data.error === 'string' ? data.error : 'Login failed');
        return;
      }
      finishAuth(data as User);
    } catch {
      setLocalError('Network error');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalBusy(true);
    try {
      const res = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: localUser,
          password: localPass,
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLocalError(typeof data.error === 'string' ? data.error : 'Registration failed');
        return;
      }
      finishAuth(data as User);
    } catch {
      setLocalError('Network error');
    } finally {
      setLocalBusy(false);
    }
  };

  const noProviders = !providers.google && !providers.local;

  return (
    <nav className="navbar">
      <button
        type="button"
        className="navbar-brand"
        title="QBIT Home"
        onClick={() => setPage(user ? 'dashboard' : 'network')}
      >
        <span className="brand-q">Q</span>
        <span className="brand-bit">BIT</span>
      </button>

      <div className="nav-tabs-scroll">
        <div className="nav-tabs" ref={tabsRef}>
          <span
            className="nav-tab-indicator"
            aria-hidden
            style={{
              width: `${indicatorStyle.width}px`,
              transform: `translateX(${indicatorStyle.left}px)`,
              opacity: indicatorStyle.visible ? 1 : 0,
            }}
          />
          {TABS.filter((tab) => !tab.requiresAuth || user).map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              className={`nav-tab${page === tab.id ? ' active' : ''}`}
              title={tab.hint}
              onClick={() => setPage(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="navbar-user">
        {user ? (
          <>
            <button
              type="button"
              className="navbar-profile-btn"
              title="Open Profile"
              onClick={() => setPage('profile')}
            >
              {user.avatar && (
                <img
                  className="navbar-avatar"
                  src={user.avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              )}
              <span className="navbar-name">{user.displayName}</span>
            </button>
            <a className="btn btn-logout" href={`${apiUrl}/auth/logout`}>
              <svg className="logout-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="logout-text">Logout</span>
            </a>
          </>
        ) : (
          <div className="login-wrapper" ref={menuRef}>
            <button
              className="btn btn-login"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              Login
            </button>
            {menuOpen && (
              <div className="login-menu">
                {providers.google && (
                  <a className="login-menu-item" href={`${apiUrl}/auth/google`}>
                    <span className="login-menu-icon">{GOOGLE_ICON}</span>
                    <span>Google</span>
                  </a>
                )}
                {providers.local && (
                  <form
                    className="login-local-form"
                    onSubmit={authMode === 'register' ? handleRegister : handleLocalLogin}
                  >
                    {providers.register && (
                      <div className="login-mode-switch">
                        <button
                          type="button"
                          className={authMode === 'login' ? 'active' : ''}
                          onClick={() => {
                            setAuthMode('login');
                            setLocalError(null);
                          }}
                        >
                          Sign in
                        </button>
                        <button
                          type="button"
                          className={authMode === 'register' ? 'active' : ''}
                          onClick={() => {
                            setAuthMode('register');
                            setLocalError(null);
                          }}
                        >
                          Sign up
                        </button>
                      </div>
                    )}
                    <div className="login-local-title">
                      {authMode === 'register' ? 'Create account' : 'Local account'}
                    </div>
                    {authMode === 'register' && (
                      <input
                        className="login-local-input"
                        type="text"
                        autoComplete="nickname"
                        placeholder="Display name (optional)"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={64}
                      />
                    )}
                    <input
                      className="login-local-input"
                      type="text"
                      autoComplete="username"
                      placeholder="Username"
                      value={localUser}
                      onChange={(e) => setLocalUser(e.target.value)}
                      required
                      minLength={3}
                      maxLength={32}
                      pattern="[A-Za-z0-9_]+"
                      title="3–32 characters: letters, numbers, underscore"
                    />
                    <input
                      className="login-local-input"
                      type="password"
                      autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                      placeholder="Password"
                      value={localPass}
                      onChange={(e) => setLocalPass(e.target.value)}
                      required
                      minLength={8}
                    />
                    {localError && <div className="login-local-error">{localError}</div>}
                    <button className="login-local-submit" type="submit" disabled={localBusy}>
                      {localBusy
                        ? authMode === 'register'
                          ? 'Creating…'
                          : 'Signing in…'
                        : authMode === 'register'
                          ? 'Create account'
                          : 'Sign in'}
                    </button>
                  </form>
                )}
                {noProviders && (
                  <div className="login-menu-empty">
                    No login configured. Set Google OAuth or enable local registration.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data/standalone';
import type { NetworkUserNode, Device, OnlineUser } from '../types';
import { useI18n } from '../i18n';

const USER_PREFIX = 'user:';
const DEVICE_PREFIX = 'device:';

interface Props {
  users: NetworkUserNode[];
  currentUserId: string | null;
  pokeHighlight?: { deviceId?: string; publicUserId?: string; seq: number } | null;
  onPokeHighlightEnd?: () => void;
  onSelectDevice: (device: Device) => void;
  onSelectUser: (user: OnlineUser) => void;
  /** publicUserId -> last activity summary for tooltips */
  activityByUser?: Record<string, string>;
}

const GLOW_COLOR_DEVICE = '#e53935';
const GLOW_COLOR_USER = '#1976d2';
const GLOW_RAMP_MS = 120;
const GLOW_FADE_MS = 1000;
const GLOW_MAX_COMBO = 5;
const GLOW_SIZE_BASE = 26;
const GLOW_SIZE_PER_COMBO = 8;
const GLOW_ALPHA_BASE = 0.7;
const GLOW_ALPHA_PER_COMBO = 0.08;

function toDevice(u: NetworkUserNode, d: NetworkUserNode['devices'][0]): Device {
  return {
    id: d.deviceId,
    name: d.name,
    ip: '',
    version: d.version || '',
    connectedAt: d.connectedAt || new Date().toISOString(),
    pokeToken: d.pokeToken || '',
    claimedBy: {
      publicUserId: u.publicUserId,
      userName: u.displayName,
      userAvatar: u.avatar,
    },
  };
}

function toOnlineUser(u: NetworkUserNode): OnlineUser {
  return {
    publicUserId: u.publicUserId,
    displayName: u.displayName,
    avatar: u.avatar,
    connectedAt: new Date().toISOString(),
    socketIds: u.online ? ['1'] : [],
  };
}

export default function SocialNetworkGraph({
  users,
  currentUserId,
  pokeHighlight = null,
  onPokeHighlightEnd,
  onSelectDevice,
  onSelectUser,
  activityByUser = {},
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef(new DataSet<Record<string, unknown>>());
  const edgesRef = useRef(new DataSet<Record<string, unknown>>());
  const [labelsVisible, setLabelsVisible] = useState(true);
  const labelsVisibleRef = useRef(true);
  const usersRef = useRef(users);
  const onSelectDeviceRef = useRef(onSelectDevice);
  const onSelectUserRef = useRef(onSelectUser);
  const currentUserIdRef = useRef(currentUserId);
  const activityByUserRef = useRef(activityByUser);

  const physicsBusyRef = useRef(false);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);
  useEffect(() => {
    onSelectDeviceRef.current = onSelectDevice;
  }, [onSelectDevice]);
  useEffect(() => {
    onSelectUserRef.current = onSelectUser;
  }, [onSelectUser]);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);
  useEffect(() => {
    activityByUserRef.current = activityByUser;
  }, [activityByUser]);

  const freezePhysics = useCallback(() => {
    const net = networkRef.current;
    if (!net) return;
    net.setOptions({ physics: { enabled: false } });
    physicsBusyRef.current = false;
  }, []);

  const settlePhysics = useCallback(() => {
    const net = networkRef.current;
    if (!net || physicsBusyRef.current) return;
    physicsBusyRef.current = true;
    net.setOptions({
      physics: {
        enabled: true,
        barnesHut: {
          gravitationalConstant: -2200,
          centralGravity: 0.08,
          springLength: 140,
          springConstant: 0.03,
          damping: 0.55,
          avoidOverlap: 0.2,
        },
        stabilization: { enabled: true, iterations: 100, fit: false },
      },
    });
    net.stabilize(100);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    networkRef.current = new Network(
      containerRef.current,
      { nodes: nodesRef.current, edges: edgesRef.current },
      {
        nodes: {
          shape: 'dot',
          size: 22,
          font: { color: '#ffffff', size: 13, face: 'Manrope, sans-serif', multi: 'html' },
          borderWidth: 2,
        },
        edges: {
          width: 1.5,
          color: { color: '#444', highlight: '#888' },
          smooth: { enabled: true, type: 'continuous', roundness: 0.35 },
        },
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -2200,
            centralGravity: 0.08,
            springLength: 140,
            springConstant: 0.03,
            damping: 0.55,
            avoidOverlap: 0.2,
          },
          stabilization: { enabled: true, iterations: 120, fit: true },
        },
        interaction: {
          hover: true,
          tooltipDelay: 120,
          zoomView: true,
          dragView: true,
          dragNodes: true,
        },
      }
    );

    networkRef.current.on('stabilizationIterationsDone', () => {
      freezePhysics();
    });
    networkRef.current.on('stabilized', () => {
      freezePhysics();
    });
    // User drag: keep physics off so nodes don't rebound into a dance
    networkRef.current.on('dragEnd', () => {
      freezePhysics();
    });

    networkRef.current.on('click', (params) => {
      if (!params.nodes.length) return;
      const id = String(params.nodes[0]);
      if (id.startsWith(USER_PREFIX)) {
        const publicUserId = id.slice(USER_PREFIX.length);
        if (publicUserId === currentUserIdRef.current) return;
        const u = usersRef.current.find((x) => x.publicUserId === publicUserId);
        if (u) onSelectUserRef.current(toOnlineUser(u));
        return;
      }
      if (id.startsWith(DEVICE_PREFIX)) {
        const deviceId = id.slice(DEVICE_PREFIX.length);
        for (const u of usersRef.current) {
          const d = u.devices.find((x) => x.deviceId === deviceId);
          if (d && d.pokeToken) {
            onSelectDeviceRef.current(toDevice(u, d));
            return;
          }
        }
      }
    });

    return () => {
      networkRef.current?.destroy();
      networkRef.current = null;
      nodesRef.current.clear();
      edgesRef.current.clear();
    };
  }, [freezePhysics]);

  const syncGraph = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const showLabel = labelsVisibleRef.current;
    const wantNodes = new Set<string>();
    const wantEdges = new Set<string>();
    let structureChanged = false;

    for (const u of usersRef.current) {
      const uid = USER_PREFIX + u.publicUserId;
      wantNodes.add(uid);
      const lastAct = activityByUserRef.current[u.publicUserId];
      const userNode = {
        id: uid,
        label: showLabel ? `${u.displayName}${u.online ? ' ●' : ''}` : u.online ? '●' : '',
        shape: u.avatar ? 'circularImage' : 'dot',
        image: u.avatar || undefined,
        size: u.online ? 32 : 26,
        borderWidth: u.online ? 3 : 2,
        color: {
          border: u.online ? '#4fc3f7' : '#555',
          background: u.online ? '#01579b' : '#2a2a2a',
          highlight: { border: '#81d4fa', background: '#0277bd' },
        },
        font: { color: '#fff', size: 13 },
        title: `${u.displayName}${u.isGlobal ? ' · global' : ''}${u.online ? ' · online' : ' · offline'}${
          lastAct ? `\n${lastAct}` : ''
        }`,
      };
      const prev = nodes.get(uid) as Record<string, unknown> | null;
      if (!prev) {
        nodes.add(userNode);
        structureChanged = true;
      } else if (
        prev.label !== userNode.label ||
        prev.size !== userNode.size ||
        prev.borderWidth !== userNode.borderWidth ||
        prev.shape !== userNode.shape ||
        prev.image !== userNode.image ||
        prev.title !== userNode.title ||
        JSON.stringify(prev.color) !== JSON.stringify(userNode.color)
      ) {
        // Cosmetic / status update only — keep current x/y so layout does not jump
        nodes.update(userNode);
      }

      for (const d of u.devices) {
        const did = DEVICE_PREFIX + d.deviceId;
        wantNodes.add(did);
        const eid = `${uid}->${did}`;
        wantEdges.add(eid);
        const deviceNode = {
          id: did,
          label: showLabel ? d.name : '',
          shape: 'dot',
          size: 16,
          color: {
            border: d.online ? '#e53935' : '#555',
            background: d.online ? '#b71c1c' : '#333',
            highlight: { border: '#ff4d4d', background: '#c62828' },
          },
          font: { color: '#fff', size: 11 },
          title: `${d.name}${d.online ? ' · online' : ' · offline'}`,
        };
        const prevDev = nodes.get(did) as Record<string, unknown> | null;
        if (!prevDev) {
          nodes.add(deviceNode);
          structureChanged = true;
        } else if (
          prevDev.label !== deviceNode.label ||
          prevDev.title !== deviceNode.title ||
          JSON.stringify(prevDev.color) !== JSON.stringify(deviceNode.color)
        ) {
          nodes.update(deviceNode);
        }

        const edge = {
          id: eid,
          from: uid,
          to: did,
          length: 90,
          color: { color: '#555' },
        };
        if (!edges.get(eid)) {
          edges.add(edge);
          structureChanged = true;
        }
      }
    }

    for (const n of nodes.getIds()) {
      if (!wantNodes.has(String(n))) {
        nodes.remove(n);
        structureChanged = true;
      }
    }
    for (const e of edges.getIds()) {
      if (!wantEdges.has(String(e))) {
        edges.remove(e);
        structureChanged = true;
      }
    }

    if (structureChanged) settlePhysics();
  }, [settlePhysics]);

  useEffect(() => {
    usersRef.current = users;
    syncGraph();
  }, [users, syncGraph, activityByUser]);

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
    syncGraph();
  }, [labelsVisible, syncGraph]);

  // Poke highlight glow — shadow/border only (never clear size; that made nodes vanish in vis-network)
  useEffect(() => {
    if (!pokeHighlight || !networkRef.current) return;
    const nodeId = pokeHighlight.publicUserId
      ? USER_PREFIX + pokeHighlight.publicUserId
      : pokeHighlight.deviceId
        ? DEVICE_PREFIX + pokeHighlight.deviceId
        : null;
    const existing = nodeId ? (nodesRef.current.get(nodeId) as { size?: number; borderWidth?: number } | null) : null;
    if (!nodeId || !existing) {
      onPokeHighlightEnd?.();
      return;
    }
    const baseSize = typeof existing.size === 'number' ? existing.size : pokeHighlight.publicUserId ? 28 : 16;
    const baseBorder = typeof existing.borderWidth === 'number' ? existing.borderWidth : 2;
    const combo = Math.min(pokeHighlight.seq, GLOW_MAX_COMBO);
    const color = pokeHighlight.publicUserId ? GLOW_COLOR_USER : GLOW_COLOR_DEVICE;
    const peakShadow = GLOW_SIZE_BASE + combo * GLOW_SIZE_PER_COMBO;
    const peakAlpha = Math.min(1, GLOW_ALPHA_BASE + combo * GLOW_ALPHA_PER_COMBO);
    const start = performance.now();
    let raf = 0;
    let finished = false;

    const restore = () => {
      if (!nodesRef.current.get(nodeId)) return;
      nodesRef.current.update({
        id: nodeId,
        size: baseSize,
        borderWidth: baseBorder,
        shadow: { enabled: false, size: 0, x: 0, y: 0 },
      });
    };

    const tick = (now: number) => {
      if (finished) return;
      if (!nodesRef.current.get(nodeId)) {
        finished = true;
        onPokeHighlightEnd?.();
        return;
      }
      const t = now - start;
      let a = peakAlpha;
      let shadowSize = peakShadow;
      if (t < GLOW_RAMP_MS) {
        const k = t / GLOW_RAMP_MS;
        a = peakAlpha * k;
        shadowSize = peakShadow * k;
      } else if (t < GLOW_RAMP_MS + GLOW_FADE_MS) {
        const k = 1 - (t - GLOW_RAMP_MS) / GLOW_FADE_MS;
        a = peakAlpha * k;
        shadowSize = peakShadow * k;
      } else {
        finished = true;
        restore();
        onPokeHighlightEnd?.();
        return;
      }
      nodesRef.current.update({
        id: nodeId,
        size: baseSize,
        borderWidth: baseBorder + a * 3,
        shadow: {
          enabled: true,
          color,
          size: shadowSize,
          x: 0,
          y: 0,
        },
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (!finished) restore();
    };
  }, [pokeHighlight, onPokeHighlightEnd]);

  return (
    <div className="network-graph-container" style={{ width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="network-fabs">
        <button
          type="button"
          className="network-fab"
          title={t('graph.fit')}
          onClick={() => networkRef.current?.fit({ animation: true })}
        >
          ⤢
        </button>
        <button
          type="button"
          className="network-fab"
          title={t('graph.toggleLabels')}
          onClick={() => setLabelsVisible((v) => !v)}
        >
          {labelsVisible ? 'Aa' : '··'}
        </button>
      </div>
    </div>
  );
}

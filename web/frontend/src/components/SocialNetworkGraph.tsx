import { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data/standalone';
import type { NetworkUserNode, Device, OnlineUser } from '../types';

const USER_PREFIX = 'user:';
const DEVICE_PREFIX = 'device:';

interface Props {
  users: NetworkUserNode[];
  currentUserId: string | null;
  pokeHighlight?: { deviceId?: string; publicUserId?: string; seq: number } | null;
  onPokeHighlightEnd?: () => void;
  onSelectDevice: (device: Device) => void;
  onSelectUser: (user: OnlineUser) => void;
}

const GLOW_COLOR_DEVICE = '#d32f2f';
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
}: Props) {
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
    if (!containerRef.current) return;

    networkRef.current = new Network(
      containerRef.current,
      { nodes: nodesRef.current, edges: edgesRef.current },
      {
        nodes: {
          shape: 'dot',
          size: 22,
          font: { color: '#ffffff', size: 13, face: 'Inter, sans-serif', multi: 'html' },
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
            gravitationalConstant: -2800,
            centralGravity: 0.15,
            springLength: 120,
            springConstant: 0.04,
          },
          stabilization: { iterations: 80 },
        },
        interaction: {
          hover: true,
          tooltipDelay: 120,
          zoomView: true,
          dragView: true,
        },
      }
    );

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
  }, []);

  const syncGraph = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const showLabel = labelsVisibleRef.current;
    const wantNodes = new Set<string>();
    const wantEdges = new Set<string>();

    for (const u of usersRef.current) {
      const uid = USER_PREFIX + u.publicUserId;
      wantNodes.add(uid);
      const userNode = {
        id: uid,
        label: showLabel ? u.displayName : '',
        shape: u.avatar ? 'circularImage' : 'dot',
        image: u.avatar || undefined,
        size: 28,
        color: {
          border: u.online ? '#1976d2' : '#555',
          background: u.online ? '#0d47a1' : '#2a2a2a',
          highlight: { border: '#42a5f5', background: '#1565c0' },
        },
        font: { color: '#fff', size: 13 },
        title: `${u.displayName}${u.isGlobal ? ' · global' : ''}${u.online ? ' · online' : ''}`,
      };
      if (nodes.get(uid)) nodes.update(userNode);
      else nodes.add(userNode);

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
            border: d.online ? '#d32f2f' : '#555',
            background: d.online ? '#b71c1c' : '#333',
            highlight: { border: '#ff4d4d', background: '#c62828' },
          },
          font: { color: '#fff', size: 11 },
          title: `${d.name}${d.online ? ' · online' : ' · offline'}`,
        };
        if (nodes.get(did)) nodes.update(deviceNode);
        else nodes.add(deviceNode);

        const edge = {
          id: eid,
          from: uid,
          to: did,
          length: 90,
          color: { color: '#555' },
        };
        if (edges.get(eid)) edges.update(edge);
        else edges.add(edge);
      }
    }

    for (const n of nodes.getIds()) {
      if (!wantNodes.has(String(n))) nodes.remove(n);
    }
    for (const e of edges.getIds()) {
      if (!wantEdges.has(String(e))) edges.remove(e);
    }
  }, []);

  useEffect(() => {
    usersRef.current = users;
    syncGraph();
  }, [users, syncGraph]);

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
    syncGraph();
  }, [labelsVisible, syncGraph]);

  // Poke highlight glow (same idea as NetworkGraph)
  useEffect(() => {
    if (!pokeHighlight || !networkRef.current) return;
    const nodeId = pokeHighlight.publicUserId
      ? USER_PREFIX + pokeHighlight.publicUserId
      : pokeHighlight.deviceId
        ? DEVICE_PREFIX + pokeHighlight.deviceId
        : null;
    if (!nodeId || !nodesRef.current.get(nodeId)) {
      onPokeHighlightEnd?.();
      return;
    }
    const combo = Math.min(pokeHighlight.seq, GLOW_MAX_COMBO);
    const color = pokeHighlight.publicUserId ? GLOW_COLOR_USER : GLOW_COLOR_DEVICE;
    const size = GLOW_SIZE_BASE + combo * GLOW_SIZE_PER_COMBO;
    const alpha = Math.min(1, GLOW_ALPHA_BASE + combo * GLOW_ALPHA_PER_COMBO);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      let a = alpha;
      if (t < GLOW_RAMP_MS) a = alpha * (t / GLOW_RAMP_MS);
      else if (t < GLOW_RAMP_MS + GLOW_FADE_MS) {
        a = alpha * (1 - (t - GLOW_RAMP_MS) / GLOW_FADE_MS);
      } else {
        nodesRef.current.update({ id: nodeId, shadow: false, size: undefined });
        onPokeHighlightEnd?.();
        return;
      }
      nodesRef.current.update({
        id: nodeId,
        size,
        shadow: {
          enabled: true,
          color: color,
          size: 20 + combo * 4,
          x: 0,
          y: 0,
        },
        borderWidth: 2 + a * 4,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pokeHighlight, onPokeHighlightEnd]);

  return (
    <div className="network-graph-container" style={{ width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="network-fabs">
        <button
          type="button"
          className="network-fab"
          title="Fit"
          onClick={() => networkRef.current?.fit({ animation: true })}
        >
          ⤢
        </button>
        <button
          type="button"
          className="network-fab"
          title="Toggle labels"
          onClick={() => setLabelsVisible((v) => !v)}
        >
          {labelsVisible ? 'Aa' : '··'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphModel, GraphNode, NodeKind } from '@/lib/graph';

// ---------------------------------------------------------------------------
// Force-directed graph on a plain canvas.
//
// Hand-rolled rather than pulled from a charting library: the simulation is
// ~60 lines, it keeps the bundle free of a 3D renderer, and node semantics
// (person / company / school) drive layout directly — companies and schools
// are heavier and drift to the centre, which is what makes clusters legible.
// ---------------------------------------------------------------------------

const COLORS: Record<NodeKind, string> = {
  self: '#e07ee0',
  person: '#5b9dff',
  company: '#f5a05b',
  school: '#7ee0a8',
};

const EDGE_COLORS: Record<string, string> = {
  'works-at': 'rgba(245,160,91,0.35)',
  'worked-at': 'rgba(245,160,91,0.13)',
  'studied-at': 'rgba(126,224,168,0.28)',
  connected: 'rgba(91,157,255,0.07)',
};

interface Sim {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heavier nodes move less — hubs stay put and people orbit them. */
  mass: number;
  radius: number;
  node: GraphNode;
}

interface Props {
  model: GraphModel;
  onSelect?: (node: GraphNode | null) => void;
  selectedId?: string | null;
  /** Node ids to highlight; everything else dims. */
  highlight?: Set<string> | null;
}

export function GraphCanvas({ model, onSelect, selectedId, highlight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<{ nodes: Sim[]; byId: Map<string, Sim> }>({
    nodes: [],
    byId: new Map(),
  });
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ kind: 'pan' | 'node'; id?: string; lastX: number; lastY: number } | null>(
    null,
  );
  const hoverRef = useRef<string | null>(null);
  const frameRef = useRef(0);
  const alphaRef = useRef(1);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverLabel, setHoverLabel] = useState<GraphNode | null>(null);

  // Rebuild the simulation whenever the model changes. Existing node positions
  // are carried over so tweaking a filter does not reshuffle the whole layout.
  useEffect(() => {
    const previous = simRef.current.byId;
    const nodes: Sim[] = model.nodes.map((node, i) => {
      const old = previous.get(node.id);
      const angle = (i / Math.max(model.nodes.length, 1)) * Math.PI * 2;
      const ring = node.kind === 'person' ? 260 : 90;
      const mass =
        node.kind === 'self' ? 40 : node.kind === 'person' ? 1 : 3 + Math.min(node.weight, 40) * 0.6;
      const radius =
        node.kind === 'self'
          ? 9
          : node.kind === 'person'
            ? 3 + Math.min(node.weight, 8) * 0.5
            : 4 + Math.min(Math.sqrt(node.weight) * 2.2, 14);
      return {
        id: node.id,
        x: old?.x ?? Math.cos(angle) * ring + (Math.random() - 0.5) * 40,
        y: old?.y ?? Math.sin(angle) * ring + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        mass,
        radius,
        node,
      };
    });
    simRef.current = { nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
    alphaRef.current = 1;
  }, [model]);

  // Track container size for a crisp, responsive canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(320, height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const edges = useMemo(() => model.edges, [model]);

  // --- simulation + render loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;

    const step = () => {
      const { nodes, byId } = simRef.current;
      const alpha = alphaRef.current;

      if (alpha > 0.005) {
        // Repulsion. O(n²) but capped node counts keep this comfortable, and it
        // avoids a quadtree implementation for what is a few hundred nodes.
        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 === 0) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = 0.01;
            }
            if (d2 > 90000) continue; // ignore distant pairs
            const d = Math.sqrt(d2);
            const force = (900 * alpha) / d2;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            a.vx -= fx / a.mass;
            a.vy -= fy / a.mass;
            b.vx += fx / b.mass;
            b.vy += fy / b.mass;
          }
        }

        // Springs along edges.
        for (const edge of edges) {
          const a = byId.get(edge.source);
          const b = byId.get(edge.target);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const target = edge.kind === 'connected' ? 220 : 70;
          const stiffness = edge.kind === 'connected' ? 0.002 : 0.02;
          const force = (d - target) * stiffness * alpha;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx / a.mass;
          a.vy += fy / a.mass;
          b.vx -= fx / b.mass;
          b.vy -= fy / b.mass;
        }

        // Gravity toward origin, then integrate with damping.
        for (const n of nodes) {
          n.vx -= n.x * 0.0016 * alpha;
          n.vy -= n.y * 0.0016 * alpha;
          n.vx *= 0.85;
          n.vy *= 0.85;
          const held = dragRef.current?.kind === 'node' && dragRef.current.id === n.id;
          if (!held) {
            n.x += n.vx;
            n.y += n.vy;
          }
        }
        alphaRef.current = alpha * 0.994;
      }

      // --- draw ---
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const view = viewRef.current;
      ctx.translate(size.w / 2 + view.x, size.h / 2 + view.y);
      ctx.scale(view.scale, view.scale);

      const dim = (id: string) => (highlight ? !highlight.has(id) : false);

      ctx.lineWidth = 1 / view.scale;
      for (const edge of edges) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) continue;
        const faded = dim(a.id) && dim(b.id);
        ctx.strokeStyle = faded
          ? 'rgba(120,130,150,0.04)'
          : EDGE_COLORS[edge.kind] ?? 'rgba(150,150,150,0.15)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const n of nodes) {
        const faded = dim(n.id);
        const selected = selectedId === n.id;
        const hovered = hoverRef.current === n.id;
        ctx.globalAlpha = faded ? 0.18 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[n.node.kind];
        ctx.fill();
        if (selected || hovered) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / view.scale;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels only where they will not turn into mush: hubs, selection, hover.
      ctx.font = `${11 / view.scale}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const n of nodes) {
        const isHub = n.node.kind !== 'person' && n.node.weight >= 3;
        const show =
          selectedId === n.id ||
          hoverRef.current === n.id ||
          n.node.kind === 'self' ||
          (isHub && view.scale > 0.55) ||
          (view.scale > 1.7 && !dim(n.id));
        if (!show) continue;
        ctx.globalAlpha = dim(n.id) ? 0.25 : 1;
        ctx.fillStyle = n.node.kind === 'person' ? '#cbd5e1' : COLORS[n.node.kind];
        ctx.fillText(n.node.label, n.x, n.y - n.radius - 2 / view.scale);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [edges, size, selectedId, highlight]);

  // --- pointer interaction ---

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return {
        x: (clientX - rect.left - size.w / 2 - view.x) / view.scale,
        y: (clientY - rect.top - size.h / 2 - view.y) / view.scale,
      };
    },
    [size],
  );

  const nodeAt = useCallback((wx: number, wy: number): Sim | null => {
    const { nodes } = simRef.current;
    // Iterate backwards so the last-drawn (topmost) node wins.
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i];
      const dx = wx - n.x;
      const dy = wy - n.y;
      const hit = n.radius + 4;
      if (dx * dx + dy * dy <= hit * hit) return n;
    }
    return null;
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="block cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          const { x, y } = toWorld(e.clientX, e.clientY);
          const hit = nodeAt(x, y);
          if (hit) {
            dragRef.current = { kind: 'node', id: hit.id, lastX: e.clientX, lastY: e.clientY };
            onSelect?.(hit.node);
            // Nudge the simulation so the graph re-settles around the move.
            alphaRef.current = Math.max(alphaRef.current, 0.35);
          } else {
            dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
            onSelect?.(null);
          }
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          const world = toWorld(e.clientX, e.clientY);
          if (!drag) {
            const hit = nodeAt(world.x, world.y);
            hoverRef.current = hit?.id ?? null;
            setHoverLabel(hit?.node ?? null);
            return;
          }
          const dx = e.clientX - drag.lastX;
          const dy = e.clientY - drag.lastY;
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          if (drag.kind === 'pan') {
            viewRef.current.x += dx;
            viewRef.current.y += dy;
          } else if (drag.id) {
            const node = simRef.current.byId.get(drag.id);
            if (node) {
              node.x = world.x;
              node.y = world.y;
              node.vx = 0;
              node.vy = 0;
            }
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          hoverRef.current = null;
          setHoverLabel(null);
        }}
        onWheel={(e) => {
          e.preventDefault();
          const view = viewRef.current;
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          const next = Math.min(6, Math.max(0.15, view.scale * factor));
          // Zoom about the cursor rather than the canvas centre.
          const rect = canvasRef.current!.getBoundingClientRect();
          const cx = e.clientX - rect.left - size.w / 2;
          const cy = e.clientY - rect.top - size.h / 2;
          view.x = cx - ((cx - view.x) * next) / view.scale;
          view.y = cy - ((cy - view.y) * next) / view.scale;
          view.scale = next;
        }}
      />

      {hoverLabel ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-ink-600 bg-ink-900/95 px-2 py-1 text-xs text-slate-200">
          <span className="font-mono text-[10px] uppercase text-slate-500">
            {hoverLabel.kind}
          </span>{' '}
          {hoverLabel.label}
        </div>
      ) : null}

      <div className="pointer-events-none absolute right-2 top-2 rounded border border-ink-700 bg-ink-900/90 px-2 py-1.5 text-[10px] text-slate-400">
        <div className="mb-1 font-mono uppercase tracking-wider text-slate-500">legend</div>
        {(
          [
            ['self', 'you'],
            ['person', 'person'],
            ['company', 'company'],
            ['school', 'school'],
          ] as [NodeKind, string][]
        ).map(([kind, label]) => (
          <div key={kind} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: COLORS[kind] }}
            />
            {label}
          </div>
        ))}
        <div className="mt-1.5 border-t border-ink-700 pt-1 text-slate-600">
          drag to pan · scroll to zoom
        </div>
      </div>
    </div>
  );
}

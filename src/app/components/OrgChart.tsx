'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { hierarchy, tree, HierarchyPointNode } from 'd3-hierarchy';
import { FamilyTreeNode } from '@/lib/types';
import { Avatar } from './Avatar';
import { displayName, maidenName } from '@/lib/names';
import { branchStyle, branchBucket } from '@/lib/branches';
import { useUserPrefs } from './UserPrefsContext';
import { useBranchHighlight } from './FamilyTreeContext';
import { EditPersonModal } from './EditPersonModal';
import { Modal } from './Modal';
import { useTreeZoom } from './useTreeZoom';

// ── Geometry ────────────────────────────────────────────────────────────────
const CARD_W = 196;
const CARD_H = 66;
const COUPLE_GAP = 14;          // gap between a person and their spouse card
const COUPLE_HALF = (CARD_W + COUPLE_GAP) / 2;
const H_SLOT = CARD_W + 52;     // d3 horizontal node size
const ROW_H = CARD_H + 84;      // d3 vertical node size (card + connector room)
const PAD = 60;                 // canvas padding around the laid-out tree

type PNode = HierarchyPointNode<FamilyTreeNode>;

// A virtual super-root lets d3 lay out a forest of family roots in one space.
const VIRTUAL_ROOT: FamilyTreeNode = {
  id: -1, name: '', nickname: null, family_branch: null, photo_url: null, children: [],
};

/** Build an orthogonal connector path with rounded corners. */
function roundedElbow(points: [number, number][], r = 12): string {
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const inLen = Math.hypot(x1 - x0, y1 - y0) || 1;
    const outLen = Math.hypot(x2 - x1, y2 - y1) || 1;
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const ix = x1 - ((x1 - x0) / inLen) * rr;
    const iy = y1 - ((y1 - y0) / inLen) * rr;
    const ox = x1 + ((x2 - x1) / outLen) * rr;
    const oy = y1 + ((y2 - y1) / outLen) * rr;
    d += ` L ${ix} ${iy} Q ${x1} ${y1} ${ox} ${oy}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

// A couple row = the person plus every spouse (remarriage → 3+ cards). They're
// laid out centered on the hierarchy node's x, one COUPLE step apart.
const COUPLE_STEP = COUPLE_HALF * 2;
const coupleMembers = (n: PNode): FamilyTreeNode[] => [n.data, ...(n.data.spouses ?? [])];
const coupleCount = (n: PNode) => coupleMembers(n).length;
/** x-centre of the i-th card in the couple row (0 = the person). */
const memberCx = (n: PNode, i: number) => n.x + (i - (coupleCount(n) - 1) / 2) * COUPLE_STEP;
const primaryCx = (n: PNode) => memberCx(n, 0);

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({
  person, cx, top, dimmed, faded, onClick, secondary,
}: {
  person: FamilyTreeNode;
  cx: number;
  top: number;
  dimmed: boolean;
  faded: boolean;
  onClick: () => void;
  secondary?: boolean;
}) {
  const { showNicknames, language, branches } = useUserPrefs();
  // Accent bar by the branch's POSITION in the configured list; an unset,
  // catch-all or unrecognised branch gets the neutral accent.
  const accent = branchStyle(branches, person.family_branch).accent;
  const rawName = person.name.replace(/~[^~]+$/, '').replace(/\\/g, '');
  const name = displayName(person, language, showNicknames);
  const maiden = maidenName(person, language);
  const year = person.birthday?.gregorian_year;
  // Second line = genuinely EXTRA info only, so it reads the same for everyone:
  //  · "née <maiden>" when the person married in (their birth family — useful), else
  //  · "b. <year>" when the birth year is known, else nothing.
  // We deliberately do NOT fall back to the branch surname here — the surname is
  // already in the name on line 1 (and the colour bar shows the branch), so
  // repeating it just duplicated the last name (and could even mismatch its
  // spelling). That redundancy is what made cards look inconsistent.
  // A Latin maiden name inside a Hebrew (RTL) prefix is wrapped in <bdi> so the
  // parentheses/word order don't visually flip.
  const subNoMaiden = year ? `b. ${year}` : '';

  return (
    <button
      type="button"
      onClick={onClick}
      dir="auto"
      className={`absolute flex items-center gap-2.5 rounded-lg border border-warm-border bg-parchment-card text-left
        overflow-hidden transition-[box-shadow,opacity,filter] shadow-sm hover:shadow-md hover:border-ink/30
        ${dimmed ? 'opacity-25 saturate-0' : faded ? 'opacity-40' : 'opacity-100'}`}
      style={{ left: cx - CARD_W / 2, top, width: CARD_W, height: CARD_H, paddingInlineStart: 14, paddingInlineEnd: 12 }}
    >
      <span className="absolute inset-y-0 start-0 w-1" style={{ background: accent }} aria-hidden />
      <Avatar name={rawName} photoUrl={person.photo_url} branch={person.family_branch} size={secondary ? 'sm' : 'md'} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink leading-tight line-clamp-2"><bdi>{name}</bdi></span>
        {maiden ? (
          <span className="block truncate text-xs text-ink-muted italic">
            {language === 'he' ? 'לבית ' : 'née '}<bdi>{maiden}</bdi>
          </span>
        ) : subNoMaiden ? (
          <span className="block truncate text-xs text-ink-muted">{subNoMaiden}</span>
        ) : null}
      </span>
    </button>
  );
}

// ── Detail / edit popup ───────────────────────────────────────────────────────
function NodeDetail({ node, onClose }: { node: FamilyTreeNode; onClose: () => void }) {
  const { showNicknames, language, canEdit, t, spell } = useUserPrefs();
  const [editing, setEditing] = useState(false);
  const rawName = node.name.replace(/~[^~]+$/, '').replace(/\\/g, '');
  const name = displayName(node, language, showNicknames);

  const maiden = maidenName(node, language);

  if (editing) {
    return (
      <EditPersonModal
        person={{
          id: node.id, name: node.name, last_name: node.last_name ?? null, name_he: node.name_he ?? null,
          nickname: node.nickname ?? null,
          maiden_name: node.maiden_name ?? null,
          family_branch: node.family_branch ?? null, photo_url: node.photo_url ?? null,
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      onClose={onClose}
      maxWidth="max-w-xs"
      title={
        <span className="flex items-center gap-3">
          <Avatar name={rawName} photoUrl={node.photo_url} branch={node.family_branch} size="md" />
          <span className="font-display text-xl font-semibold text-ink leading-tight"><bdi>{name}</bdi></span>
        </span>
      }
    >
      {(maiden || (node.nickname && !showNicknames) || node.family_branch) && (
        <div className="-mt-2 mb-3">
          {maiden && <div className="text-xs text-ink-muted italic">{language === 'he' ? 'לבית ' : 'née '}<bdi>{maiden}</bdi></div>}
          {node.nickname && !showNicknames && <div className="text-xs text-ink-faint">&quot;{node.nickname}&quot;</div>}
          {node.family_branch && <span className="text-xs text-ink-muted">{spell(node.family_branch)}</span>}
        </div>
      )}
      {node.birthday ? (
        <div className="bg-parchment rounded-md p-3 text-sm space-y-1">
          <div>🎂 <span className="font-medium text-ink">{node.birthday.hebrew_day} {node.birthday.hebrew_month}</span></div>
          {node.birthday.gregorian_year && <div className="text-xs text-ink-faint">Born {node.birthday.gregorian_year}</div>}
        </div>
      ) : (
        <div className="bg-parchment rounded-md p-3 text-sm text-ink-faint italic">{t('tree.no_birthday')}</div>
      )}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <button onClick={() => setEditing(true)} className="text-sm text-accent-ink hover:text-ink font-medium transition-colors">
            {t('tree.edit_person')}
          </button>
        </div>
      )}
    </Modal>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const coupleLeft = (n: PNode) => memberCx(n, 0) - CARD_W / 2;
const coupleRight = (n: PNode) => memberCx(n, coupleCount(n) - 1) + CARD_W / 2;

// Every node that has children, so the chart can start fully collapsed.
function allParentIds(roots: FamilyTreeNode[]): Set<number> {
  const ids = new Set<number>();
  const walk = (n: FamilyTreeNode) => {
    if (n.children.length) ids.add(n.id);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return ids;
}

// Focus target: a node id to centre on, 'root' for the first patriarch/matriarch,
// 'all' to fit the whole visible tree, or null for "nothing pending".
type FocusTarget = number | 'root' | 'all' | null;

// ── Main chart ────────────────────────────────────────────────────────────────
export function OrgChart({ roots }: { roots: FamilyTreeNode[] }) {
  const highlight = useBranchHighlight();
  const { t, branches } = useUserPrefs();
  // Start with everything collapsed — the view opens zoomed in on Grandma, and each
  // expand drills down to the newly revealed person/couple.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => allParentIds(roots));
  const [detail, setDetail] = useState<FamilyTreeNode | null>(null);
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<FocusTarget>('root');

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scaleLabelRef = useRef<HTMLSpanElement>(null);
  // First focus on load should snap instantly; later focuses animate.
  const didInitFocus = useRef(false);

  // d3-zoom owns pan/zoom: cursor-anchored wheel, trackpad + touch pinch,
  // double-tap zoom, tap-vs-drag — and writes the transform imperatively so a
  // gesture never re-renders the tree. See useTreeZoom.
  const { focusBox, fitAll, zoomBy } = useTreeZoom({ viewportRef, contentRef, scaleLabelRef });

  // Parent lookup + flat search index (covers spouses, mapped to their blood node).
  const { parentOf, searchIndex } = useMemo(() => {
    const parentOf = new Map<number, number | null>();
    const index: { primaryId: number; text: string }[] = [];
    const textOf = (n: FamilyTreeNode) =>
      [n.name, n.last_name, n.name_he, n.nickname, n.maiden_name, n.maiden_name_he].filter(Boolean).join(' ')
        .replace(/~[^~]+$/, '').replace(/\\/g, '').toLowerCase();
    const walk = (n: FamilyTreeNode, parentId: number | null) => {
      parentOf.set(n.id, parentId);
      index.push({ primaryId: n.id, text: textOf(n) });
      for (const s of n.spouses ?? []) index.push({ primaryId: n.id, text: textOf(s) });
      n.children.forEach(c => walk(c, n.id));
    };
    roots.forEach(r => walk(r, null));
    return { parentOf, searchIndex: index };
  }, [roots]);

  // Expand the whole ancestor chain above a node so it becomes visible.
  const revealAncestors = useCallback((primaryId: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      let cur = parentOf.get(primaryId) ?? null;
      while (cur != null) { next.delete(cur); cur = parentOf.get(cur) ?? null; }
      return next;
    });
  }, [parentOf]);

  const toggleCollapse = useCallback((id: number) => {
    const willExpand = collapsed.has(id);
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (willExpand) setFocus(id); // drill down to the node we just opened
  }, [collapsed]);

  // ── Layout (d3 tree with a virtual root) ──
  const { nodes, links, width, height } = useMemo(() => {
    const root = hierarchy<FamilyTreeNode>(
      { ...VIRTUAL_ROOT, children: roots },
      d => (d.id !== -1 && collapsed.has(d.id) ? [] : d.children),
    );
    const laid = tree<FamilyTreeNode>()
      .nodeSize([H_SLOT, ROW_H])
      .separation((a, b) => {
        // Widen the gap for couples — count every spouse so a remarried trio row
        // doesn't overlap its siblings.
        const spouses = (a.data.spouses?.length ?? 0) + (b.data.spouses?.length ?? 0);
        return (a.parent === b.parent ? 1 : 1.25) + spouses * 0.55;
      })(root);

    const real = laid.descendants().filter(n => n.data.id !== -1) as PNode[];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of real) {
      const left = memberCx(n, 0) - CARD_W / 2;
      const right = memberCx(n, coupleCount(n) - 1) + CARD_W / 2;
      minX = Math.min(minX, left); maxX = Math.max(maxX, right);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + CARD_H);
    }
    const dx = -minX + PAD;
    const dy = -minY + PAD;
    for (const n of real) { n.x += dx; n.y += dy; }

    const realLinks = laid.links().filter(l => (l.source as PNode).data.id !== -1) as { source: PNode; target: PNode }[];

    return {
      nodes: real,
      links: realLinks,
      width: (maxX - minX) + PAD * 2,
      height: (maxY - minY) + PAD * 2,
    };
  }, [roots, collapsed]);

  // Group child links by parent so we can draw one shared sibling bus each.
  const connectors = useMemo(() => {
    const byParent = new Map<number, PNode[]>();
    for (const l of links) {
      const arr = byParent.get(l.source.data.id) ?? [];
      arr.push(l.target);
      byParent.set(l.source.data.id, arr);
    }
    const paths: { key: string; d: string; accent: string }[] = [];
    for (const [, children] of byParent) {
      const parent = children[0].parent as PNode;
      const originX = parent.x; // couple midpoint (or single-card center)
      const parentBottom = parent.y + CARD_H;
      const childTop = Math.min(...children.map(c => c.y));
      const busY = parentBottom + (childTop - parentBottom) / 2;
      for (const c of children) {
        const cx = primaryCx(c);
        paths.push({
          key: `${parent.data.id}-${c.data.id}`,
          d: roundedElbow([[originX, parentBottom], [originX, busY], [cx, busY], [cx, c.y]]),
          accent: branchStyle(branches, c.data.family_branch).accent,
        });
      }
    }
    return paths;
  }, [links, branches]);

  // Apply a pending focus once the new layout reflecting it has been computed.
  // Runs in rAF (after paint) so the d3 transform is set against the final layout.
  useEffect(() => {
    if (focus == null) return;
    const raf = requestAnimationFrame(() => {
      const vp = viewportRef.current;
      if (!vp) return;
      const animate = didInitFocus.current; // snap on first load, glide afterwards
      if (focus === 'all') {
        fitAll(width, height, { animate });
        didInitFocus.current = true;
        setFocus(null);
        return;
      }
      const target = focus === 'root'
        ? nodes.find(n => n.depth === 1)
        : nodes.find(n => n.data.id === focus);
      if (!target) return; // not in the layout yet — retry when `nodes` updates
      const group = [target, ...nodes.filter(c => c.parent?.data.id === target.data.id)];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of group) {
        minX = Math.min(minX, coupleLeft(n)); maxX = Math.max(maxX, coupleRight(n));
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + CARD_H);
      }
      focusBox(minX, minY, maxX, maxY, { animate });
      didInitFocus.current = true;
      setFocus(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [focus, nodes, focusBox, fitAll, width, height]);

  const q = search.trim().toLowerCase();
  const matches = useCallback((n: FamilyTreeNode) => {
    if (!q) return false;
    const names = [n.name, n.name_he, n.nickname, n.maiden_name, n.maiden_name_he]
      .filter(Boolean).map(s => s!.toLowerCase());
    return names.some(s => s.includes(q));
  }, [q]);

  // Typing a name reveals the path to the first match and drills down to it.
  useEffect(() => {
    if (!q) return;
    const handle = setTimeout(() => {
      const hit = searchIndex.find(e => e.text.includes(q));
      if (hit) { revealAncestors(hit.primaryId); setFocus(hit.primaryId); }
    }, 300);
    return () => clearTimeout(handle);
  }, [q, searchIndex, revealAncestors]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tree.search')}
            className="w-48 sm:w-56 rounded-full border border-warm-border bg-parchment-card px-4 py-1.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-parchment-card border border-warm-border rounded-xl px-2 py-1.5 shadow-sm">
          <button onClick={() => zoomBy(0.7)} className="w-8 h-8 rounded-lg hover:bg-parchment-dark text-ink-muted text-lg font-light flex items-center justify-center" title={t('tree.zoom_out')} aria-label={t('tree.zoom_out')}>−</button>
          <span ref={scaleLabelRef} className="text-xs text-ink-muted w-10 text-center tabular-nums">100%</span>
          <button onClick={() => zoomBy(1.4)} className="w-8 h-8 rounded-lg hover:bg-parchment-dark text-ink-muted text-lg font-light flex items-center justify-center" title={t('tree.zoom_in')} aria-label={t('tree.zoom_in')}>+</button>
          <div className="w-px h-4 bg-warm-border mx-1" />
          <button
            onClick={() => { setCollapsed(allParentIds(roots)); setFocus('root'); }}
            className="text-xs text-accent-ink hover:text-ink px-1.5"
            title={t('tree.top_title')}
          >
            {t('tree.top')}
          </button>
          <div className="w-px h-4 bg-warm-border mx-1" />
          <button onClick={() => fitAll(width, height)} className="text-xs text-accent-ink hover:text-ink px-1.5" title={t('tree.fit_all_title')}>{t('tree.fit_all')}</button>
          {collapsed.size > 0 && (
            <>
              <div className="w-px h-4 bg-warm-border mx-1" />
              <button onClick={() => { setCollapsed(new Set()); setFocus('all'); }} className="text-xs text-accent-ink hover:text-ink px-1.5" title={t('tree.expand_all_title')}>{t('tree.expand_all')}</button>
            </>
          )}
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        dir="ltr"
        className="relative overflow-hidden rounded-2xl border border-warm-border bg-parchment-card touch-none select-none cursor-grab active:cursor-grabbing"
        style={{ height: '74vh' }}
      >
        <div
          ref={contentRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width, height }}
        >
          {/* Connector overlay */}
          <svg width={width} height={height} className="absolute top-0 left-0 pointer-events-none" aria-hidden>
            {/* Marriage links — one segment between each adjacent card in the row */}
            {nodes.filter(n => (n.data.spouses?.length ?? 0) > 0).flatMap(n => {
              const y = n.y + CARD_H / 2;
              const count = coupleCount(n);
              return Array.from({ length: count - 1 }, (_, i) => (
                <line key={`m-${n.data.id}-${i}`}
                  x1={memberCx(n, i) + CARD_W / 2} y1={y}
                  x2={memberCx(n, i + 1) - CARD_W / 2} y2={y}
                  stroke="#C9CCAE" strokeWidth={3} strokeLinecap="round" />
              ));
            })}
            {/* Parent → child elbows */}
            {connectors.map(c => (
              <path key={c.key} d={c.d} fill="none"
                stroke={c.accent}
                strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>

          {/* Cards */}
          {nodes.map(n => {
            const hasKids = n.data.children.length > 0;
            const isCollapsed = collapsed.has(n.data.id);
            const members = coupleMembers(n);
            const faded = q.length > 0 && !members.some(m => matches(m));
            return (
              <div key={n.data.id}>
                {members.map((person, i) => (
                  <NodeCard key={person.id} person={person} cx={memberCx(n, i)} top={n.y}
                    secondary={i > 0}
                    // Dim by EACH card's own branch — a married-in spouse is usually a
                    // different branch than the person they married. Unset and
                    // unrecognised values filter under the catch-all chip, matching
                    // the neutral colour they are drawn in.
                    dimmed={highlight !== null && branchBucket(branches, person.family_branch) !== highlight}
                    faded={faded && !matches(person)} onClick={() => setDetail(person)} />
                ))}

                {/* Marriage to a blood relative placed elsewhere (cousin marriage):
                    shown as a reference chip so the union isn't silently invisible. */}
                {n.data.spouseRefs?.length ? (
                  <div
                    className="absolute text-[10px] text-ink-muted whitespace-nowrap pointer-events-none"
                    style={{ left: memberCx(n, 0) - CARD_W / 2, top: n.y + CARD_H + 16, width: CARD_W }}
                  >
                    ⚭ {n.data.spouseRefs.map(r => r.name.replace(/~[^~]+$/, '').replace(/\\/g, '')).join(', ')}
                  </div>
                ) : null}

                {/* Collapse / expand badge */}
                {hasKids && (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(n.data.id)}
                    title={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                    aria-label={isCollapsed ? t('tree.expand') : t('tree.collapse')}
                    className="absolute z-10 flex items-center justify-center rounded-full border border-warm-border bg-parchment-card text-ink-muted shadow-sm hover:border-ink-muted hover:text-ink transition-colors font-medium"
                    style={{
                      left: n.x - (isCollapsed ? 20 : 14),
                      top: n.y + CARD_H - 14,
                      height: 28,
                      minWidth: 28,
                      paddingInline: isCollapsed ? 8 : 0,
                      fontSize: 13,
                      lineHeight: 1,
                    }}
                  >
                    {isCollapsed ? `+${n.data.children.length}` : '−'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Hint */}
        <div className="absolute bottom-2 right-3 text-[11px] text-ink-faint pointer-events-none">
          {t('tree.hint')}
        </div>
      </div>

      {detail && <NodeDetail node={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

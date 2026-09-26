import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { PromptDialog, type PromptState } from '../components/PromptDialog';
import { isLocal, location } from '../lib/project';
import { addGroup, addSubgroup, containers, findProject, moveProject, removeGroup, removeProject, renameGroup, sidebarView, toggleGroup, updateProject } from '../lib/configOps';
import type { Group, Project, ProjectOrder, Subgroup } from '../lib/types';
import { useStore } from '../store';
import { AlertIcon, CheckIcon, ChevronIcon, FolderInputIcon, FolderPenIcon, FolderPlusIcon, FolderIcon, GearIcon, PencilIcon, PlusIcon, SortIcon, TrashIcon } from '../filepanel/icons';
import { AddProjectDialog } from './AddProjectDialog';
import { resolveDrop, type DragItem, type Drop } from './drag';

// Pixels the pointer must travel before a press on a row becomes a drag rather than a click.
const DRAG_THRESHOLD = 4;

export function ProjectSidebar() {
  const config = useStore((s) => s.config);
  const activeId = useStore((s) => s.activeProjectId);
  const hosts = useStore((s) => s.hosts);
  const editRequest = useStore((s) => s.editRequest);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [drag, setDrag] = useState<{ item: DragItem; drop: Drop | null } | null>(null);
  const endDrag = useRef<(() => void) | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { updateConfig, selectProject } = useStore.getState();
  const order = config.settings.projectOrder;
  const view = sidebarView(config);

  useEffect(() => () => endDrag.current?.(), []);

  // Manual order only: a press that moves past the threshold drags the row; Escape or losing focus cancels.
  const startDrag = (e: React.PointerEvent, item: DragItem) => {
    if (e.button !== 0 || order !== 'manual') return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    let drop: Drop | null = null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
      active = true;
      drop = resolveDrop(useStore.getState().config, item, document.elementFromPoint(ev.clientX, ev.clientY), ev.clientY);
      setDrag({ item, drop });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      endDrag.current = null;
      if (!active) return;
      setDrag(null);
      // The click that follows the release would toggle or select whatever row it landed on.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (commit && drop) void updateConfig(drop.apply);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    endDrag.current = cancel;
  };

  // Drop-line class for a row or section, and the faded look of the item being dragged.
  const dragClass = (id: string, on: 'row' | 'section') => {
    if (!drag) return '';
    const hint = drag.drop?.hint;
    return (drag.item.id === id && (on === 'section' || drag.item.kind === 'project') ? ' dragging' : '') +
      (hint && hint.id === id && hint.on === on ? ` drop-${hint.pos}` : '');
  };

  const orderMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const choice = (value: ProjectOrder, label: string) => ({
      label,
      icon: order === value ? <CheckIcon /> : null,
      onSelect: () => void useStore.getState().updateSettings({ projectOrder: value }),
    });
    setMenu({ x: r.left, y: r.bottom + 2, items: [choice('manual', 'Manual order'), choice('name', 'Sort by name')] });
  };

  const editPath = useCallback((p: Project) => {
    setPrompt({
      title: isLocal(p) ? 'Local path' : `Path on ${p.host}`,
      initial: p.path,
      onSubmit: async (value) => {
        const path = value.length > 1 ? value.replace(/\/+$/, '') : value;
        const previous = p.path;
        await useStore.getState().updateConfig((c) => updateProject(c, p.id, { path }));
        // updateConfig resolves even when the save fails, so compare the persisted path against the
        // snapshot: invalidate only when it actually changed (an unchanged path needs no refetch).
        const persisted = findProject(useStore.getState().config, p.id);
        if (persisted && persisted.path !== previous) useStore.getState().setFiles(p.id, null);
      },
    });
  }, []);

  useEffect(() => {
    if (!editRequest) return;
    const p = findProject(config, editRequest);
    if (p) editPath(p);
    useStore.getState().requestEditProject(null);
  }, [editRequest, config, editPath]);

  const projectMenu = (e: React.MouseEvent, p: Project) => {
    e.preventDefault();
    const otherGroups = containers(view).filter((x) => !x.container.projects.some((q) => q.id === p.id));
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', icon: <PencilIcon />, onSelect: () => setPrompt({ title: 'Rename project', initial: p.name, onSubmit: (name) => void updateConfig((c) => updateProject(c, p.id, { name })) }) },
        { label: 'Edit path…', icon: <FolderPenIcon />, onSelect: () => editPath(p) },
        ...otherGroups.map((x) => ({ label: `Move to ${x.label}`, icon: <FolderInputIcon />, onSelect: () => void updateConfig((c) => moveProject(c, p.id, x.id)) })),
        {
          label: 'Remove',
          icon: <TrashIcon />,
          onSelect: async () => {
            await updateConfig((c) => removeProject(c, p.id));
            // Only drop the active selection once the removal is persisted.
            if (!findProject(useStore.getState().config, p.id) && useStore.getState().activeProjectId === p.id) {
              selectProject(null);
            }
          },
        },
      ],
    });
  };

  // Top-level groups (those with `subgroups`) can hold subgroups; subgroups cannot nest further.
  const groupMenu = (e: React.MouseEvent, g: Group | Subgroup) => {
    e.preventDefault();
    const isGroup = 'subgroups' in g;
    const notEmpty = g.projects.length > 0 || (isGroup && g.subgroups.length > 0);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', icon: <PencilIcon />, onSelect: () => setPrompt({ title: isGroup ? 'Rename group' : 'Rename subgroup', initial: g.name, onSubmit: (name) => void updateConfig((c) => renameGroup(c, g.id, name)) }) },
        ...(isGroup
          ? [{ label: 'New subgroup…', icon: <FolderPlusIcon />, onSelect: () => setPrompt({ title: `New subgroup in ${g.name}`, initial: '', onSubmit: (name) => void updateConfig((c) => addSubgroup(c, g.id, name)) }) }]
          : []),
        { label: notEmpty ? 'Remove (group not empty)' : 'Remove', icon: <TrashIcon />, disabled: notEmpty, onSelect: () => void updateConfig((c) => removeGroup(c, g.id)) },
      ],
    });
  };

  // Empty space in the sidebar; rows handle their own menu and mark the event handled first. Dialogs render
  // inside the sidebar too, and their fields keep the native edit menu.
  const sidebarMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented || (e.target as Element).closest('.modal-backdrop, .context-menu')) return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New project…', icon: <PlusIcon />, onSelect: () => setAdding(true) },
        { label: 'New group…', icon: <FolderPlusIcon />, onSelect: () => setPrompt({ title: 'New group', initial: '', onSubmit: (name) => void updateConfig((c) => addGroup(c, name)) }) },
      ],
    });
  };

  const groupRow = (g: Group | Subgroup, sub: boolean) => (
    <div
      className={'group-row' + (sub ? ' subgroup' : '') + (g.collapsed ? '' : ' open') + dragClass(g.id, 'row')}
      data-row={sub ? 'subgroup' : 'group'}
      data-id={g.id}
      onPointerDown={(e) => startDrag(e, { kind: sub ? 'subgroup' : 'group', id: g.id })}
      onClick={() => void updateConfig((c) => toggleGroup(c, g.id))}
      onContextMenu={(e) => groupMenu(e, g)}
    >
      <ChevronIcon />
      {g.name}
    </div>
  );

  // Connection state belongs to the host, so it rides on the host badge: a dot when connected, an alert
  // (with the error on hover) when failing, nothing while idle. Local folders have no connection.
  const hostBadge = (p: Project) => {
    if (isLocal(p)) return <span className="badge">{p.host}</span>;
    const status = hosts[p.host];
    const state = status?.state ?? 'idle';
    return (
      <span className={`badge ${state}`} title={state === 'error' ? (status?.message ?? 'Connection failed') : undefined}>
        {state === 'connected' && <span className="badge-dot" />}
        {state === 'error' && <AlertIcon />}
        {p.host}
      </span>
    );
  };

  const projectRows = (projects: Project[], containerId: string, sub: boolean) =>
    projects.map((p) => (
      <div
        key={p.id}
        className={'project-row' + (sub ? ' nested' : '') + (p.id === activeId ? ' active' : '') + dragClass(p.id, 'row')}
        title={location(p)}
        data-row="project"
        data-id={p.id}
        data-container={containerId}
        onPointerDown={(e) => startDrag(e, { kind: 'project', id: p.id })}
        onClick={() => selectProject(p.id)}
        onContextMenu={(e) => projectMenu(e, p)}
      >
        <span className="project-icon"><FolderIcon open={false} /></span>
        <span className="project-name">{p.name}</span>
        {hostBadge(p)}
      </div>
    ));

  return (
    <aside className={'sidebar' + (drag ? ' dragging' : '')} onContextMenu={sidebarMenu}>
      <div className="sidebar-header">
        <span>Projects</span>
        <span className="sidebar-actions">
          <button className="icon-btn" title="Project order" aria-label="Project order" onClick={orderMenu}>
            <SortIcon />
          </button>
          <button className="icon-btn" title="Add project" aria-label="Add project" onClick={() => setAdding(true)}>
            <PlusIcon />
          </button>
        </span>
      </div>
      <div className="sidebar-body">
        {config.groups.length === 0 && <p className="muted pad">No projects yet. Click + to add one.</p>}
        {view.groups.map((g) => (
          <section key={g.id} data-group={g.id} className={dragClass(g.id, 'section').trim() || undefined}>
            {groupRow(g, false)}
            {!g.collapsed && (
              <>
                {g.subgroups.map((s) => (
                  <section key={s.id} data-subgroup={s.id} data-parent={g.id} className={dragClass(s.id, 'section').trim() || undefined}>
                    {groupRow(s, true)}
                    {!s.collapsed && projectRows(s.projects, s.id, true)}
                  </section>
                ))}
                {projectRows(g.projects, g.id, false)}
              </>
            )}
          </section>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="icon-btn" title="Settings (⌘,)" aria-label="Settings" onClick={() => useStore.getState().setSettingsOpen(true)}>
          <GearIcon />
        </button>
      </div>
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
      {prompt && <PromptDialog {...prompt} onClose={() => setPrompt(null)} />}
    </aside>
  );
}

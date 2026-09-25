import { useCallback, useEffect, useState } from 'react';
import { ContextMenu, type MenuState } from '../components/ContextMenu';
import { PromptDialog, type PromptState } from '../components/PromptDialog';
import { isLocal, location } from '../lib/project';
import { findProject, moveProject, removeGroup, removeProject, renameGroup, toggleGroup, updateProject } from '../lib/configOps';
import type { Group, Project } from '../lib/types';
import { useStore } from '../store';
import { ChevronIcon, GearIcon, PlusIcon } from '../filepanel/icons';
import { AddProjectDialog } from './AddProjectDialog';

export function ProjectSidebar() {
  const config = useStore((s) => s.config);
  const activeId = useStore((s) => s.activeProjectId);
  const hosts = useStore((s) => s.hosts);
  const editRequest = useStore((s) => s.editRequest);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const { updateConfig, selectProject } = useStore.getState();

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
    const otherGroups = config.groups.filter((g) => !g.projects.some((x) => x.id === p.id));
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', onSelect: () => setPrompt({ title: 'Rename project', initial: p.name, onSubmit: (name) => void updateConfig((c) => updateProject(c, p.id, { name })) }) },
        { label: 'Edit path…', onSelect: () => editPath(p) },
        ...otherGroups.map((g) => ({ label: `Move to ${g.name}`, onSelect: () => void updateConfig((c) => moveProject(c, p.id, g.id)) })),
        {
          label: 'Remove',
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

  const groupMenu = (e: React.MouseEvent, g: Group) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', onSelect: () => setPrompt({ title: 'Rename group', initial: g.name, onSubmit: (name) => void updateConfig((c) => renameGroup(c, g.id, name)) }) },
        { label: g.projects.length ? 'Remove (group not empty)' : 'Remove', disabled: g.projects.length > 0, onSelect: () => void updateConfig((c) => removeGroup(c, g.id)) },
      ],
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Projects</span>
        <button className="icon-btn" title="Add project" aria-label="Add project" onClick={() => setAdding(true)}>
          <PlusIcon />
        </button>
      </div>
      <div className="sidebar-body">
        {config.groups.length === 0 && <p className="muted pad">No projects yet. Click + to add one.</p>}
        {config.groups.map((g) => (
          <section key={g.id}>
            <div
              className={'group-row' + (g.collapsed ? '' : ' open')}
              onClick={() => void updateConfig((c) => toggleGroup(c, g.id))}
              onContextMenu={(e) => groupMenu(e, g)}
            >
              <ChevronIcon />
              {g.name}
            </div>
            {!g.collapsed &&
              g.projects.map((p) => (
                <div
                  key={p.id}
                  className={'project-row' + (p.id === activeId ? ' active' : '')}
                  title={location(p)}
                  onClick={() => selectProject(p.id)}
                  onContextMenu={(e) => projectMenu(e, p)}
                >
                  <span className={`dot ${isLocal(p) ? 'local' : (hosts[p.host]?.state ?? 'idle')}`} />
                  <span className="project-name">{p.name}</span>
                  <span className="badge">{p.host}</span>
                </div>
              ))}
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

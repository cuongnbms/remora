import { AlertIcon } from '../filepanel/icons';
import { api } from '../lib/api';
import { findProject } from '../lib/configOps';
import { EMPTY_LIST, useStore } from '../store';
import { FileView } from './FileView';
import { Tabs } from './Tabs';

export function Viewer() {
  const project = useStore((s) => (s.activeProjectId ? findProject(s.config, s.activeProjectId) : undefined));
  const tabs = useStore((s) => (s.activeProjectId ? s.views[s.activeProjectId]?.tabs : undefined) ?? EMPTY_LIST);
  const active = useStore((s) => (s.activeProjectId ? s.views[s.activeProjectId]?.active : null) ?? null);
  const preview = useStore((s) => (s.activeProjectId ? s.views[s.activeProjectId]?.preview : null) ?? null);
  const host = useStore((s) => (project ? s.hosts[project.host] : undefined));

  if (!project) {
    return (
      <main className="viewer empty">
        <p className="muted">Select or add a project</p>
      </main>
    );
  }

  const retry = async () => {
    await api.unwatch().catch(() => {});
    await api.watchProject(project.id).catch(() => {});
    useStore.getState().requestReload();
  };

  return (
    <main className="viewer">
      {host?.state === 'error' && (
        <div className="banner error host-banner" role="alert">
          <AlertIcon />
          <strong>Can’t reach {project.host} — retrying…</strong>
          {host.message && (
            <span className="banner-detail" title={host.message}>
              {host.message}
            </span>
          )}
          <button onClick={() => void retry()}>Retry</button>
        </div>
      )}
      <Tabs tabs={tabs} active={active} preview={preview} />
      {active ? (
        <FileView key={`${project.id}|${project.path}|${active}`} project={project} path={active} />
      ) : (
        <p className="muted pad">Open a file from the panel on the right, or press ⌘P</p>
      )}
    </main>
  );
}

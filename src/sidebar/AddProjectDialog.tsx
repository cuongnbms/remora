import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, errorMessage } from '../lib/api';
import { addProjects, containers, findProject, flatProjects, newId, sidebarView, type GroupTarget } from '../lib/configOps';
import { basename } from '../lib/paths';
import { contractHome, expandHome, loadLastHost, saveLastHost } from '../lib/pathInput';
import { LOCAL_HOST, absPath, subfolderNames } from '../lib/project';
import { useStore } from '../store';
import { PathInput } from './PathInput';

const NEW_GROUP = '__new';
const START_PATH = '~/';

function trimPath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const lastHost = loadLastHost();
  const [hosts, setHosts] = useState<string[]>([]);
  const [remote, setRemote] = useState(!!lastHost && lastHost !== LOCAL_HOST);
  const [sshHost, setSshHost] = useState(lastHost && lastHost !== LOCAL_HOST ? lastHost : '');
  const [home, setHome] = useState<string | null>(null);
  const [path, setPath] = useState(START_PATH);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [groupId, setGroupId] = useState(config.groups[0]?.id ?? NEW_GROUP);
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Add each subfolder" mode: the listing of the chosen folder, and the subfolders unticked by the user.
  const [multi, setMulti] = useState(false);
  const [subs, setSubs] = useState<{ path: string; names: string[] } | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());

  const host = remote ? sshHost : LOCAL_HOST;

  useEffect(() => {
    api
      .listSshHosts()
      .then((list) => {
        setHosts(list);
        // The remembered host may have left ~/.ssh/config since.
        setSshHost((h) => (list.includes(h) ? h : list[0] ?? ''));
        if (!list.length) setRemote(false);
      })
      .catch(() => setRemote(false));
  }, []);

  useEffect(() => {
    setHome(null);
    if (!host) return;
    let cancelled = false;
    api
      .homeDir(host)
      .then((h) => !cancelled && setHome(h))
      .catch((err) => !cancelled && setError(`Could not reach ${host}: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [host]);

  // A path belongs to one machine, so a new host starts back at its home folder.
  function switchHost(update: () => void) {
    update();
    setPath(START_PATH);
    setError(null);
  }

  async function browse() {
    const picked = await openDialog({ directory: true, defaultPath: expandHome(path.trim(), home) || undefined }).catch(() => null);
    if (typeof picked === 'string') setPath(contractHome(picked, home));
  }

  const expanded = trimPath(expandHome(path.trim(), home));
  const atStart = path.trim() === START_PATH;
  // Until a folder is chosen, leave the name blank rather than naming it after the home folder.
  const effectiveName = nameTouched ? name : atStart ? '' : basename(expanded);

  useEffect(() => {
    setSubs(null);
    setSubsError(null);
    setUnticked(new Set());
    if (!multi || !host || !expanded.startsWith('/') || atStart) return;
    let cancelled = false;
    // Wait for typing to pause before listing, since each keystroke changes the folder.
    const timer = setTimeout(() => {
      api
        .listRemoteDir(host, expanded)
        .then((entries) => !cancelled && setSubs({ path: expanded, names: subfolderNames(entries) }))
        .catch((err) => !cancelled && setSubsError(errorMessage(err)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [multi, host, expanded, atStart]);

  const taken = new Set(flatProjects(config).filter((p) => p.host === host).map((p) => p.path));
  const subPath = (name: string) => absPath({ path: expanded }, name);
  const listed = subs?.path === expanded ? subs.names : null;
  // The untouched home folder is not a choice yet; listing it would tick every folder in home.
  const pathChosen = expanded.startsWith('/') && !atStart;
  const available = listed?.filter((n) => !taken.has(subPath(n))) ?? [];
  const chosen = available.filter((n) => !unticked.has(n));

  function toggleSub(name: string) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }

  async function saveProjects(projects: { id: string; name: string; host: string; path: string }[]): Promise<boolean> {
    const target: GroupTarget = groupId === NEW_GROUP ? { newGroup: newGroup.trim() || 'Default' } : { groupId };
    await useStore.getState().updateConfig((c) => addProjects(c, target, projects));
    // updateConfig resolves even when the save fails, so confirm persistence before closing.
    return projects.every((p) => findProject(useStore.getState().config, p.id));
  }

  async function submitMany() {
    if (!chosen.length) return;
    setBusy(true);
    const projects = chosen.map((n) => ({ id: newId(), name: n, host, path: subPath(n) }));
    if (!(await saveProjects(projects))) {
      setError('Could not save the config. The projects were not added.');
      setBusy(false);
      return;
    }
    saveLastHost(host);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (multi) return submitMany();
    const cleanPath = expanded;
    if (!host) {
      setError('Choose an SSH host');
      return;
    }
    if (!cleanPath.startsWith('/')) {
      setError(cleanPath.startsWith('~') ? 'Home folder is still loading, try again' : 'Enter an absolute path, or one starting with ~');
      return;
    }
    setBusy(true);
    try {
      await api.listRemoteDir(host, cleanPath);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    const project = { id: newId(), name: effectiveName.trim() || basename(cleanPath) || cleanPath, host, path: cleanPath };
    if (!(await saveProjects([project]))) {
      setError('Could not save the config. The project was not added.');
      setBusy(false);
      return;
    }
    saveLastHost(host);
    useStore.getState().selectProject(project.id);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Add project</h3>
        <div className="field">
          <span className="field-label">Location</span>
          <div className="segmented" role="radiogroup" aria-label="Location">
            <button type="button" role="radio" aria-checked={!remote} className={remote ? '' : 'selected'} onClick={() => remote && switchHost(() => setRemote(false))}>
              This Mac
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={remote}
              className={remote ? 'selected' : ''}
              disabled={!hosts.length}
              title={hosts.length ? undefined : 'No hosts found in ~/.ssh/config'}
              onClick={() => !remote && switchHost(() => setRemote(true))}
            >
              SSH host
            </button>
          </div>
        </div>
        {remote && (
          <label>
            Host
            <select value={sshHost} onChange={(e) => switchHost(() => setSshHost(e.target.value))}>
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        )}
        <div className="field">
          <span className="field-label">Path</span>
          <div className="path-row">
            <PathInput key={host} host={host} home={home} value={path} onChange={setPath} autoFocus placeholder={remote ? '~/project or /srv/project' : '~/project'} />
            {!remote && <button type="button" onClick={() => void browse()}>Browse…</button>}
          </div>
          <span className="field-hint">↑↓ to pick a folder, Tab to open it{expanded.startsWith('/') && expanded !== trimPath(path.trim()) ? ` · ${expanded}` : ''}</span>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Add each subfolder as a project
        </label>
        {multi && (
          <div className="field">
            <div className="field-row">
              <span className="field-label">Subfolders</span>
              {!!available.length && (
                <button type="button" className="link-btn" onClick={() => setUnticked(chosen.length ? new Set(available) : new Set())}>
                  {chosen.length ? 'Select none' : 'Select all'}
                </button>
              )}
            </div>
            <ul className="sub-list">
              {subsError ? (
                <li className="sub-empty">{subsError}</li>
              ) : !listed ? (
                <li className="sub-empty">{pathChosen ? 'Loading…' : 'Choose a folder'}</li>
              ) : !listed.length ? (
                <li className="sub-empty">No subfolders</li>
              ) : (
                listed.map((n) => {
                  const added = taken.has(subPath(n));
                  return (
                    <li key={n}>
                      <label className={`check-row${added ? ' disabled' : ''}`}>
                        <input type="checkbox" disabled={added} checked={!added && !unticked.has(n)} onChange={() => toggleSub(n)} />
                        <span className="sub-name">{n}</span>
                        {added && <span className="field-hint">already added</span>}
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
            {!!listed?.length && <span className="field-hint">{chosen.length} of {available.length} selected</span>}
          </div>
        )}
        {!multi && (
          <label>
            Name
            <input spellCheck={false} autoCapitalize="off" autoCorrect="off" value={effectiveName} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} />
          </label>
        )}
        <label>
          Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {containers(sidebarView(config)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            <option value={NEW_GROUP}>New group…</option>
          </select>
        </label>
        {groupId === NEW_GROUP && (
          <label>
            New group name
            <input spellCheck={false} autoCapitalize="off" autoCorrect="off" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Default" />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          {multi ? (
            <button type="submit" className="btn-primary" disabled={busy || !chosen.length}>
              {busy ? 'Adding…' : chosen.length > 1 ? `Add ${chosen.length} projects` : 'Add project'}
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Add'}</button>
          )}
        </div>
      </form>
    </div>
  );
}

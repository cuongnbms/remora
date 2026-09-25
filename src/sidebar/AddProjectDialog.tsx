import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, errorMessage } from '../lib/api';
import { addProject, containers, findProject, newId, type GroupTarget } from '../lib/configOps';
import { basename } from '../lib/paths';
import { contractHome, expandHome, loadLastHost, saveLastHost } from '../lib/pathInput';
import { LOCAL_HOST } from '../lib/project';
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
  // Until a folder is chosen, leave the name blank rather than naming it after the home folder.
  const effectiveName = nameTouched ? name : path.trim() === START_PATH ? '' : basename(expanded);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
    const target: GroupTarget = groupId === NEW_GROUP ? { newGroup: newGroup.trim() || 'Default' } : { groupId };
    await useStore.getState().updateConfig((c) => addProject(c, target, project));
    // updateConfig resolves even when the save fails, so confirm persistence before closing.
    if (!findProject(useStore.getState().config, project.id)) {
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
        <label>
          Name
          <input value={effectiveName} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} />
        </label>
        <label>
          Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {containers(config).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            <option value={NEW_GROUP}>New group…</option>
          </select>
        </label>
        {groupId === NEW_GROUP && (
          <label>
            New group name
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Default" />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Add'}</button>
        </div>
      </form>
    </div>
  );
}

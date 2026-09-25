import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { addProject, findProject, newId, type GroupTarget } from '../lib/configOps';
import { basename } from '../lib/paths';
import { LOCAL_HOST, isLocal } from '../lib/project';
import { useStore } from '../store';

const NEW_GROUP = '__new';

function trimPath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config);
  const [hosts, setHosts] = useState<string[]>([]);
  const [host, setHost] = useState('');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [groupId, setGroupId] = useState(config.groups[0]?.id ?? NEW_GROUP);
  const [newGroup, setNewGroup] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listSshHosts()
      .then((list) => {
        setHosts(list);
        setHost((h) => h || list[0] || LOCAL_HOST);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!host || !path.startsWith('/')) {
      setSuggestions([]);
      return;
    }
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash) || '/';
    const prefix = path.slice(slash + 1);
    const timer = setTimeout(() => {
      api
        .listRemoteDir(host, dir)
        .then((entries) =>
          setSuggestions(
            entries
              .filter((e) => e.kind === 'dir' && e.name.startsWith(prefix))
              .slice(0, 20)
              .map((e) => `${dir === '/' ? '' : dir}/${e.name}`),
          ),
        )
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [host, path]);

  const effectiveName = nameTouched ? name : basename(trimPath(path));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanPath = trimPath(path.trim());
    if (!host.trim() || !cleanPath.startsWith('/')) {
      setError('Host and an absolute path are required');
      return;
    }
    setBusy(true);
    try {
      await api.listRemoteDir(host.trim(), cleanPath);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    const project = { id: newId(), name: effectiveName.trim() || cleanPath, host: host.trim(), path: cleanPath };
    const target: GroupTarget = groupId === NEW_GROUP ? { newGroup: newGroup.trim() || 'Default' } : { groupId };
    await useStore.getState().updateConfig((c) => addProject(c, target, project));
    // updateConfig resolves even when the save fails, so confirm persistence before closing.
    if (!findProject(useStore.getState().config, project.id)) {
      setError('Could not save the config. The project was not added.');
      setBusy(false);
      return;
    }
    useStore.getState().selectProject(project.id);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Add project</h3>
        <label>
          Host (from ~/.ssh/config, or “{LOCAL_HOST}” for this Mac)
          <input list="remora-ssh-hosts" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
        </label>
        <datalist id="remora-ssh-hosts">
          {[LOCAL_HOST, ...hosts.filter((h) => h !== LOCAL_HOST)].map((h) => <option key={h} value={h} />)}
        </datalist>
        <label>
          Path
          <input list="remora-path-suggestions" value={path} onChange={(e) => setPath(e.target.value)} placeholder={isLocal({ host: host.trim() }) ? '/Users/you/project' : '/home/you/project'} />
        </label>
        <datalist id="remora-path-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <label>
          Name
          <input value={effectiveName} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} />
        </label>
        <label>
          Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
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
          <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Add'}</button>
        </div>
      </form>
    </div>
  );
}

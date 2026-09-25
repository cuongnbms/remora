import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { findProject } from '../lib/configOps';
import { fuzzyFilter } from '../lib/fuzzy';
import { basename, dirname } from '../lib/paths';
import { location } from '../lib/project';
import type { Project } from '../lib/types';
import { useStore } from '../store';
import { FileTree } from './FileTree';

export function FilePanel() {
  const project = useStore((s) => (s.activeProjectId ? findProject(s.config, s.activeProjectId) : undefined));
  if (!project) {
    return (
      <aside className="filepanel">
        <p className="muted pad">Select a project</p>
      </aside>
    );
  }
  return <ProjectFiles key={`${project.id}|${project.host}|${project.path}`} project={project} />;
}

function ProjectFiles({ project }: { project: Project }) {
  const files = useStore((s) => s.views[project.id]?.files ?? null);
  const filesGeneration = useStore((s) => s.views[project.id]?.filesGeneration ?? 0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (files !== null) return;
    // A response for a path this panel has since left (the component remounts when the project or
    // its path changes) must not write into the shared per-project cache.
    let cancelled = false;
    api
      .listFiles(project.id)
      .then((list) => {
        if (!cancelled) useStore.getState().setFiles(project.id, list, filesGeneration);
      })
      .catch((e) => {
        if (!cancelled) useStore.getState().setToast(`Cannot list files: ${errorMessage(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, files, filesGeneration]);

  const results = useMemo(() => (query && files ? fuzzyFilter(query, files, 50) : []), [query, files]);
  const open = (p: string) => {
    useStore.getState().openFile(p);
    setQuery('');
  };

  return (
    <aside className="filepanel">
      <div className="panel-header" title={location(project)}>{project.name}</div>
      <input
        className="find"
        placeholder="Find files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) open(results[0]);
          if (e.key === 'Escape') setQuery('');
        }}
      />
      {query ? (
        <ul className="file-results">
          {files === null ? (
            <li className="muted">Loading file list…</li>
          ) : (
            results.map((p) => (
              <li key={p} title={p} onClick={() => open(p)}>
                <span>{basename(p)}</span>
                <span className="muted small">{dirname(p)}</span>
              </li>
            ))
          )}
        </ul>
      ) : (
        <FileTree projectId={project.id} />
      )}
    </aside>
  );
}

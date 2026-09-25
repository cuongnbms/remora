use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::mpsc;

use crate::config::Project;
use crate::error::{AppError, AppResult};
use crate::local_fs::is_local;
use crate::ssh::{HostState, SshPool};
use crate::watcher::{adds_excluded_dir, dedupe, exit_message, inotify_cmd, local_change, parse_inotify_line, poll_cmd, Backoff, Change, Poller};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const DEBOUNCE: Duration = Duration::from_millis(300);

pub type ChangeSink = Arc<dyn Fn(String, Vec<Change>) + Send + Sync>;

#[derive(Default)]
pub struct WatcherManager {
    current: Mutex<Option<(String, tauri::async_runtime::JoinHandle<()>)>>,
}

impl WatcherManager {
    /// Watch `project`, leaving out `excludes`. A call for the same project, root and excludes
    /// keeps the running watcher; any difference replaces it.
    pub fn start(&self, pool: Arc<SshPool>, project: Project, excludes: Vec<String>, sink: ChangeSink) {
        // Excluded names never contain '/', so it separates them unambiguously.
        let key = format!("{}|{}|{}|{}", project.id, project.host, project.path, excludes.join("/"));
        let mut current = self.current.lock().unwrap();
        if current.as_ref().is_some_and(|(k, _)| *k == key) {
            return;
        }
        if let Some((_, handle)) = current.take() {
            handle.abort();
        }
        let handle = tauri::async_runtime::spawn(run_watch(pool, project, excludes, sink));
        *current = Some((key, handle));
    }

    pub fn stop(&self) {
        if let Some((_, handle)) = self.current.lock().unwrap().take() {
            handle.abort();
        }
    }
}

async fn run_watch(pool: Arc<SshPool>, project: Project, excludes: Vec<String>, sink: ChangeSink) {
    let mut backoff = Backoff::default();
    loop {
        let result = if is_local(&project.host) {
            watch_local(&project, &excludes, &sink, &mut backoff).await
        } else {
            watch_remote(&pool, &project, &excludes, &sink, &mut backoff).await
        };
        if let Err(e) = result {
            eprintln!("[remora] watcher for {} stopped: {e}", project.name);
        }
        tokio::time::sleep(backoff.next_delay()).await;
    }
}

/// Watch a folder on this machine with the OS file events (FSEvents on macOS),
/// batching them with the same debounce as the inotify stream.
async fn watch_local(project: &Project, excludes: &[String], sink: &ChangeSink, backoff: &mut Backoff) -> AppResult<()> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let _ = tx.send(res);
    })
    .map_err(|e| AppError::Other(format!("cannot start watcher: {e}")))?;
    watcher
        .watch(Path::new(&project.path), RecursiveMode::Recursive)
        .map_err(|e| AppError::Other(format!("cannot watch {}: {e}", project.path)))?;
    backoff.reset();
    let mut roots = vec![PathBuf::from(&project.path)];
    if let Ok(canonical) = std::fs::canonicalize(&project.path) {
        roots.push(canonical);
    }
    let mut batch: Vec<Change> = Vec::new();
    loop {
        let next = if batch.is_empty() {
            Some(rx.recv().await)
        } else {
            tokio::time::timeout(DEBOUNCE, rx.recv()).await.ok()
        };
        match next {
            None => sink(project.id.clone(), dedupe(std::mem::take(&mut batch))),
            Some(Some(Ok(event))) => {
                batch.extend(event.paths.iter().filter_map(|p| local_change(&roots, p, &event.kind, excludes)));
            }
            Some(Some(Err(e))) => return Err(AppError::Other(format!("watch error: {e}"))),
            Some(None) => return Err(AppError::Other("watcher stopped".into())),
        }
    }
}

async fn watch_remote(pool: &SshPool, project: &Project, excludes: &[String], sink: &ChangeSink, backoff: &mut Backoff) -> AppResult<()> {
    if has_inotify(pool, &project.host).await? {
        watch_inotify(pool, project, excludes, sink, backoff).await
    } else {
        watch_poll(pool, project, excludes, sink, backoff).await
    }
}

async fn has_inotify(pool: &SshPool, host: &str) -> AppResult<bool> {
    let out = pool.run_ok(host, "command -v inotifywait >/dev/null 2>&1 && echo yes || echo no").await?;
    Ok(String::from_utf8_lossy(&out).trim() == "yes")
}

/// Start `inotifywait` on the host. The child's stdin stays open for as long as the child
/// lives; when it is dropped, the remote side sees EOF and ends the watcher (see `inotify_cmd`).
pub fn spawn_inotify(pool: &SshPool, host: &str, path: &str, excludes: &[String]) -> AppResult<Child> {
    pool.command(host, &inotify_cmd(path, excludes))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::Ssh(format!("cannot start ssh: {e}")))
}

/// After the watcher's stdout closed: why it ended, taken from its stderr.
pub async fn exit_reason(child: &mut Child) -> String {
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = tokio::time::timeout(Duration::from_secs(2), pipe.read_to_string(&mut stderr)).await;
    }
    exit_message(&stderr)
}

/// Returns `Ok` when an excluded folder appeared: the caller restarts the watcher so the new
/// folder is left out (`inotifywait -r` would otherwise watch everything inside it).
async fn watch_inotify(pool: &SshPool, project: &Project, excludes: &[String], sink: &ChangeSink, backoff: &mut Backoff) -> AppResult<()> {
    let mut child = spawn_inotify(pool, &project.host, &project.path, excludes)?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Other("watcher has no stdout".into()))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut batch: Vec<Change> = Vec::new();
    loop {
        // Wait indefinitely for the first event; after that, flush once 300 ms pass without another.
        let next = if batch.is_empty() {
            Some(lines.next_line().await)
        } else {
            tokio::time::timeout(DEBOUNCE, lines.next_line()).await.ok()
        };
        match next {
            None => sink(project.id.clone(), dedupe(std::mem::take(&mut batch))),
            Some(Ok(Some(line))) => {
                backoff.reset();
                if let Some(change) = parse_inotify_line(&project.path, &line) {
                    let restart = adds_excluded_dir(&change, excludes);
                    batch.push(change);
                    if restart {
                        sink(project.id.clone(), dedupe(batch));
                        return Ok(());
                    }
                }
            }
            Some(Ok(None)) => {
                let reason = exit_reason(&mut child).await;
                pool.set_status(&project.host, HostState::Error, Some(reason.clone()));
                return Err(AppError::Ssh(reason));
            }
            Some(Err(e)) => return Err(AppError::Other(e.to_string())),
        }
    }
}

async fn watch_poll(pool: &SshPool, project: &Project, excludes: &[String], sink: &ChangeSink, backoff: &mut Backoff) -> AppResult<()> {
    let now = pool.run_ok(&project.host, "date +%s").await?;
    let since: i64 = String::from_utf8_lossy(&now)
        .trim()
        .parse()
        .map_err(|_| AppError::Other("cannot read remote clock".into()))?;
    let mut poller = Poller::new(since);
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let out = pool.run(&project.host, &poll_cmd(&project.path, poller.since(), excludes)).await?;
        backoff.reset();
        let changes = poller.apply(&out.stdout);
        if !changes.is_empty() {
            sink(project.id.clone(), changes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_watch_reports_created_and_removed_files() {
        let dir = tempfile::tempdir().unwrap();
        let project = Project {
            id: "p".into(),
            name: "local".into(),
            host: crate::local_fs::LOCAL_HOST.into(),
            path: dir.path().to_str().unwrap().into(),
        };
        let (tx, mut rx) = mpsc::unbounded_channel::<(String, Vec<Change>)>();
        let sink: ChangeSink = Arc::new(move |id, changes| {
            let _ = tx.send((id, changes));
        });
        let excludes = crate::config::Settings::default().excludes;
        let task = tokio::spawn(async move { watch_local(&project, &excludes, &sink, &mut Backoff::default()).await });

        // FSEvents needs a moment to start; keep writing until an event arrives.
        let target = dir.path().join("notes.md");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let mut seen: Vec<Change> = Vec::new();
        while !seen.iter().any(|c| c.path == "notes.md" && !c.removed) {
            std::fs::write(&target, "hello").unwrap();
            if let Ok(Some((id, changes))) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                assert_eq!(id, "p");
                seen.extend(changes);
            }
            assert!(tokio::time::Instant::now() < deadline, "no create event, saw {seen:?}");
        }
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        std::fs::write(dir.path().join("node_modules/x.js"), "").unwrap();
        std::fs::remove_file(&target).unwrap();
        let mut seen: Vec<Change> = Vec::new();
        while !seen.iter().any(|c| c.path == "notes.md" && c.removed) {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some((_, changes))) => seen.extend(changes),
                _ => panic!("no remove event, saw {seen:?}"),
            }
        }
        assert!(seen.iter().all(|c| !c.path.starts_with("node_modules/")), "{seen:?}");
        task.abort();
    }
}

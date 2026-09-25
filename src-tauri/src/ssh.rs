use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::paths::validate_host;

const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HostState {
    Idle,
    Connected,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HostStatus {
    pub host: String,
    pub state: HostState,
    pub message: Option<String>,
}

pub type StatusSink = Arc<dyn Fn(HostStatus) + Send + Sync>;

#[derive(Debug)]
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

pub struct SshPool {
    control_path: String,
    /// Serializes status transitions so notification order always matches stored order.
    /// Held across the sink callback; the status-map lock is never held during callbacks.
    transitions: Mutex<()>,
    statuses: Mutex<HashMap<String, HostStatus>>,
    sink: StatusSink,
}

impl SshPool {
    /// `control_dir` should be short (macOS limits socket paths to ~104 bytes); we use `~/.ssh`.
    pub fn new(control_dir: PathBuf, sink: StatusSink) -> Self {
        let control_path = format!("{}/cm-remora-%C", control_dir.to_string_lossy().trim_end_matches('/'));
        Self { control_path, transitions: Mutex::new(()), statuses: Mutex::new(HashMap::new()), sink }
    }

    pub fn args(&self, host: &str, remote_cmd: &str) -> Vec<String> {
        let mut args = Vec::new();
        for opt in [
            "ControlMaster=auto".to_string(),
            format!("ControlPath={}", self.control_path),
            "ControlPersist=10m".to_string(),
            "BatchMode=yes".to_string(),
            "ConnectTimeout=5".to_string(),
            "ServerAliveInterval=15".to_string(),
        ] {
            args.push("-o".to_string());
            args.push(opt);
        }
        args.push("--".to_string());
        args.push(host.to_string());
        args.push(remote_cmd.to_string());
        args
    }

    pub fn command(&self, host: &str, remote_cmd: &str) -> Command {
        let mut cmd = Command::new("ssh");
        cmd.args(self.args(host, remote_cmd));
        cmd
    }

    pub async fn run(&self, host: &str, remote_cmd: &str) -> AppResult<Output> {
        validate_host(host)?;
        let mut cmd = self.command(host, remote_cmd);
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child = cmd.spawn().map_err(|e| AppError::Ssh(format!("cannot start ssh: {e}")))?;
        match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
            Err(_) => {
                self.set_status(host, HostState::Error, Some("timed out".into()));
                Err(AppError::Timeout(format!("{host}: command timed out after {}s", TIMEOUT.as_secs())))
            }
            Ok(Err(e)) => Err(AppError::Ssh(e.to_string())),
            Ok(Ok(out)) => {
                let code = out.status.code().unwrap_or(-1);
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if code == 255 {
                    let msg = if stderr.is_empty() { format!("ssh to {host} failed") } else { stderr };
                    self.set_status(host, HostState::Error, Some(msg.clone()));
                    return Err(AppError::Ssh(msg));
                }
                self.set_status(host, HostState::Connected, None);
                Ok(Output { stdout: out.stdout, stderr, code })
            }
        }
    }

    pub async fn run_ok(&self, host: &str, remote_cmd: &str) -> AppResult<Vec<u8>> {
        let out = self.run(host, remote_cmd).await?;
        if out.code == 0 { Ok(out.stdout) } else { Err(classify_failure(&out.stderr)) }
    }

    pub fn set_status(&self, host: &str, state: HostState, message: Option<String>) {
        let status = HostStatus { host: host.to_string(), state, message };
        // Hold the transition lock across both the store and the notification so a
        // concurrent caller cannot store and emit a state that makes an earlier
        // notification stale. The status-map lock is released before the sink runs, so a
        // sink may call `statuses()` without deadlocking.
        let _transition = self.transitions.lock().unwrap();
        {
            let mut map = self.statuses.lock().unwrap();
            if map.get(host) == Some(&status) {
                return;
            }
            map.insert(host.to_string(), status.clone());
        }
        (self.sink)(status);
    }

    pub fn statuses(&self) -> Vec<HostStatus> {
        self.statuses.lock().unwrap().values().cloned().collect()
    }
}

pub fn classify_failure(stderr: &str) -> AppError {
    let msg = stderr.trim();
    if msg.contains("No such file or directory") {
        AppError::NotFound(msg.to_string())
    } else if msg.contains("Is a directory") || msg.contains("Not a directory") {
        AppError::InvalidPath(msg.to_string())
    } else if msg.is_empty() {
        AppError::Other("remote command failed".into())
    } else {
        AppError::Other(msg.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn pool_with_log() -> (SshPool, Arc<StdMutex<Vec<HostStatus>>>) {
        let log = Arc::new(StdMutex::new(Vec::new()));
        let l = log.clone();
        let sink: StatusSink = Arc::new(move |s| l.lock().unwrap().push(s));
        (SshPool::new(PathBuf::from("/Users/me/.ssh"), sink), log)
    }

    #[test]
    fn args_put_options_then_double_dash_then_host_then_command() {
        let (pool, _) = pool_with_log();
        let args = pool.args("devbox", "ls -la");
        let dd = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[dd + 1], "devbox");
        assert_eq!(args[dd + 2], "ls -la");
        assert_eq!(args.len(), dd + 3);
        for opt in [
            "ControlMaster=auto",
            "ControlPath=/Users/me/.ssh/cm-remora-%C",
            "ControlPersist=10m",
            "BatchMode=yes",
            "ConnectTimeout=5",
            "ServerAliveInterval=15",
        ] {
            let i = args.iter().position(|a| a == opt).unwrap_or_else(|| panic!("missing {opt}"));
            assert_eq!(args[i - 1], "-o");
        }
    }

    #[test]
    fn classify_maps_common_errors() {
        assert!(matches!(classify_failure("head: cannot open 'x' for reading: No such file or directory"), AppError::NotFound(_)));
        assert!(matches!(classify_failure("head: error reading 'd': Is a directory"), AppError::InvalidPath(_)));
        assert!(matches!(classify_failure("boom"), AppError::Other(m) if m == "boom"));
        assert!(matches!(classify_failure(""), AppError::Other(m) if m == "remote command failed"));
    }

    #[test]
    fn set_status_emits_only_on_change() {
        let (pool, log) = pool_with_log();
        pool.set_status("h", HostState::Connected, None);
        pool.set_status("h", HostState::Connected, None);
        pool.set_status("h", HostState::Error, Some("x".into()));
        let log = log.lock().unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].state, HostState::Error);
        assert_eq!(pool.statuses().len(), 1);
    }

    #[test]
    fn concurrent_set_status_serializes_transitions() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Condvar;
        use std::thread;

        // The sink holds the first transition inside the callback so a second transition
        // has a chance to interleave. A correct implementation must not let the second
        // transition store or notify before the first one has finished notifying.
        let entered = Arc::new((StdMutex::new(false), Condvar::new()));
        let release = Arc::new((StdMutex::new(false), Condvar::new()));
        let emitted: Arc<StdMutex<Vec<HostStatus>>> = Arc::new(StdMutex::new(Vec::new()));

        let e = emitted.clone();
        let entered_sink = entered.clone();
        let release_sink = release.clone();
        let sink: StatusSink = Arc::new(move |s: HostStatus| {
            e.lock().unwrap().push(s.clone());
            if s.state == HostState::Connected {
                let (m, cv) = &*entered_sink;
                *m.lock().unwrap() = true;
                cv.notify_all();
                let (m, cv) = &*release_sink;
                let mut released = m.lock().unwrap();
                while !*released {
                    let (g, _) = cv.wait_timeout(released, Duration::from_secs(5)).unwrap();
                    released = g;
                }
            }
        });
        let pool = Arc::new(SshPool::new(PathBuf::from("/Users/me/.ssh"), sink));

        let p = pool.clone();
        let first = thread::spawn(move || p.set_status("h", HostState::Connected, None));
        // Wait until the first transition is inside the sink callback.
        {
            let (m, cv) = &*entered;
            let mut started = m.lock().unwrap();
            while !*started {
                let (g, _) = cv.wait_timeout(started, Duration::from_secs(5)).unwrap();
                started = g;
                assert!(*started, "first transition never reached the sink");
            }
        }

        let attempting = Arc::new(AtomicBool::new(false));
        let completed = Arc::new(AtomicBool::new(false));
        let a = attempting.clone();
        let c = completed.clone();
        let p = pool.clone();
        let second = thread::spawn(move || {
            a.store(true, Ordering::SeqCst);
            p.set_status("h", HostState::Error, Some("x".into()));
            c.store(true, Ordering::SeqCst);
        });
        while !attempting.load(Ordering::SeqCst) {
            thread::yield_now();
        }
        thread::sleep(Duration::from_millis(200));
        assert!(!completed.load(Ordering::SeqCst), "second transition finished while the first was still notifying");
        assert_eq!(
            pool.statuses().first().unwrap().state,
            HostState::Connected,
            "stored state changed before the earlier notification finished"
        );

        {
            let (m, cv) = &*release;
            *m.lock().unwrap() = true;
            cv.notify_all();
        }
        first.join().unwrap();
        second.join().unwrap();

        let emitted = emitted.lock().unwrap().clone();
        let stored = pool.statuses();
        assert_eq!(
            emitted.iter().map(|s| s.state).collect::<Vec<_>>(),
            vec![HostState::Connected, HostState::Error],
            "emissions must follow stored order"
        );
        assert_eq!(stored.len(), 1);
        assert_eq!(emitted.last().unwrap(), stored.first().unwrap(), "last emitted status must match stored status");
    }

    #[test]
    fn host_status_serializes_lowercase() {
        let s = HostStatus { host: "h".into(), state: HostState::Connected, message: None };
        assert_eq!(serde_json::to_string(&s).unwrap(), r#"{"host":"h","state":"connected","message":null}"#);
    }

    #[tokio::test]
    async fn unreachable_host_fails_fast_with_ssh_error() {
        let (pool, log) = pool_with_log();
        let started = std::time::Instant::now();
        let res = pool.run("nonexistent.invalid", "true").await;
        assert!(matches!(res, Err(AppError::Ssh(_))), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(15));
        assert_eq!(log.lock().unwrap().last().unwrap().state, HostState::Error);
    }

    #[tokio::test]
    async fn invalid_host_is_rejected_before_spawning() {
        let (pool, _) = pool_with_log();
        assert!(matches!(pool.run("-oProxyCommand=x", "true").await, Err(AppError::InvalidPath(_))));
    }
}

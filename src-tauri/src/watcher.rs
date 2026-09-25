use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::event::{CreateKind, EventKind, RemoveKind};
use serde::Serialize;

use crate::paths::{find_names, sq};

/// Prefix of the hidden staging dirs `transfer::staging_in` creates inside a project (or `~/Downloads`)
/// while an Upload or Download is in flight (e.g. `.remora-upload.XXXXXX`). Excluded from all three
/// matchers below by prefix, not via the user's excludes (which are exact names), so
/// a large transfer doesn't stream refresh-triggering events for `.remora-upload.XXXXXX/i/...`. The
/// final placement (`mv`/`rename` to `dest/<name>`) lands directly in `dest`, with no `.remora-`
/// path component, so that arrival event still gets through.
const STAGING_PREFIX: &str = ".remora-";
const BACKOFF_SECS: [u64; 4] = [1, 2, 5, 10];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub is_dir: bool,
    pub removed: bool,
}

/// The remote session has no tty, so sshd never signals it when the channel closes, and
/// `inotifywait` only notices on its next write: in a quiet tree it would live on, holding
/// its watches. So a background `cat` waits for the session's stdin (kept open by the app)
/// to reach EOF, then kills the watcher, which `exec` gave the shell's pid (`$$`). The
/// watchdog's own output goes to /dev/null so a failed `inotifywait` still closes stdout.
///
/// `--exclude` only filters events: `-r` still puts a watch on every folder below, and a
/// big `node_modules` alone can use up the host's inotify watch limit. Folders listed with
/// `@` in `--fromfile` are not watched at all, so `find` lists the excluded ones present now
/// and feeds them in through a here-doc. The event filter drops only what happens *inside* an
/// excluded folder, so creating a new one still arrives (see `adds_excluded_dir`).
pub fn inotify_cmd(abs: &str, excludes: &[String]) -> String {
    let q = sq(abs);
    let staging = format!("(^|/){}[^/]*(/|$)", ere_escape(STAGING_PREFIX));
    let filter = if excludes.is_empty() {
        staging
    } else {
        let names = excludes.iter().map(|n| ere_escape(n)).collect::<Vec<_>>().join("|");
        format!("(^|/)({names})/|{staging}")
    };
    // The root stays on the command line (not in the list) so `ps` shows what is watched.
    let skipped = if excludes.is_empty() {
        String::new()
    } else {
        format!(r"$(find {q} -mindepth 1 \( {} \) -prune -printf '@%p\n' 2>/dev/null)", find_names(excludes))
    };
    format!(
        "exec 3<&0; (cat; kill $$) <&3 >/dev/null 2>&1 & exec inotifywait -m -r -q -e close_write,create,delete,moved_to,moved_from --format '%e|%w%f' --exclude {} --fromfile - {q} 3<&- <<REMORA_WATCH\n{skipped}\nREMORA_WATCH\n",
        sq(&filter)
    )
}

/// Escape a name for a POSIX extended regex.
fn ere_escape(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if ".[]()*+?{}|^$\\".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// True when `change` is an excluded folder appearing (created or moved in). `inotifywait -r`
/// starts watching everything inside it, so the watcher is restarted to leave it out again.
pub fn adds_excluded_dir(change: &Change, excludes: &[String]) -> bool {
    change.is_dir && !change.removed && excludes.iter().any(|n| change.path.rsplit('/').next() == Some(n.as_str()))
}

/// Why the watch session ended, from its stderr: the first non-empty line (`inotifywait`
/// states the error there, e.g. the inotify watch limit, then adds advice), else a generic message.
/// The local ssh client's own notices (e.g. a busy ControlSocket) share the stream and are skipped.
pub fn exit_message(stderr: &str) -> String {
    const SSH_NOTICES: [&str; 3] = ["ControlSocket ", "mux_client", "Warning: Permanently added"];
    stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !SSH_NOTICES.iter().any(|n| l.starts_with(n)))
        .map_or_else(|| "watch session ended".to_string(), str::to_string)
}

pub fn parse_inotify_line(root: &str, line: &str) -> Option<Change> {
    let (events, full) = line.split_once('|')?;
    let root = root.trim_end_matches('/');
    let rel = if full == root {
        ""
    } else {
        full.strip_prefix(root)?.strip_prefix('/')?
    };
    Some(Change {
        path: rel.trim_end_matches('/').to_string(),
        is_dir: events.contains("ISDIR"),
        removed: events.contains("DELETE") || events.contains("MOVED_FROM"),
    })
}

/// Turn one path from a local (FSEvents) event into a `Change` relative to the project
/// root. `roots` lists every spelling of the root (as configured and canonicalized, e.g.
/// `/var/...` vs `/private/var/...`). The file system is consulted for `removed` and
/// `is_dir` because FSEvents coalesces event kinds.
pub fn local_change(roots: &[PathBuf], path: &Path, kind: &EventKind, excludes: &[String]) -> Option<Change> {
    if matches!(kind, EventKind::Access(_)) {
        return None;
    }
    let rel = roots.iter().find_map(|r| path.strip_prefix(r).ok())?;
    let rel = rel.to_string_lossy().into_owned();
    if rel.split('/').any(|seg| excludes.iter().any(|n| n == seg) || seg.starts_with(STAGING_PREFIX)) {
        return None;
    }
    let (is_dir, removed) = match std::fs::symlink_metadata(path) {
        Ok(m) => (m.is_dir(), false),
        Err(_) => (matches!(kind, EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder)), true),
    };
    Some(Change { path: rel, is_dir, removed })
}

pub fn poll_cmd(abs: &str, since: i64, excludes: &[String]) -> String {
    let mut prune = format!("-name {}", sq(&format!("{STAGING_PREFIX}*")));
    if !excludes.is_empty() {
        prune = format!("{} -o {prune}", find_names(excludes));
    }
    format!(r"find {} \( {} \) -prune -o -newermt '@{}' -printf '%y\t%T@\t%P\0' 2>/dev/null", sq(abs), prune, since)
}

/// Turns repeated `find -newermt` output into change events. Directories are included:
/// creating, deleting or renaming an entry bumps its parent directory's mtime.
pub struct Poller {
    since: i64,
    seen: HashMap<String, f64>,
}

impl Poller {
    pub fn new(since: i64) -> Self {
        Self { since, seen: HashMap::new() }
    }

    pub fn since(&self) -> i64 {
        self.since
    }

    pub fn apply(&mut self, out: &[u8]) -> Vec<Change> {
        let mut changes = Vec::new();
        let mut max = self.since as f64;
        for rec in out.split(|b| *b == 0).filter(|r| !r.is_empty()) {
            let s = String::from_utf8_lossy(rec);
            let mut it = s.splitn(3, '\t');
            let (Some(kind), Some(mtime), Some(path)) = (it.next(), it.next(), it.next()) else { continue };
            let Ok(mtime) = mtime.parse::<f64>() else { continue };
            if mtime > max {
                max = mtime;
            }
            if self.seen.get(path) == Some(&mtime) {
                continue;
            }
            self.seen.insert(path.to_string(), mtime);
            changes.push(Change { path: path.to_string(), is_dir: kind == "d", removed: false });
        }
        // Stay one second behind the newest mtime so same-second writes are not missed;
        // `seen` suppresses repeats inside that window.
        self.since = (max.floor() as i64 - 1).max(self.since);
        let cutoff = self.since as f64;
        self.seen.retain(|_, m| *m > cutoff);
        changes
    }
}

pub fn dedupe(changes: Vec<Change>) -> Vec<Change> {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Change> = Vec::new();
    for c in changes {
        if let Some(&i) = index.get(&c.path) {
            out[i] = c;
        } else {
            index.insert(c.path.clone(), out.len());
            out.push(c);
        }
    }
    out
}

#[derive(Default)]
pub struct Backoff {
    attempt: usize,
}

impl Backoff {
    pub fn next_delay(&mut self) -> Duration {
        let secs = BACKOFF_SECS[self.attempt.min(BACKOFF_SECS.len() - 1)];
        self.attempt += 1;
        Duration::from_secs(secs)
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, ModifyKind, RenameMode};

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|n| n.to_string()).collect()
    }

    fn ex() -> Vec<String> {
        crate::config::Settings::default().excludes
    }

    #[test]
    fn inotify_cmd_watches_recursively_and_skips_excluded_dirs() {
        let cmd = inotify_cmd("/r/p q", &names(&["node_modules", ".git", "a(b)"]));
        assert!(cmd.starts_with("exec 3<&0; (cat; kill $$) <&3 >/dev/null 2>&1 & exec inotifywait -m -r -q -e close_write,create,delete,moved_to,moved_from --format '%e|%w%f'"));
        // Events inside an excluded folder are dropped, but not the folder's own creation.
        assert!(cmd.contains(r"--exclude '(^|/)(node_modules|\.git|a\(b\))/|(^|/)\.remora-[^/]*(/|$)'"), "{cmd}");
        // The excluded folders present now are listed with `@` so they get no watches at all.
        assert!(cmd.contains(" --fromfile - '/r/p q' 3<&- <<REMORA_WATCH\n$(find '/r/p q' -mindepth 1 \\( -name 'node_modules' -o -name '.git' -o -name 'a(b)' \\) -prune -printf '@%p\\n' 2>/dev/null)\nREMORA_WATCH\n"), "{cmd}");
        assert!(cmd.ends_with("\nREMORA_WATCH\n"));
    }

    #[test]
    fn inotify_cmd_without_excludes_watches_everything_but_staging() {
        let cmd = inotify_cmd("/r", &[]);
        assert!(cmd.contains(r"--exclude '(^|/)\.remora-[^/]*(/|$)'"), "{cmd}");
        assert!(cmd.contains(" --fromfile - '/r' 3<&- <<REMORA_WATCH\n\nREMORA_WATCH\n"), "{cmd}");
    }

    #[test]
    fn adds_excluded_dir_only_for_new_excluded_folders() {
        let ex = names(&["node_modules", "venv"]);
        let c = |path: &str, is_dir, removed| Change { path: path.into(), is_dir, removed };
        assert!(adds_excluded_dir(&c("web/node_modules", true, false), &ex));
        assert!(adds_excluded_dir(&c("venv", true, false), &ex));
        assert!(!adds_excluded_dir(&c("web/node_modules", true, true), &ex));
        assert!(!adds_excluded_dir(&c("web/node_modules", false, false), &ex));
        assert!(!adds_excluded_dir(&c("node_modules/x", true, false), &ex));
        assert!(!adds_excluded_dir(&c("my_venv", true, false), &ex));
    }

    #[test]
    fn exit_message_prefers_the_first_stderr_line() {
        let stderr = "\nFailed to watch /r; upper limit on inotify watches reached!\nPlease increase the amount of inotify watches allowed per user via `/proc/sys/fs/inotify/max_user_watches'.\n\n";
        assert_eq!(exit_message(stderr), "Failed to watch /r; upper limit on inotify watches reached!");
        assert_eq!(exit_message(" \n"), "watch session ended");
        let noisy = "ControlSocket /u/.ssh/cm-remora-x already exists, disabling multiplexing\r\nCouldn't watch /r: No such file or directory\n";
        assert_eq!(exit_message(noisy), "Couldn't watch /r: No such file or directory");
    }

    #[test]
    fn parse_inotify_lines() {
        assert_eq!(
            parse_inotify_line("/r", "CLOSE_WRITE,CLOSE|/r/docs/a b.md"),
            Some(Change { path: "docs/a b.md".into(), is_dir: false, removed: false })
        );
        assert_eq!(
            parse_inotify_line("/r/", "CREATE,ISDIR|/r/new"),
            Some(Change { path: "new".into(), is_dir: true, removed: false })
        );
        assert_eq!(
            parse_inotify_line("/r", "DELETE|/r/x.md"),
            Some(Change { path: "x.md".into(), is_dir: false, removed: true })
        );
        assert_eq!(
            parse_inotify_line("/r", "MOVED_FROM|/r/y|z.md"),
            Some(Change { path: "y|z.md".into(), is_dir: false, removed: true })
        );
        assert_eq!(parse_inotify_line("/r", "DELETE_SELF|/r"), Some(Change { path: "".into(), is_dir: false, removed: true }));
        assert_eq!(parse_inotify_line("/r", "CREATE|/other/x"), None);
        assert_eq!(parse_inotify_line("/r", "garbage"), None);
    }

    #[test]
    fn poll_cmd_prunes_excludes_and_uses_since() {
        let cmd = poll_cmd("/r/p", 1700000000, &names(&[".git", "venv"]));
        assert!(cmd.starts_with(r"find '/r/p' \( -name '.git' -o -name 'venv' -o -name '.remora-*' \) -prune -o"), "{cmd}");
        assert!(poll_cmd("/r/p", 1, &[]).starts_with(r"find '/r/p' \( -name '.remora-*' \) -prune -o"));
        assert!(cmd.contains("-newermt '@1700000000'"));
        assert!(cmd.contains(r"-printf '%y\t%T@\t%P\0'"));
    }

    #[test]
    fn poller_reports_new_and_changed_entries_once() {
        let mut p = Poller::new(100);
        let first = p.apply(b"f\t105.25\tdocs/a.md\0d\t105.25\tdocs\0");
        assert_eq!(
            first,
            vec![
                Change { path: "docs/a.md".into(), is_dir: false, removed: false },
                Change { path: "docs".into(), is_dir: true, removed: false },
            ]
        );
        assert_eq!(p.since(), 104);
        assert!(p.apply(b"f\t105.25\tdocs/a.md\0d\t105.25\tdocs\0").is_empty());
        assert_eq!(
            p.apply(b"f\t107.5\tdocs/a.md\0d\t105.25\tdocs\0"),
            vec![Change { path: "docs/a.md".into(), is_dir: false, removed: false }]
        );
        assert_eq!(p.since(), 106);
    }

    #[test]
    fn poller_reports_root_dir_change_as_empty_path() {
        let mut p = Poller::new(100);
        assert_eq!(p.apply(b"d\t101.0\t\0"), vec![Change { path: "".into(), is_dir: true, removed: false }]);
    }

    #[test]
    fn poller_never_moves_since_backwards_and_ignores_garbage() {
        let mut p = Poller::new(500);
        assert!(p.apply(b"junk\0f\tnotanumber\tx\0").is_empty());
        assert_eq!(p.since(), 500);
    }

    #[test]
    fn dedupe_keeps_first_position_last_value() {
        let a1 = Change { path: "a".into(), is_dir: false, removed: false };
        let b = Change { path: "b".into(), is_dir: false, removed: false };
        let a2 = Change { path: "a".into(), is_dir: false, removed: true };
        assert_eq!(dedupe(vec![a1, b.clone(), a2.clone()]), vec![a2, b]);
    }

    #[test]
    fn backoff_sequence_and_reset() {
        let mut b = Backoff::default();
        let secs: Vec<u64> = (0..6).map(|_| b.next_delay().as_secs()).collect();
        assert_eq!(secs, [1, 2, 5, 10, 10, 10]);
        b.reset();
        assert_eq!(b.next_delay().as_secs(), 1);
    }

    #[test]
    fn change_serializes_camel_case() {
        let json = serde_json::to_string(&Change { path: "a".into(), is_dir: true, removed: false }).unwrap();
        assert_eq!(json, r#"{"path":"a","isDir":true,"removed":false}"#);
    }

    #[test]
    fn local_change_maps_paths_under_any_root_spelling() {
        let dir = tempfile::tempdir().unwrap();
        let raw = dir.path().to_path_buf();
        let canonical = std::fs::canonicalize(&raw).unwrap();
        std::fs::create_dir_all(raw.join("docs/sub")).unwrap();
        std::fs::write(raw.join("docs/a b.md"), "x").unwrap();
        let roots = [raw.clone(), canonical.clone()];
        let modify = EventKind::Modify(ModifyKind::Any);

        assert_eq!(
            local_change(&roots, &canonical.join("docs/a b.md"), &modify, &ex()),
            Some(Change { path: "docs/a b.md".into(), is_dir: false, removed: false })
        );
        assert_eq!(
            local_change(&roots, &raw.join("docs/sub"), &EventKind::Create(CreateKind::Folder), &ex()),
            Some(Change { path: "docs/sub".into(), is_dir: true, removed: false })
        );
        assert_eq!(
            local_change(&roots, &raw.join("gone.md"), &EventKind::Remove(RemoveKind::File), &ex()),
            Some(Change { path: "gone.md".into(), is_dir: false, removed: true })
        );
        assert_eq!(
            local_change(&roots, &raw.join("old-dir"), &EventKind::Remove(RemoveKind::Folder), &ex()),
            Some(Change { path: "old-dir".into(), is_dir: true, removed: true })
        );
        // A rename reports the old name, which no longer exists.
        assert_eq!(
            local_change(&roots, &raw.join("renamed.md"), &EventKind::Modify(ModifyKind::Name(RenameMode::From)), &ex()),
            Some(Change { path: "renamed.md".into(), is_dir: false, removed: true })
        );
        assert_eq!(
            local_change(&roots, &raw, &modify, &ex()),
            Some(Change { path: "".into(), is_dir: true, removed: false })
        );
    }

    #[test]
    fn local_change_ignores_excludes_access_and_foreign_paths() {
        let roots = [PathBuf::from("/r")];
        let modify = EventKind::Modify(ModifyKind::Any);
        assert_eq!(local_change(&roots, Path::new("/r/node_modules/x/i.js"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/r/.git/index"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/r/src/target/o"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/rx/a.md"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/other/a.md"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/r/a.md"), &EventKind::Access(AccessKind::Any), &ex()), None);
    }

    #[test]
    fn local_change_ignores_staging_dirs_but_not_their_final_placement() {
        let roots = [PathBuf::from("/r")];
        let modify = EventKind::Modify(ModifyKind::Any);
        // Events inside a live Upload/Download staging dir are noise: dropped by prefix, not exact name.
        assert_eq!(local_change(&roots, Path::new("/r/.remora-upload.aB3xY/i/0/photo.png"), &modify, &ex()), None);
        assert_eq!(local_change(&roots, Path::new("/r/docs/.remora-download.Zz9/report.md"), &modify, &ex()), None);

        // The final `mv`/`rename` into `dest/<name>` has no `.remora-` path component, so it still surfaces.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::write(root.join("photo.png"), "x").unwrap();
        assert_eq!(
            local_change(std::slice::from_ref(&root), &root.join("photo.png"), &modify, &ex()),
            Some(Change { path: "photo.png".into(), is_dir: false, removed: false })
        );
    }
}

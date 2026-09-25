//! Transfer between this Mac and a project: Upload (Mac → a project folder) and Download
//! (project → ~/Downloads). Nothing is ever overwritten; see docs/adr/0002.

use std::collections::HashSet;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};
use crate::local_fs::io_err;
use crate::paths;
use crate::paths::{sq, validate_host};
use crate::remote_fs::Entry;
use crate::ssh::{classify_failure, HostState, SshPool};

/// One item dropped from Finder, validated by `check_sources`.
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub path: PathBuf,
    pub name: String,
    /// A real folder. A symlink to a folder is not one: it is copied as a link.
    pub is_dir: bool,
}

/// The `n`-th Finder-style variant of `name`: 0 is `name` itself, then `stem (n).ext`.
/// Folders and dotfiles (`.env`) have no extension; only the last dot splits (`a.tar (1).gz`).
pub fn candidate(name: &str, is_dir: bool, n: usize) -> String {
    if n == 0 {
        return name.to_string();
    }
    let split = if is_dir { None } else { name.rfind('.').filter(|&i| i > 0) };
    match split {
        Some(i) => format!("{} ({n}){}", &name[..i], &name[i..]),
        None => format!("{name} ({n})"),
    }
}

/// The first variant of `name` not in `taken`. Records the pick so later items of the same drop skip it.
pub fn unique_name(taken: &mut HashSet<String>, name: &str, is_dir: bool) -> String {
    let mut n = 0;
    loop {
        let c = candidate(name, is_dir, n);
        if taken.insert(c.clone()) {
            return c;
        }
        n += 1;
    }
}

/// Validate the absolute paths the webview reports for a Finder drop.
pub fn check_sources(paths: &[String]) -> AppResult<Vec<Source>> {
    if paths.is_empty() {
        return Err(AppError::InvalidPath("nothing to upload".into()));
    }
    paths
        .iter()
        .map(|p| {
            if !p.starts_with('/') || p.contains('\0') || p.contains('\n') {
                return Err(AppError::InvalidPath(format!("not an absolute path: {p:?}")));
            }
            let path = PathBuf::from(p);
            let ft = fs::symlink_metadata(&path).map_err(|e| io_err(p, e))?.file_type();
            if !(ft.is_file() || ft.is_dir() || ft.is_symlink()) {
                return Err(AppError::InvalidPath(format!("{p}: not a file, folder or symlink")));
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| AppError::InvalidPath(format!("{p}: no usable file name")))?
                .to_string();
            Ok(Source { path, name, is_dir: ft.is_dir() })
        })
        .collect()
}

/// A hidden temp dir inside `dir`, removed when dropped (also on every error path).
pub fn staging_in(dir: &Path, prefix: &str) -> AppResult<tempfile::TempDir> {
    tempfile::Builder::new().prefix(prefix).tempdir_in(dir).map_err(|e| io_err(&dir.to_string_lossy(), e))
}

/// Rename that fails with `AlreadyExists` instead of replacing `to`. On macOS this is atomic and also
/// catches names that differ only by case on case-insensitive volumes.
#[cfg(target_os = "macos")]
fn rename_excl(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: both pointers are valid NUL-terminated strings for the duration of the call.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_excl(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}

/// Move `staged` into `dir` as `name`, or as its first free Finder-style variant. Never replaces anything.
fn place(staged: &Path, dir: &Path, name: &str, is_dir: bool) -> AppResult<String> {
    for n in 0..10_000 {
        let c = candidate(name, is_dir, n);
        match rename_excl(staged, &dir.join(&c)) {
            Ok(()) => return Ok(c),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_err(&dir.join(&c).to_string_lossy(), e)),
        }
    }
    Err(AppError::Other(format!("no free name for {name} in {}", dir.display())))
}

/// Copy `src` to `dst` (which must not exist). Symlinks are recreated as symlinks, never followed.
fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    let ft = fs::symlink_metadata(src)?.file_type();
    if ft.is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(src)?, dst)
    } else if ft.is_dir() {
        fs::create_dir(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else if ft.is_file() {
        fs::copy(src, dst).map(|_| ())
    } else {
        Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file, folder or symlink"))
    }
}

/// Move the downloaded `staging/name` into `downloads` under a free name; returns the saved path.
pub fn finish_download(staging: &Path, name: &str, downloads: &Path) -> AppResult<PathBuf> {
    let staged = staging.join(name);
    let meta = fs::symlink_metadata(&staged).map_err(|_| AppError::Other(format!("{name}: nothing was downloaded")))?;
    Ok(downloads.join(place(&staged, downloads, name, meta.is_dir())?))
}

/// Upload into a folder on this Mac (a local project). Returns the final names, in source order.
/// Items placed before a failure stay; the staging dir is always removed.
pub fn upload_local(dest: &Path, sources: &[Source]) -> AppResult<Vec<String>> {
    let d = dest.to_string_lossy();
    if !fs::metadata(dest).map_err(|e| io_err(&d, e))?.is_dir() {
        return Err(AppError::InvalidPath(format!("{d}: not a folder")));
    }
    let dest_real = fs::canonicalize(dest).map_err(|e| io_err(&d, e))?;
    for s in sources.iter().filter(|s| s.is_dir) {
        if fs::canonicalize(&s.path).is_ok_and(|real| dest_real.starts_with(real)) {
            return Err(AppError::InvalidPath(format!("cannot copy {} into itself", s.name)));
        }
    }
    let staging = staging_in(dest, ".remora-upload.")?;
    let mut names = Vec::with_capacity(sources.len());
    for (i, s) in sources.iter().enumerate() {
        // One slot per source so two items with the same basename cannot collide while staged.
        let staged = staging.path().join(i.to_string());
        copy_tree(&s.path, &staged).map_err(|e| io_err(&s.path.to_string_lossy(), e))?;
        names.push(place(&staged, dest, &s.name, s.is_dir)?);
    }
    Ok(names)
}

/// Download a file or folder of a local project into `downloads`.
pub fn download_local(src: &Path, downloads: &Path) -> AppResult<PathBuf> {
    let s = src.to_string_lossy();
    let meta = fs::symlink_metadata(src).map_err(|e| io_err(&s, e))?;
    let name = src.file_name().and_then(|n| n.to_str()).ok_or_else(|| AppError::InvalidPath(format!("{s}: no usable file name")))?;
    // A real folder that contains (or is) `downloads` would have `copy_tree` walk into the staging
    // dir it is filling, recursing until ENAMETOOLONG. A symlink can't recurse (copy_tree recreates
    // it as a link, never follows it), so only check real dirs, and only via `src`'s own real path
    // (never follow a symlink here either).
    if meta.is_dir() {
        if let (Ok(src_real), Ok(downloads_real)) = (fs::canonicalize(src), fs::canonicalize(downloads)) {
            if downloads_real.starts_with(&src_real) {
                return Err(AppError::InvalidPath("cannot download a folder that contains Downloads".into()));
            }
        }
    }
    let staging = staging_in(downloads, ".remora-download.")?;
    copy_tree(src, &staging.path().join(name)).map_err(|e| io_err(&s, e))?;
    finish_download(staging.path(), name, downloads)
}

/// `~/Downloads`, created if missing.
pub fn downloads_dir() -> AppResult<PathBuf> {
    let dir = dirs::download_dir().ok_or_else(|| AppError::Other("cannot find the Downloads folder".into()))?;
    fs::create_dir_all(&dir).map_err(|e| io_err(&dir.to_string_lossy(), e))?;
    Ok(dir)
}

/// How long one Upload or Download may run before its `ssh` is killed.
pub const TRANSFER_TIMEOUT: Duration = Duration::from_secs(600);

/// Remote side of an Upload: extract the tar on stdin into a hidden temp dir inside `dest`, then move
/// each top-level item to its precomputed name. Items are extracted to `i/<name>`. A completion
/// sentinel file `done` is checked before any moves: if missing, the upload was interrupted and fails.
/// `mv -n` never replaces; if a name was taken meanwhile the item is still in "$t"/i and the command fails.
/// `|| true` because `mv -n`'s exit status for a skipped move differs between coreutils releases.
/// `trap` removes the temp dir on every exit.
pub fn upload_cmd(dest: &str, names: &[String]) -> String {
    let mut cmd = format!(
        r#"set -e; t=$(mktemp -d {}); trap 'rm -rf "$t"' EXIT; tar -xf - -C "$t"; if [ ! -e "$t"/done ]; then echo 'upload was interrupted' >&2; exit 1; fi"#,
        sq(&format!("{dest}/.remora-upload.XXXXXX"))
    );
    for name in names {
        let staged = format!(r#""$t"/i/{}"#, sq(name));
        cmd.push_str(&format!(
            "; mv -n -T -- {staged} {} || true; if [ -e {staged} ] || [ -L {staged} ]; then printf '%s\\n' {} >&2; exit 1; fi",
            sq(&format!("{dest}/{name}")),
            sq(&format!("{name} already exists, try again")),
        ));
    }
    cmd
}

/// Remote side of a Download: a tar of `parent/name` on stdout.
pub fn download_cmd(parent: &str, name: &str) -> String {
    format!("tar -cf - -C {} -- {}", sq(parent), sq(name))
}

/// `/a/b` → (`/a`, `b`); `/b` → (`/`, `b`). The filesystem root has no name to download.
pub fn split_parent(abs: &str) -> AppResult<(String, String)> {
    match abs.rsplit_once('/') {
        Some((parent, name)) if !name.is_empty() => {
            Ok((if parent.is_empty() { "/".to_string() } else { parent.to_string() }, name.to_string()))
        }
        _ => Err(AppError::InvalidPath(format!("nothing to download at {abs:?}"))),
    }
}

/// The absolute path to download for project-relative `rel`; the project root itself is refused.
pub fn download_target(root: &str, rel: &str) -> AppResult<String> {
    let abs = paths::resolve(root, rel)?;
    if abs == paths::resolve(root, "")? {
        return Err(AppError::InvalidPath("cannot download the whole project".into()));
    }
    Ok(abs)
}

#[derive(Debug)]
pub struct Exit {
    pub code: i32,
    pub stderr: String,
}

/// Spawn `cmd` with piped stdio and run `io` on its stdin/stdout in a separate thread, while this
/// thread waits for the child and kills it once `timeout` passes (which also unblocks `io`).
/// `io` must drop stdin to signal EOF. Returns the child's exit and `io`'s own result.
pub fn run_piped<T: Send + 'static>(
    mut cmd: Command,
    timeout: Duration,
    io: impl FnOnce(ChildStdin, ChildStdout) -> AppResult<T> + Send + 'static,
) -> AppResult<(Exit, AppResult<T>)> {
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| AppError::Ssh(format!("cannot start ssh: {e}")))?;
    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    // Drain stderr concurrently so a chatty child cannot block on a full pipe.
    let err_thread = thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let io_thread = thread::spawn(move || io(stdin, stdout));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                let _ = child.kill();
                return Err(AppError::Ssh(e.to_string()));
            }
        }
    };
    let io_res = io_thread.join().unwrap_or_else(|_| Err(AppError::Other("transfer thread panicked".into())));
    let stderr = err_thread.join().unwrap_or_default().trim().to_string();
    match status {
        None => Err(AppError::Timeout(format!("transfer timed out after {}s", timeout.as_secs()))),
        Some(s) => Ok((Exit { code: s.code().unwrap_or(-1), stderr }, io_res)),
    }
}

/// Turn a finished transfer into its result, updating the host status like `SshPool::run` does.
/// A failing exit wins over `io`'s error: when the remote side dies, the local side only sees a
/// broken pipe, while stderr says why.
pub fn settle<T>(pool: &SshPool, host: &str, res: AppResult<(Exit, AppResult<T>)>) -> AppResult<T> {
    let (exit, io) = match res {
        Err(e @ AppError::Timeout(_)) => {
            pool.set_status(host, HostState::Error, Some("timed out".into()));
            return Err(e);
        }
        other => other?,
    };
    if exit.code == 255 {
        let msg = if exit.stderr.is_empty() { format!("ssh to {host} failed") } else { exit.stderr };
        pool.set_status(host, HostState::Error, Some(msg.clone()));
        return Err(AppError::Ssh(msg));
    }
    pool.set_status(host, HostState::Connected, None);
    if exit.code != 0 {
        return Err(classify_failure(&exit.stderr));
    }
    io
}

fn ssh_command(pool: &SshPool, host: &str, remote_cmd: &str) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.args(pool.args(host, remote_cmd));
    cmd
}

/// Unpack a tar stream into a fresh staging dir in `downloads`. Entries with `..` or absolute paths
/// are skipped by the `tar` crate, so nothing lands outside the staging dir.
pub fn unpack_to_staging(reader: impl Read, downloads: &Path) -> AppResult<tempfile::TempDir> {
    let staging = staging_in(downloads, ".remora-download.")?;
    tar::Archive::new(reader)
        .unpack(staging.path())
        .map_err(|e| AppError::Other(format!("cannot unpack download: {e}")))?;
    Ok(staging)
}

/// Write a tar stream of items to be uploaded. Each source is appended as `i/<name>`.
/// After all sources are appended successfully, a final empty regular-file entry named `done` is appended
/// as a completion sentinel. If any append fails, returns early without appending `done`.
pub fn write_upload_stream(w: impl std::io::Write, items: &[(Source, String)]) -> AppResult<()> {
    let mut b = tar::Builder::new(w);
    b.follow_symlinks(false);
    for (s, name) in items {
        let path_in_tar = format!("i/{name}");
        let added = if s.is_dir {
            b.append_dir_all(&path_in_tar, &s.path)
        } else {
            b.append_path_with_name(&s.path, &path_in_tar)
        };
        added.map_err(|e| io_err(&s.path.to_string_lossy(), e))?;
    }
    // Append the completion sentinel.
    let mut h = tar::Header::new_gnu();
    h.set_size(0);
    h.set_mode(0o644);
    h.set_entry_type(tar::EntryType::Regular);
    b.append_data(&mut h, "done", &b""[..])
        .map_err(|e| AppError::Other(format!("cannot append done marker: {e}")))?;
    b.into_inner().map(drop).map_err(|e| AppError::Other(format!("upload stream: {e}")))
}

/// Turn a finished Upload transfer into its result. If the remote said the upload was interrupted
/// (exit != 255, "upload was interrupted" in stderr) and the local side also failed, the local error
/// is more informative (the stream failed before the sentinel was written, which is why the remote
/// saw no `done`), so it wins over `settle`'s classification of the remote stderr.
pub fn settle_upload<T>(pool: &SshPool, host: &str, res: AppResult<(Exit, AppResult<T>)>) -> AppResult<T> {
    if let Ok((exit, Err(local))) = &res {
        if exit.code != 255 && exit.stderr.contains("upload was interrupted") {
            pool.set_status(host, HostState::Connected, None);
            return Err(local.clone());
        }
    }
    settle(pool, host, res)
}

/// Upload `sources` into the remote folder `dest` whose current entries are `existing`.
/// Blocking: call from `spawn_blocking`. Returns the final names, in source order.
pub fn upload_remote(pool: &SshPool, host: &str, dest: &str, existing: &[Entry], sources: Vec<Source>) -> AppResult<Vec<String>> {
    validate_host(host)?;
    let mut taken: HashSet<String> = existing.iter().map(|e| e.name.clone()).collect();
    let names: Vec<String> = sources.iter().map(|s| unique_name(&mut taken, &s.name, s.is_dir)).collect();
    let items: Vec<(Source, String)> = sources.into_iter().zip(names.iter().cloned()).collect();
    let res = run_piped(ssh_command(pool, host, &upload_cmd(dest, &names)), TRANSFER_TIMEOUT, move |stdin, _stdout| {
        write_upload_stream(stdin, &items)
    });
    settle_upload(pool, host, res)?;
    Ok(names)
}

/// Download the remote file or folder `abs` into `downloads`. Blocking: call from `spawn_blocking`.
pub fn download_remote(pool: &SshPool, host: &str, abs: &str, downloads: &Path) -> AppResult<PathBuf> {
    validate_host(host)?;
    let (parent, name) = split_parent(abs)?;
    let into = downloads.to_path_buf();
    let res = run_piped(ssh_command(pool, host, &download_cmd(&parent, &name)), TRANSFER_TIMEOUT, move |stdin, stdout| {
        drop(stdin);
        unpack_to_staging(stdout, &into)
    });
    // On failure the staging dir inside `res` is dropped, which removes it.
    let staging = settle(pool, host, res)?;
    finish_download(staging.path(), &name, downloads)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::fs::symlink;

    fn names_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> =
            fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn src(path: &Path) -> Source {
        check_sources(&[path.to_str().unwrap().to_string()]).unwrap().remove(0)
    }

    #[test]
    fn candidate_follows_finder_style() {
        assert_eq!(candidate("report.md", false, 0), "report.md");
        assert_eq!(candidate("report.md", false, 1), "report (1).md");
        assert_eq!(candidate("report.md", false, 2), "report (2).md");
        assert_eq!(candidate("assets", true, 1), "assets (1)");
        assert_eq!(candidate("v1.2", true, 1), "v1.2 (1)");
        assert_eq!(candidate(".env", false, 1), ".env (1)");
        assert_eq!(candidate("a.tar.gz", false, 1), "a.tar (1).gz");
        assert_eq!(candidate("x (1).md", false, 1), "x (1) (1).md");
        assert_eq!(candidate("Makefile", false, 1), "Makefile (1)");
    }

    #[test]
    fn unique_name_skips_taken_and_records_its_pick() {
        let mut taken: HashSet<String> = ["report.md", "report (1).md"].iter().map(|s| s.to_string()).collect();
        assert_eq!(unique_name(&mut taken, "report.md", false), "report (2).md");
        assert_eq!(unique_name(&mut taken, "new.md", false), "new.md");
        // Two items with the same name in one drop get distinct names.
        assert_eq!(unique_name(&mut taken, "a.png", false), "a.png");
        assert_eq!(unique_name(&mut taken, "a.png", false), "a (1).png");
    }

    #[test]
    fn check_sources_validates_paths_and_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::write(p.join("a.md"), "x").unwrap();
        fs::create_dir(p.join("d")).unwrap();
        symlink(p.join("d"), p.join("link")).unwrap();
        symlink(p.join("missing"), p.join("dangling")).unwrap();

        assert!(matches!(check_sources(&[]), Err(AppError::InvalidPath(_))));
        assert!(matches!(check_sources(&["rel/a.md".into()]), Err(AppError::InvalidPath(_))));
        assert!(matches!(check_sources(&[format!("{}/a\nb", p.display())]), Err(AppError::InvalidPath(_))));
        assert!(matches!(check_sources(&[format!("{}/nope", p.display())]), Err(AppError::NotFound(_))));

        let fifo = p.join("pipe");
        assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
        assert!(matches!(check_sources(&[fifo.to_str().unwrap().into()]), Err(AppError::InvalidPath(_))));

        let got = check_sources(&[
            format!("{}/a.md", p.display()),
            format!("{}/d", p.display()),
            format!("{}/link", p.display()),
            format!("{}/dangling", p.display()),
        ])
        .unwrap();
        let summary: Vec<_> = got.iter().map(|s| (s.name.as_str(), s.is_dir)).collect();
        // A symlink to a folder is not a folder: it is copied as a link.
        assert_eq!(summary, [("a.md", false), ("d", true), ("link", false), ("dangling", false)]);
    }

    #[test]
    fn place_never_replaces_an_existing_item() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("x.md"), "old").unwrap();
        let staging = staging_in(dir.path(), ".remora-upload.").unwrap();
        let staged = staging.path().join("0");
        fs::write(&staged, "new").unwrap();
        assert_eq!(place(&staged, dir.path(), "x.md", false).unwrap(), "x (1).md");
        assert_eq!(fs::read_to_string(dir.path().join("x.md")).unwrap(), "old");
        assert_eq!(fs::read_to_string(dir.path().join("x (1).md")).unwrap(), "new");
    }

    #[test]
    fn place_treats_case_insensitive_names_as_taken() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Report.md"), "old").unwrap();
        if !dir.path().join("report.md").exists() {
            return; // case-sensitive volume: nothing to check here
        }
        let staging = staging_in(dir.path(), ".remora-download.").unwrap();
        let staged = staging.path().join("report.md");
        fs::write(&staged, "new").unwrap();
        assert_eq!(place(&staged, dir.path(), "report.md", false).unwrap(), "report (1).md");
        assert_eq!(fs::read_to_string(dir.path().join("Report.md")).unwrap(), "old");
    }

    #[test]
    fn upload_local_copies_tree_keeps_symlinks_and_renames_on_conflict() {
        let from = tempfile::tempdir().unwrap();
        let f = from.path();
        fs::create_dir_all(f.join("assets/deep")).unwrap();
        fs::write(f.join("assets/deep/b c.md"), "deep").unwrap();
        symlink("deep/b c.md", f.join("assets/link.md")).unwrap();
        fs::write(f.join("shot.png"), "png").unwrap();
        let to = tempfile::tempdir().unwrap();
        let t = to.path();
        let sources = vec![src(&f.join("assets")), src(&f.join("shot.png"))];

        assert_eq!(upload_local(t, &sources).unwrap(), ["assets", "shot.png"]);
        assert_eq!(fs::read_to_string(t.join("assets/deep/b c.md")).unwrap(), "deep");
        assert_eq!(fs::read_link(t.join("assets/link.md")).unwrap(), PathBuf::from("deep/b c.md"));
        assert_eq!(fs::read_to_string(t.join("shot.png")).unwrap(), "png");

        assert_eq!(upload_local(t, &sources).unwrap(), ["assets (1)", "shot (1).png"]);
        assert_eq!(names_in(t), ["assets", "assets (1)", "shot (1).png", "shot.png"]);
    }

    #[test]
    fn upload_local_same_basename_in_one_drop() {
        let from = tempfile::tempdir().unwrap();
        let f = from.path();
        fs::create_dir_all(f.join("x")).unwrap();
        fs::create_dir_all(f.join("y")).unwrap();
        fs::write(f.join("x/a.png"), "1").unwrap();
        fs::write(f.join("y/a.png"), "2").unwrap();
        let to = tempfile::tempdir().unwrap();
        let names = upload_local(to.path(), &[src(&f.join("x/a.png")), src(&f.join("y/a.png"))]).unwrap();
        assert_eq!(names, ["a.png", "a (1).png"]);
        assert_eq!(fs::read_to_string(to.path().join("a (1).png")).unwrap(), "2");
        assert_eq!(names_in(to.path()), ["a (1).png", "a.png"]);
    }

    #[test]
    fn upload_local_rejects_bad_destinations_and_leaves_no_staging() {
        let from = tempfile::tempdir().unwrap();
        let f = from.path();
        fs::create_dir_all(f.join("proj/sub")).unwrap();
        fs::write(f.join("file.md"), "x").unwrap();

        let into_itself = upload_local(&f.join("proj/sub"), &[src(&f.join("proj"))]);
        assert!(matches!(into_itself, Err(AppError::InvalidPath(_))), "got {into_itself:?}");
        assert!(matches!(upload_local(&f.join("nope"), &[src(&f.join("file.md"))]), Err(AppError::NotFound(_))));
        assert!(matches!(upload_local(&f.join("file.md"), &[src(&f.join("file.md"))]), Err(AppError::InvalidPath(_))));
        assert_eq!(names_in(&f.join("proj/sub")), Vec::<String>::new());

        // A source that vanishes after validation fails mid-copy; the staging dir is still removed.
        let gone = src(&f.join("file.md"));
        fs::remove_file(f.join("file.md")).unwrap();
        let to = tempfile::tempdir().unwrap();
        assert!(upload_local(to.path(), &[gone]).is_err());
        assert_eq!(names_in(to.path()), Vec::<String>::new());
    }

    #[test]
    fn download_local_saves_file_and_folder_without_overwriting() {
        let proj = tempfile::tempdir().unwrap();
        let p = proj.path();
        fs::create_dir_all(p.join("docs/img")).unwrap();
        fs::write(p.join("docs/img/a.png"), "a").unwrap();
        fs::write(p.join("docs/report.md"), "r").unwrap();
        let dl = tempfile::tempdir().unwrap();
        let d = dl.path();

        assert_eq!(download_local(&p.join("docs/report.md"), d).unwrap(), d.join("report.md"));
        assert_eq!(download_local(&p.join("docs/report.md"), d).unwrap(), d.join("report (1).md"));
        assert_eq!(download_local(&p.join("docs"), d).unwrap(), d.join("docs"));
        assert_eq!(fs::read_to_string(d.join("docs/img/a.png")).unwrap(), "a");
        assert!(matches!(download_local(&p.join("nope"), d), Err(AppError::NotFound(_))));
        assert_eq!(names_in(d), ["docs", "report (1).md", "report.md"]);
    }

    #[test]
    fn download_local_rejects_a_source_that_contains_downloads() {
        let outer = tempfile::tempdir().unwrap();
        let o = outer.path();
        let downloads = o.join("Downloads");
        fs::create_dir_all(downloads.join("sub")).unwrap();
        fs::write(downloads.join("sub/a.md"), "x").unwrap();

        // `o` is an ancestor of `downloads`: staging inside `downloads` would recurse into itself.
        let ancestor = download_local(o, &downloads);
        assert!(matches!(ancestor, Err(AppError::InvalidPath(_))), "got {ancestor:?}");
        assert_eq!(names_in(&downloads), ["sub"]);

        // `downloads` itself is also its own ancestor.
        let same = download_local(&downloads, &downloads);
        assert!(matches!(same, Err(AppError::InvalidPath(_))), "got {same:?}");
        assert_eq!(names_in(&downloads), ["sub"]);
    }

    use crate::ssh::{HostState, HostStatus, StatusSink};
    use std::process::Command;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    fn pool_with_log() -> (SshPool, Arc<Mutex<Vec<HostStatus>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let l = log.clone();
        let sink: StatusSink = Arc::new(move |s| l.lock().unwrap().push(s));
        (SshPool::new(PathBuf::from("/Users/me/.ssh"), sink), log)
    }

    fn sh(script: &str) -> Command {
        let mut c = Command::new("sh");
        c.args(["-c", script]);
        c
    }

    #[test]
    fn upload_cmd_quotes_and_never_overwrites() {
        let cmd = upload_cmd("/r/d i", &["a b's.md".to_string(), "-x".to_string()]);
        assert!(cmd.starts_with("set -e; t=$(mktemp -d '/r/d i/.remora-upload.XXXXXX'); trap 'rm -rf \"$t\"' EXIT; tar -xf - -C \"$t\"; if [ ! -e \"$t\"/done ]; then echo 'upload was interrupted' >&2; exit 1; fi"), "{cmd}");
        assert!(cmd.contains(r#"; mv -n -T -- "$t"/i/'a b'\''s.md' '/r/d i/a b'\''s.md' || true; "#), "{cmd}");
        assert!(cmd.contains(r#"if [ -e "$t"/i/'a b'\''s.md' ] || [ -L "$t"/i/'a b'\''s.md' ]; then printf '%s\n' 'a b'\''s.md already exists, try again' >&2; exit 1; fi"#), "{cmd}");
        assert!(cmd.contains(r#"mv -n -T -- "$t"/i/'-x' '/r/d i/-x' || true"#), "{cmd}");
    }

    #[test]
    fn download_cmd_and_split_parent() {
        assert_eq!(download_cmd("/r/p q", "-it's"), r"tar -cf - -C '/r/p q' -- '-it'\''s'");
        assert_eq!(split_parent("/a/b c").unwrap(), ("/a".to_string(), "b c".to_string()));
        assert_eq!(split_parent("/b").unwrap(), ("/".to_string(), "b".to_string()));
        assert!(matches!(split_parent("/"), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn upload_names_are_unique_within_a_drop() {
        let existing: HashSet<String> = ["a.png".to_string()].into();
        let mut taken = existing;
        let names: Vec<_> = ["a.png", "a.png", "b"].iter().map(|n| unique_name(&mut taken, n, false)).collect();
        assert_eq!(names, ["a (1).png", "a (2).png", "b"]);
    }

    #[test]
    fn run_piped_streams_stdin_to_stdout_and_reports_exit() {
        let (exit, io) = run_piped(sh("cat; echo warn >&2; exit 3"), Duration::from_secs(5), |mut stdin, mut stdout| {
            stdin.write_all(b"hello").map_err(|e| AppError::Other(e.to_string()))?;
            drop(stdin);
            let mut out = String::new();
            stdout.read_to_string(&mut out).map_err(|e| AppError::Other(e.to_string()))?;
            Ok(out)
        })
        .unwrap();
        assert_eq!(io.unwrap(), "hello");
        assert_eq!(exit.code, 3);
        assert_eq!(exit.stderr, "warn");
    }

    #[test]
    fn run_piped_kills_the_child_after_the_timeout() {
        let started = Instant::now();
        let res = run_piped(sh("exec sleep 30"), Duration::from_millis(300), |stdin, _| {
            drop(stdin);
            Ok(())
        });
        assert!(matches!(res, Err(AppError::Timeout(_))), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn settle_prefers_the_exit_status_and_updates_host_state() {
        let (pool, log) = pool_with_log();
        let exit = |code: i32, stderr: &str| Exit { code, stderr: stderr.into() };

        let ok = settle(&pool, "h", Ok((exit(0, ""), Ok(7))));
        assert_eq!(ok.unwrap(), 7);
        assert_eq!(log.lock().unwrap().last().unwrap().state, HostState::Connected);

        let broken_pipe: AppResult<()> = Err(AppError::Other("Broken pipe".into()));
        let failed = settle(&pool, "h", Ok((exit(1, "mktemp: failed: No such file or directory"), broken_pipe)));
        assert!(matches!(failed, Err(AppError::NotFound(_))), "got {failed:?}");

        let down = settle::<()>(&pool, "h", Ok((exit(255, "Connection refused"), Ok(()))));
        assert!(matches!(down, Err(AppError::Ssh(ref m)) if m == "Connection refused"), "got {down:?}");
        assert_eq!(log.lock().unwrap().last().unwrap().state, HostState::Error);

        pool.set_status("h", HostState::Connected, None);
        let slow = settle::<()>(&pool, "h", Err(AppError::Timeout("transfer timed out after 600s".into())));
        assert!(matches!(slow, Err(AppError::Timeout(_))));
        assert_eq!(log.lock().unwrap().last().unwrap().state, HostState::Error);
    }

    #[test]
    fn unpack_then_finish_download_renames_on_conflict() {
        let mut b = tar::Builder::new(Vec::new());
        let mut h = tar::Header::new_gnu();
        h.set_size(5);
        h.set_mode(0o644);
        h.set_entry_type(tar::EntryType::Regular);
        b.append_data(&mut h, "docs/a b.md", &b"hello"[..]).unwrap();
        let bytes = b.into_inner().unwrap();

        let dl = tempfile::tempdir().unwrap();
        fs::create_dir(dl.path().join("docs")).unwrap();
        let staging = unpack_to_staging(&bytes[..], dl.path()).unwrap();
        let saved = finish_download(staging.path(), "docs", dl.path()).unwrap();
        assert_eq!(saved, dl.path().join("docs (1)"));
        assert_eq!(fs::read_to_string(saved.join("a b.md")).unwrap(), "hello");
        drop(staging);
        assert_eq!(names_in(dl.path()), ["docs", "docs (1)"]);
    }

    #[test]
    fn unpack_never_writes_outside_staging() {
        // Raw header bytes: a hostile host can send a `..` entry. `Archive::unpack` skips it (nothing is
        // written), so `finish_download` then fails with "nothing was downloaded".
        let mut h = tar::Header::new_gnu();
        h.as_gnu_mut().unwrap().name[..7].copy_from_slice(b"../evil");
        h.set_size(1);
        h.set_mode(0o644);
        h.set_entry_type(tar::EntryType::Regular);
        h.set_cksum();
        let mut b = tar::Builder::new(Vec::new());
        b.append(&h, &b"x"[..]).unwrap();
        let bytes = b.into_inner().unwrap();

        let outer = tempfile::tempdir().unwrap();
        let dl = outer.path().join("Downloads");
        fs::create_dir(&dl).unwrap();
        let res = unpack_to_staging(&bytes[..], &dl).and_then(|s| finish_download(s.path(), "evil", &dl));
        assert!(res.is_err(), "got {res:?}");
        assert!(!outer.path().join("evil").exists());
        assert!(!dl.join("evil").exists());
        assert_eq!(names_in(&dl), Vec::<String>::new());
    }

    #[test]
    fn write_upload_stream_succeeds_and_appends_done_marker() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::write(p.join("a.md"), "content a").unwrap();
        fs::write(p.join("b.txt"), "content b").unwrap();

        let items = vec![
            (src(&p.join("a.md")), "a.md".to_string()),
            (src(&p.join("b.txt")), "b.txt".to_string()),
        ];
        let bytes = {
            let mut v = Vec::new();
            write_upload_stream(&mut v, &items).unwrap();
            v
        };

        // Read the tar archive back and verify entries
        let mut archive = tar::Archive::new(&bytes[..]);
        let mut entry_names = Vec::new();
        for entry in archive.entries().unwrap() {
            let e = entry.unwrap();
            let path = e.path().unwrap();
            entry_names.push(path.to_string_lossy().into_owned());
        }
        assert_eq!(entry_names, ["i/a.md", "i/b.txt", "done"]);
    }

    #[test]
    fn write_upload_stream_fails_without_done_if_source_vanishes() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::write(p.join("a.md"), "content a").unwrap();
        fs::write(p.join("b.txt"), "content b").unwrap();

        let a = src(&p.join("a.md"));
        let b = src(&p.join("b.txt"));
        // Delete b before creating the stream
        fs::remove_file(p.join("b.txt")).unwrap();

        let items = vec![(a, "a.md".to_string()), (b, "b.txt".to_string())];
        let mut bytes = Vec::new();
        let result = write_upload_stream(&mut bytes, &items);
        assert!(result.is_err(), "expected error but got ok");

        // Verify that the bytes do NOT contain a "done" entry and DO contain the first source entry.
        let mut archive = tar::Archive::new(&bytes[..]);
        let entry_paths: Vec<String> = archive
            .entries()
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|e| e.path().ok().map(|p| p.to_string_lossy().into_owned()))
            .collect();
        assert!(!entry_paths.contains(&"done".to_string()), "done marker should not be present on error: {entry_paths:?}");
        assert!(entry_paths.contains(&"i/a.md".to_string()), "first source entry should be present: {entry_paths:?}");
    }

    #[test]
    fn download_target_refuses_the_project_root() {
        assert_eq!(download_target("/w/p", "docs/a.md").unwrap(), "/w/p/docs/a.md");
        assert!(matches!(download_target("/w/p", ""), Err(AppError::InvalidPath(_))));
        assert!(matches!(download_target("/w/p", "docs/.."), Err(AppError::InvalidPath(_))));
        assert!(matches!(download_target("/w/p", "../x"), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn settle_upload_prefers_the_local_error_on_interrupted_upload() {
        let (pool, log) = pool_with_log();

        // (a) exit 1, stderr says the upload was interrupted, and the local side also failed:
        // the local error is more informative than "upload was interrupted", so it wins.
        let exit = Exit { code: 1, stderr: "upload was interrupted".to_string() };
        let local_err: AppResult<()> = Err(AppError::NotFound("file vanished".into()));
        let a = settle_upload(&pool, "h", Ok((exit, local_err)));
        assert!(matches!(a, Err(AppError::NotFound(ref m)) if m == "file vanished"), "got {a:?}");
        assert_eq!(log.lock().unwrap().last().unwrap().state, HostState::Connected);

        // (b) exit 1, stderr is a plain remote failure (no "upload was interrupted"): falls through
        // to `settle`, which classifies the remote stderr instead of using the local error.
        let exit = Exit { code: 1, stderr: "mktemp: failed: No such file or directory".to_string() };
        let local_err: AppResult<()> = Err(AppError::Other("Broken pipe".into()));
        let b = settle_upload(&pool, "h", Ok((exit, local_err)));
        assert!(matches!(b, Err(AppError::NotFound(_))), "got {b:?}");

        // (c) exit 255 (ssh itself failed) even with "upload was interrupted" in stderr: still an
        // Ssh error via `settle`, never the local error.
        let exit = Exit { code: 255, stderr: "upload was interrupted".to_string() };
        let local_err: AppResult<()> = Err(AppError::NotFound("file vanished".into()));
        let c = settle_upload(&pool, "h", Ok((exit, local_err)));
        assert!(matches!(c, Err(AppError::Ssh(_))), "got {c:?}");
    }
}

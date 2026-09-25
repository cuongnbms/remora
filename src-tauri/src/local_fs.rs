//! The local counterpart of `remote_fs`: same results, read with `std::fs` on this machine.

use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

use crate::error::{AppError, AppResult};
use crate::remote_fs::{
    decode_text, encode_image, filter_excluded, parse_nul_list, sort_entries, Entry, EntryKind, FileContent, MAX_FILES,
    MAX_IMAGE, MAX_TEXT,
};

/// The `host` value that marks a project as a folder on this machine.
pub const LOCAL_HOST: &str = "local";

pub fn is_local(host: &str) -> bool {
    host == LOCAL_HOST
}

pub(crate) fn io_err(abs: &str, e: io::Error) -> AppError {
    match e.kind() {
        io::ErrorKind::NotFound => AppError::NotFound(format!("{abs}: no such file or directory")),
        _ => AppError::Other(format!("{abs}: {e}")),
    }
}

/// Like `find -printf '%y%Y'`: `symlink` describes the entry itself, while kind, size
/// and mtime describe what it points to. A dangling symlink is `Other`.
fn entry(dirent: &fs::DirEntry) -> Option<Entry> {
    let name = dirent.file_name().to_string_lossy().into_owned();
    let symlink = dirent.file_type().ok()?.is_symlink();
    let (kind, size, mtime) = match fs::metadata(dirent.path()) {
        Ok(m) => {
            let kind = if m.is_dir() {
                EntryKind::Dir
            } else if m.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            (kind, m.len(), mtime)
        }
        Err(_) => (EntryKind::Other, 0, 0.0),
    };
    Some(Entry { name, kind, symlink, size, mtime })
}

pub fn list_dir(abs: &str) -> AppResult<Vec<Entry>> {
    let mut entries: Vec<Entry> = fs::read_dir(abs)
        .map_err(|e| io_err(abs, e))?
        .filter_map(Result::ok)
        .filter_map(|d| entry(&d))
        .collect();
    sort_entries(&mut entries);
    Ok(entries)
}

/// Read at most `max + 1` bytes so callers can tell the file was longer than `max`.
fn read_capped(abs: &str, max: usize) -> AppResult<Vec<u8>> {
    let file = fs::File::open(abs).map_err(|e| io_err(abs, e))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|e| io_err(abs, e))?;
    Ok(bytes)
}

pub fn read_file(abs: &str) -> AppResult<FileContent> {
    decode_text(read_capped(abs, MAX_TEXT)?, MAX_TEXT)
}

pub fn read_image(abs: &str) -> AppResult<String> {
    encode_image(abs, &read_capped(abs, MAX_IMAGE)?, MAX_IMAGE)
}

pub fn list_files(abs: &str, excludes: &[String]) -> AppResult<Vec<String>> {
    if !Path::new(abs).is_dir() {
        return Err(AppError::NotFound(format!("{abs}: no such directory")));
    }
    let mut files = git_ls_files(abs).unwrap_or_else(|| walk_files(abs, excludes));
    files.truncate(MAX_FILES);
    Ok(filter_excluded(files, excludes))
}

/// `None` when `abs` is not inside a git work tree or git is unavailable.
fn git_ls_files(abs: &str) -> Option<Vec<String>> {
    let inside = Command::new("git").arg("-C").arg(abs).args(["rev-parse", "--is-inside-work-tree"]).output().ok()?;
    if !inside.status.success() {
        return None;
    }
    let out = Command::new("git").arg("-C").arg(abs).args(["ls-files", "-z", "-co", "--exclude-standard"]).output().ok()?;
    out.status.success().then(|| parse_nul_list(&out.stdout))
}

/// Regular files only (symlinks are not followed), pruning `excludes`, like the remote `find`.
fn walk_files(abs: &str, excludes: &[String]) -> Vec<String> {
    let mut files = Vec::new();
    let mut stack = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let dir = if rel.is_empty() { abs.to_string() } else { format!("{abs}/{rel}") };
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for dirent in read.filter_map(Result::ok) {
            let name = dirent.file_name().to_string_lossy().into_owned();
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            match dirent.file_type() {
                Ok(t) if t.is_dir() && !excludes.contains(&name) => stack.push(path),
                Ok(t) if t.is_file() => {
                    files.push(path);
                    if files.len() >= MAX_FILES {
                        return files;
                    }
                }
                _ => {}
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn root() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let abs = dir.path().to_str().unwrap().to_string();
        (dir, abs)
    }

    #[test]
    fn local_host_marker() {
        assert!(is_local("local"));
        assert!(!is_local("devbox"));
    }

    #[test]
    fn list_dir_sorts_and_reports_symlinks() {
        let (dir, abs) = root();
        let p = dir.path();
        fs::create_dir(p.join("src")).unwrap();
        fs::write(p.join("README.md"), "hello").unwrap();
        fs::write(p.join("a.txt"), "x").unwrap();
        symlink(p.join("README.md"), p.join("link.md")).unwrap();
        symlink(p.join("src"), p.join("linked-dir")).unwrap();
        symlink(p.join("missing"), p.join("broken")).unwrap();

        let entries = list_dir(&abs).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["linked-dir", "src", "a.txt", "broken", "link.md", "README.md"]);
        assert_eq!(entries[0].kind, EntryKind::Dir);
        assert!(entries[0].symlink);
        assert!(!entries[1].symlink);
        assert_eq!(entries[3].kind, EntryKind::Other);
        assert_eq!(entries[4].kind, EntryKind::File);
        assert!(entries[4].symlink);
        assert_eq!(entries[5].size, 5);
        assert!(entries[5].mtime > 1_600_000_000.0);
    }

    #[test]
    fn list_dir_missing_is_not_found() {
        let (_dir, abs) = root();
        assert!(matches!(list_dir(&format!("{abs}/nope")), Err(AppError::NotFound(_))));
    }

    #[test]
    fn read_file_decodes_detects_binary_and_truncates() {
        let (dir, abs) = root();
        fs::write(dir.path().join("a.md"), "xin chào").unwrap();
        fs::write(dir.path().join("b.bin"), [b'a', 0, b'b']).unwrap();
        fs::write(dir.path().join("big.txt"), vec![b'x'; MAX_TEXT + 10]).unwrap();

        let ok = read_file(&format!("{abs}/a.md")).unwrap();
        assert_eq!(ok.content, "xin chào");
        assert!(!ok.truncated);
        assert!(matches!(read_file(&format!("{abs}/b.bin")), Err(AppError::Binary(_))));
        let big = read_file(&format!("{abs}/big.txt")).unwrap();
        assert!(big.truncated);
        assert_eq!(big.content.len(), MAX_TEXT);
        assert!(matches!(read_file(&format!("{abs}/nope.md")), Err(AppError::NotFound(_))));
    }

    #[test]
    fn read_image_builds_data_url_and_caps_size() {
        let (dir, abs) = root();
        fs::write(dir.path().join("x.png"), b"hi").unwrap();
        fs::write(dir.path().join("huge.png"), vec![0u8; MAX_IMAGE + 1]).unwrap();
        assert_eq!(read_image(&format!("{abs}/x.png")).unwrap(), "data:image/png;base64,aGk=");
        assert!(matches!(read_image(&format!("{abs}/huge.png")), Err(AppError::TooLarge(_))));
    }

    #[test]
    fn list_files_walks_without_git_and_skips_excludes() {
        let (dir, abs) = root();
        let p = dir.path();
        for d in ["docs/deep", "node_modules/x", "target", "src/dist"] {
            fs::create_dir_all(p.join(d)).unwrap();
        }
        for f in ["a.md", "docs/deep/b c.md", "node_modules/x/i.js", "target/t", "src/dist/o.js", "src/m.rs"] {
            fs::write(p.join(f), "").unwrap();
        }
        symlink(p.join("a.md"), p.join("link.md")).unwrap();

        let mut files = list_files(&abs, &crate::config::Settings::default().excludes).unwrap();
        files.sort();
        assert_eq!(files, ["a.md", "docs/deep/b c.md", "src/m.rs"]);

        let mut files = list_files(&abs, &["docs".to_string()]).unwrap();
        files.sort();
        assert_eq!(files, ["a.md", "node_modules/x/i.js", "src/dist/o.js", "src/m.rs", "target/t"]);
    }

    #[test]
    fn list_files_uses_git_inside_a_work_tree() {
        let (dir, abs) = root();
        let p = dir.path();
        let git = |args: &[&str]| {
            let ok = Command::new("git").arg("-C").arg(p).args(args).output().unwrap().status.success();
            assert!(ok, "git {args:?} failed");
        };
        git(&["init", "-q"]);
        fs::write(p.join(".gitignore"), "ignored.log\n").unwrap();
        fs::write(p.join("tracked.md"), "").unwrap();
        fs::write(p.join("ignored.log"), "").unwrap();
        fs::create_dir(p.join("dist")).unwrap();
        fs::write(p.join("dist/out.js"), "").unwrap();
        git(&["add", "-f", "tracked.md", "dist/out.js"]);
        fs::write(p.join("untracked.md"), "").unwrap();

        let mut files = list_files(&abs, &crate::config::Settings::default().excludes).unwrap();
        files.sort();
        assert_eq!(files, [".gitignore", "tracked.md", "untracked.md"]);
    }
}

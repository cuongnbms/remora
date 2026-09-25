use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::paths::{find_names, sq};
use crate::ssh::SshPool;

pub const MAX_TEXT: usize = 2_097_152;
pub const MAX_IMAGE: usize = 5_242_880;
pub const MAX_FILES: usize = 50_000;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub kind: EntryKind,
    pub symlink: bool,
    pub size: u64,
    pub mtime: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub truncated: bool,
}

pub fn list_dir_cmd(abs: &str) -> String {
    format!(r"find {} -mindepth 1 -maxdepth 1 -printf '%y%Y\t%s\t%T@\t%f\0'", sq(abs))
}

pub fn parse_list_dir(out: &[u8]) -> Vec<Entry> {
    let mut entries: Vec<Entry> = out
        .split(|b| *b == 0)
        .filter(|r| !r.is_empty())
        .filter_map(|rec| {
            let s = String::from_utf8_lossy(rec);
            let mut it = s.splitn(4, '\t');
            let types: Vec<char> = it.next()?.chars().collect();
            let size = it.next()?.parse().unwrap_or(0);
            let mtime = it.next()?.parse().unwrap_or(0.0);
            let name = it.next()?.to_string();
            let kind = match types.get(1) {
                Some('d') => EntryKind::Dir,
                Some('f') => EntryKind::File,
                _ => EntryKind::Other,
            };
            Some(Entry { name, kind, symlink: types.first() == Some(&'l'), size, mtime })
        })
        .collect();
    sort_entries(&mut entries);
    entries
}

/// Directories first, then case-insensitive by name.
pub fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        (a.kind != EntryKind::Dir)
            .cmp(&(b.kind != EntryKind::Dir))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

pub fn read_file_cmd(abs: &str) -> String {
    format!("head -c {} -- {}", MAX_TEXT + 1, sq(abs))
}

pub fn decode_text(mut bytes: Vec<u8>, max: usize) -> AppResult<FileContent> {
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Err(AppError::Binary("binary file".into()));
    }
    let truncated = bytes.len() > max;
    bytes.truncate(max);
    Ok(FileContent { content: String::from_utf8_lossy(&bytes).into_owned(), truncated })
}

pub fn read_image_cmd(abs: &str) -> String {
    format!("head -c {} -- {}", MAX_IMAGE + 1, sq(abs))
}

pub fn encode_image(path: &str, bytes: &[u8], max: usize) -> AppResult<String> {
    if bytes.len() > max {
        return Err(AppError::TooLarge(format!("image larger than {} bytes", max)));
    }
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn list_files_cmd(abs: &str, excludes: &[String]) -> String {
    let q = sq(abs);
    let prune = find_names(excludes);
    format!(
        r"if git -C {q} rev-parse --is-inside-work-tree >/dev/null 2>&1; then git -C {q} ls-files -z -co --exclude-standard; else find {q} \( {prune} \) -prune -o -type f -printf '%P\0' 2>/dev/null; fi | head -z -n {MAX_FILES}"
    )
}

pub fn parse_nul_list(out: &[u8]) -> Vec<String> {
    out.split(|b| *b == 0)
        .filter(|r| !r.is_empty())
        .map(|r| String::from_utf8_lossy(r).into_owned())
        .collect()
}

/// Drop paths that have a whole component in `excludes`. `git ls-files` reports
/// tracked files inside ignored directories (`--exclude-standard` only hides untracked
/// ignored files), so the git and find listing branches need the same filter.
pub fn filter_excluded(paths: Vec<String>, excludes: &[String]) -> Vec<String> {
    paths.into_iter().filter(|p| !p.split('/').any(|seg| excludes.iter().any(|n| n == seg))).collect()
}

pub async fn list_dir(pool: &SshPool, host: &str, abs: &str) -> AppResult<Vec<Entry>> {
    let out = pool.run_ok(host, &list_dir_cmd(abs)).await?;
    Ok(parse_list_dir(&out))
}

pub async fn read_file(pool: &SshPool, host: &str, abs: &str) -> AppResult<FileContent> {
    let out = pool.run_ok(host, &read_file_cmd(abs)).await?;
    decode_text(out, MAX_TEXT)
}

pub async fn read_image(pool: &SshPool, host: &str, abs: &str) -> AppResult<String> {
    let out = pool.run_ok(host, &read_image_cmd(abs)).await?;
    encode_image(abs, &out, MAX_IMAGE)
}

pub async fn list_files(pool: &SshPool, host: &str, abs: &str, excludes: &[String]) -> AppResult<Vec<String>> {
    let out = pool.run_ok(host, &list_files_cmd(abs, excludes)).await?;
    Ok(filter_excluded(parse_nul_list(&out), excludes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dir_cmd_quotes_path_and_follows_symlink_types() {
        let cmd = list_dir_cmd("/r/it's dir");
        assert!(cmd.starts_with(r"find '/r/it'\''s dir' -mindepth 1 -maxdepth 1 -printf "));
        assert!(cmd.contains(r"'%y%Y\t%s\t%T@\t%f\0'"));
    }

    #[test]
    fn parse_list_dir_sorts_dirs_first_then_name() {
        let raw = b"dd\t4096\t1700000000.5\tsrc\0ff\t10\t1700000001.0\tREADME.md\0lf\t5\t1.0\tlink.md\0ff\t1\t1.0\ta.txt\0ld\t0\t1.0\tlinked-dir\0fp\t0\t1.0\tweird\0";
        let entries = parse_list_dir(raw);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["linked-dir", "src", "a.txt", "link.md", "README.md", "weird"]);
        assert_eq!(entries[0].kind, EntryKind::Dir);
        assert!(entries[0].symlink);
        assert_eq!(entries[1].size, 4096);
        assert_eq!(entries[1].mtime, 1700000000.5);
        assert!(entries[3].symlink);
        assert_eq!(entries[3].kind, EntryKind::File);
        assert_eq!(entries[5].kind, EntryKind::Other);
    }

    #[test]
    fn parse_list_dir_keeps_tabs_inside_names() {
        let entries = parse_list_dir(b"ff\t1\t1.0\tweird\tname.md\0");
        assert_eq!(entries[0].name, "weird\tname.md");
    }

    #[test]
    fn decode_text_detects_binary_and_truncation() {
        assert!(matches!(decode_text(vec![b'a', 0, b'b'], 10), Err(AppError::Binary(_))));
        let ok = decode_text("xin chào".as_bytes().to_vec(), 100).unwrap();
        assert_eq!(ok.content, "xin chào");
        assert!(!ok.truncated);
        let cut = decode_text(b"0123456789AB".to_vec(), 10).unwrap();
        assert_eq!(cut.content, "0123456789");
        assert!(cut.truncated);
    }

    #[test]
    fn read_file_cmd_reads_one_byte_past_limit() {
        assert_eq!(read_file_cmd("/r/a.md"), "head -c 2097153 -- '/r/a.md'");
        assert_eq!(read_image_cmd("/r/a.png"), "head -c 5242881 -- '/r/a.png'");
    }

    #[test]
    fn encode_image_builds_data_url() {
        assert_eq!(encode_image("/r/x.PNG", b"hi", 10).unwrap(), "data:image/png;base64,aGk=");
        assert!(encode_image("/r/x.svg", b"<svg/>", 10).unwrap().starts_with("data:image/svg+xml;base64,"));
        assert!(encode_image("/r/x.bin", b"x", 10).unwrap().starts_with("data:application/octet-stream;base64,"));
        assert!(matches!(encode_image("/r/x.png", b"0123456789A", 10), Err(AppError::TooLarge(_))));
    }

    #[test]
    fn list_files_cmd_prefers_git_and_caps_output() {
        let cmd = list_files_cmd("/r/p q", &["node_modules".to_string(), "venv".into()]);
        assert!(cmd.contains("git -C '/r/p q' rev-parse --is-inside-work-tree"));
        assert!(cmd.contains("git -C '/r/p q' ls-files -z -co --exclude-standard"));
        assert!(cmd.contains(r"\( -name 'node_modules' -o -name 'venv' \) -prune"), "{cmd}");
        assert!(list_files_cmd("/r", &[]).contains(r"\( -false \) -prune"));
        assert!(cmd.ends_with("| head -z -n 50000"));
    }

    #[test]
    fn parse_nul_list_skips_empty() {
        assert_eq!(parse_nul_list(b"a.md\0docs/b c.md\0\0"), vec!["a.md", "docs/b c.md"]);
    }

    // This is the exact composition `list_files` applies to remote output, covering the
    // git branch (which lists tracked files inside ignored directories) and the find branch.
    #[test]
    fn list_files_result_drops_paths_inside_excluded_dirs() {
        let raw = b"ok.md\0node_modules/x.js\0dist/a\0target/debug/b\0.venv/lib/c\0.git/config\0src/deep/target/keep.md\0docs/node_modules.md\0";
        let excludes = crate::config::Settings::default().excludes;
        let files = filter_excluded(parse_nul_list(raw), &excludes);
        assert_eq!(files, ["ok.md", "docs/node_modules.md"]);
        let custom = filter_excluded(parse_nul_list(b"ok.md\0logs/a\0node_modules/x.js\0"), &["logs".to_string()]);
        assert_eq!(custom, ["ok.md", "node_modules/x.js"]);
    }
}

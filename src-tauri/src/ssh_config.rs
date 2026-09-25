use std::fs;
use std::path::{Path, PathBuf};

const MAX_DEPTH: u8 = 5;

pub fn list_hosts(home: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(content) = fs::read_to_string(home.join(".ssh").join("config")) {
        parse_into(&content, home, &mut out, 0);
    }
    out
}

fn parse_into(content: &str, home: &Path, out: &mut Vec<String>, depth: u8) {
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(i) = line.find(|c: char| c.is_whitespace() || c == '=') else { continue };
        let key = line[..i].to_ascii_lowercase();
        let value = line[i..].trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();
        match key.as_str() {
            "host" => {
                for h in value.split_whitespace() {
                    if h.contains(['*', '?', '!']) || out.iter().any(|x| x == h) {
                        continue;
                    }
                    out.push(h.to_string());
                }
            }
            "include" if depth < MAX_DEPTH => {
                for pattern in value.split_whitespace() {
                    for file in expand_include(pattern, home) {
                        if let Ok(s) = fs::read_to_string(&file) {
                            parse_into(&s, home, out, depth + 1);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn expand_include(pattern: &str, home: &Path) -> Vec<PathBuf> {
    let full = if let Some(rest) = pattern.strip_prefix("~/") {
        home.join(rest)
    } else if pattern.starts_with('/') {
        PathBuf::from(pattern)
    } else {
        home.join(".ssh").join(pattern)
    };
    match glob::glob(&full.to_string_lossy()) {
        Ok(paths) => paths.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_concrete_hosts_and_follows_includes() {
        let home = tempfile::tempdir().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(ssh.join("conf.d")).unwrap();
        fs::write(
            ssh.join("config"),
            "# comment\nHost devbox devbox-alt\n  HostName 10.0.0.5\nHost *\n  ServerAliveInterval 30\nHost=gpu-box\nHost !bad *.corp\n  include conf.d/*\nHost devbox\n",
        )
        .unwrap();
        fs::write(ssh.join("conf.d").join("work"), "Host work-1\nHost work-?\n").unwrap();
        assert_eq!(list_hosts(home.path()), vec!["devbox", "devbox-alt", "gpu-box", "work-1"]);
    }

    #[test]
    fn missing_config_gives_empty_list() {
        let home = tempfile::tempdir().unwrap();
        assert!(list_hosts(home.path()).is_empty());
    }

    #[test]
    fn include_cycles_stop_at_depth_limit() {
        let home = tempfile::tempdir().unwrap();
        let ssh = home.path().join(".ssh");
        fs::create_dir_all(&ssh).unwrap();
        fs::write(ssh.join("config"), "Host a\nInclude config\n").unwrap();
        assert_eq!(list_hosts(home.path()), vec!["a"]);
    }
}

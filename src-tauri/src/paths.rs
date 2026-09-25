use crate::error::{AppError, AppResult};

/// Single-quote a string for a POSIX shell: `it's` -> `'it'\''s'`.
pub fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A `find` test matching any of `names` exactly (`-name 'a' -o -name 'b'`), or `-false` for none.
/// Names are validated to hold no glob characters (see `config::validate_excludes`).
pub fn find_names<S: AsRef<str>>(names: &[S]) -> String {
    if names.is_empty() {
        return "-false".to_string();
    }
    names.iter().map(|n| format!("-name {}", sq(n.as_ref()))).collect::<Vec<_>>().join(" -o ")
}

/// Join a project-relative path onto an absolute root, refusing to leave the root.
pub fn resolve(root: &str, rel: &str) -> AppResult<String> {
    if rel.contains('\0') || rel.contains('\n') {
        return Err(AppError::InvalidPath(format!("illegal character in {rel:?}")));
    }
    if rel.starts_with('/') {
        return Err(AppError::InvalidPath(format!("{rel} must be relative")));
    }
    let mut parts: Vec<&str> = Vec::new();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(AppError::InvalidPath(format!("{rel} leaves the project root")));
                }
            }
            s => parts.push(s),
        }
    }
    let root = root.trim_end_matches('/');
    if parts.is_empty() {
        Ok(if root.is_empty() { "/".to_string() } else { root.to_string() })
    } else {
        Ok(format!("{}/{}", root, parts.join("/")))
    }
}

/// Hosts are ssh aliases or user@host; never allow option injection or shell metacharacters.
pub fn validate_host(host: &str) -> AppResult<()> {
    let ok = !host.is_empty()
        && !host.starts_with('-')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || "._-@:".contains(c));
    if ok { Ok(()) } else { Err(AppError::InvalidPath(format!("invalid host {host:?}"))) }
}

pub fn validate_root(path: &str) -> AppResult<()> {
    if path.starts_with('/') && !path.contains('\0') && !path.contains('\n') {
        Ok(())
    } else {
        Err(AppError::InvalidPath(format!("project path must be absolute: {path:?}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sq_wraps_and_escapes() {
        assert_eq!(sq("a b"), "'a b'");
        assert_eq!(sq("it's"), r"'it'\''s'");
        assert_eq!(sq("docs/Kế hoạch 'v2'.md"), r"'docs/Kế hoạch '\''v2'\''.md'");
        assert_eq!(sq(""), "''");
    }

    #[test]
    fn resolve_joins_and_normalises() {
        assert_eq!(resolve("/r", "").unwrap(), "/r");
        assert_eq!(resolve("/r/", "a/./b").unwrap(), "/r/a/b");
        assert_eq!(resolve("/r", "a/../b").unwrap(), "/r/b");
        assert_eq!(resolve("/r", "a//b/").unwrap(), "/r/a/b");
        assert_eq!(resolve("/", "etc").unwrap(), "/etc");
    }

    #[test]
    fn resolve_rejects_escapes() {
        assert!(matches!(resolve("/r", "../x"), Err(AppError::InvalidPath(_))));
        assert!(matches!(resolve("/r", "a/../../x"), Err(AppError::InvalidPath(_))));
        assert!(matches!(resolve("/r", "/etc/passwd"), Err(AppError::InvalidPath(_))));
        assert!(matches!(resolve("/r", "a\0b"), Err(AppError::InvalidPath(_))));
        assert!(matches!(resolve("/r", "a\nb"), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn host_validation() {
        assert!(validate_host("devbox").is_ok());
        assert!(validate_host("user@dev-box.local").is_ok());
        assert!(validate_host("").is_err());
        assert!(validate_host("-oProxyCommand=x").is_err());
        assert!(validate_host("a b").is_err());
        assert!(validate_host("a;b").is_err());
    }

    #[test]
    fn root_validation() {
        assert!(validate_root("/home/me/repo").is_ok());
        assert!(validate_root("relative").is_err());
        assert!(validate_root("/a\nb").is_err());
    }

    #[test]
    fn error_serializes_as_kind_and_message() {
        let json = serde_json::to_string(&AppError::NotFound("x".into())).unwrap();
        assert_eq!(json, r#"{"kind":"NotFound","message":"x"}"#);
    }
}

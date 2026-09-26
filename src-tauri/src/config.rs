use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::paths::{validate_host, validate_root};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub host: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub subgroups: Vec<Subgroup>,
}

/// A group nested inside a top-level group; it cannot hold further subgroups.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subgroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

/// How the sidebar orders groups, subgroups and projects: as stored (the user drags them) or by name.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectOrder {
    #[default]
    Manual,
    Name,
}

pub const MIN_FONT_SIZE: u32 = 10;
pub const MAX_FONT_SIZE: u32 = 24;
const MAX_FONT_NAME: usize = 100;
pub const MAX_EXCLUDES: usize = 100;
const MAX_EXCLUDE_NAME: usize = 255;
/// Names skipped by the watchers and the Quick Open file list unless the user changes them.
pub const DEFAULT_EXCLUDES: [&str; 16] = [
    ".git", "node_modules", "dist", "target", ".venv", "venv", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", ".tox", ".next", ".nuxt", ".gradle", ".idea", "build",
];

/// User preferences. `None` fonts mean "use the built-in default stack". `excludes` are
/// exact file or folder names (never paths or globs) left out of watching and Quick Open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeMode,
    pub ui_font: Option<String>,
    pub code_font: Option<String>,
    pub font_size: u32,
    pub excludes: Vec<String>,
    pub project_order: ProjectOrder,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            ui_font: None,
            code_font: None,
            font_size: 13,
            excludes: DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
            project_order: ProjectOrder::Manual,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub settings: Settings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            groups: Vec::new(),
            settings: Settings::default(),
        }
    }
}

impl Config {
    /// Every project in sidebar order: a group's subgroups come before its own projects.
    pub fn projects(&self) -> impl Iterator<Item = &Project> {
        self.groups.iter().flat_map(|g| {
            g.subgroups.iter().flat_map(|s| s.projects.iter()).chain(g.projects.iter())
        })
    }
}

pub struct ConfigStore {
    path: PathBuf,
    current: Mutex<Config>,
    /// Held for the whole save transaction (write temp file, rename, update memory) so
    /// concurrent saves cannot clobber each other's shared `config.json.tmp`.
    writing: Mutex<()>,
}

impl ConfigStore {
    pub fn load(path: PathBuf) -> (Self, Option<String>) {
        let (config, warning) = match fs::read_to_string(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Config::default(), None),
            Err(e) => (
                Config::default(),
                Some(format!("Cannot read {}: {e}", path.display())),
            ),
            Ok(text) => match serde_json::from_str::<Config>(&text)
                .map_err(|e| e.to_string())
                .and_then(|c| {
                    validate(&c).map_err(|e| e.to_string())?;
                    Ok(c)
                }) {
                Ok(c) => (c, None),
                Err(e) => {
                    let backup = backup_path(&path);
                    let moved = fs::rename(&path, &backup).is_ok();
                    let note = if moved {
                        format!("moved to {}", backup.display())
                    } else {
                        "could not back it up".into()
                    };
                    (
                        Config::default(),
                        Some(format!("config.json was invalid ({e}); {note}")),
                    )
                }
            },
        };
        (
            Self {
                path,
                current: Mutex::new(config),
                writing: Mutex::new(()),
            },
            warning,
        )
    }

    pub fn get(&self) -> Config {
        self.current.lock().unwrap().clone()
    }

    pub fn save(&self, cfg: Config) -> AppResult<()> {
        validate(&cfg)?;
        let json =
            serde_json::to_string_pretty(&cfg).map_err(|e| AppError::Config(e.to_string()))?;
        let _writing = self.writing.lock().unwrap();
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::Config(e.to_string()))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| AppError::Config(e.to_string()))?;
        fs::rename(&tmp, &self.path).map_err(|e| AppError::Config(e.to_string()))?;
        *self.current.lock().unwrap() = cfg;
        Ok(())
    }

    pub fn project(&self, id: &str) -> AppResult<Project> {
        self.current
            .lock()
            .unwrap()
            .projects()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("project {id} not found")))
    }
}

fn validate(cfg: &Config) -> AppResult<()> {
    if cfg.version != 1 {
        return Err(AppError::Config(format!(
            "unsupported config version {}",
            cfg.version
        )));
    }
    let mut ids = HashSet::new();
    for p in cfg.projects() {
        validate_host(&p.host)?;
        validate_root(&p.path)?;
        if !ids.insert(p.id.as_str()) {
            return Err(AppError::Config(format!("duplicate project id {}", p.id)));
        }
    }
    validate_settings(&cfg.settings)
}

fn validate_settings(s: &Settings) -> AppResult<()> {
    if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&s.font_size) {
        return Err(AppError::Config(format!(
            "font size {} is outside {MIN_FONT_SIZE}..={MAX_FONT_SIZE}",
            s.font_size
        )));
    }
    for font in [&s.ui_font, &s.code_font].into_iter().flatten() {
        if font.trim().is_empty()
            || font.chars().count() > MAX_FONT_NAME
            || font.chars().any(char::is_control)
        {
            return Err(AppError::Config(format!("invalid font name {font:?}")));
        }
    }
    validate_excludes(&s.excludes)
}

/// Each entry is matched as a whole name by `find -name`, an inotify regex and plain string
/// comparison, so anything that would mean something different to one of them is refused.
fn validate_excludes(names: &[String]) -> AppResult<()> {
    if names.len() > MAX_EXCLUDES {
        return Err(AppError::Config(format!("at most {MAX_EXCLUDES} excluded names")));
    }
    let mut seen = HashSet::new();
    for name in names {
        let bad = name.is_empty()
            || name == "."
            || name == ".."
            || name.len() > MAX_EXCLUDE_NAME
            || name.trim() != name
            || name.chars().any(|c| c.is_control() || matches!(c, '/' | '*' | '?' | '[' | ']' | '\\'));
        if bad {
            return Err(AppError::Config(format!("invalid excluded name {name:?}: use a plain file or folder name")));
        }
        if !seen.insert(name.as_str()) {
            return Err(AppError::Config(format!("excluded name {name:?} is listed twice")));
        }
    }
    Ok(())
}

fn backup_path(path: &Path) -> PathBuf {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "config.json".into());
    path.with_file_name(format!("{name}.bak-{secs}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Config {
        Config {
            version: 1,
            groups: vec![Group {
                id: "g1".into(),
                name: "Work".into(),
                collapsed: false,
                projects: vec![Project {
                    id: "p1".into(),
                    name: "my-repo".into(),
                    host: "devbox".into(),
                    path: "/home/me/my-repo".into(),
                }],
                subgroups: vec![],
            }],
            settings: Settings::default(),
        }
    }

    #[test]
    fn missing_file_loads_default_without_warning() {
        let dir = tempfile::tempdir().unwrap();
        let (store, warning) = ConfigStore::load(dir.path().join("config.json"));
        assert_eq!(store.get(), Config::default());
        assert!(warning.is_none());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("config.json");
        let (store, _) = ConfigStore::load(path.clone());
        store.save(sample()).unwrap();
        let (again, warning) = ConfigStore::load(path.clone());
        assert_eq!(again.get(), sample());
        assert!(warning.is_none());
        assert_eq!(again.project("p1").unwrap().host, "devbox");
        assert!(matches!(again.project("nope"), Err(AppError::NotFound(_))));
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn concurrent_saves_serialize_write_and_memory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let (store, _) = ConfigStore::load(path.clone());
        let store = std::sync::Arc::new(store);
        let workers: Vec<_> = (0..8)
            .map(|worker| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        let mut cfg = sample();
                        cfg.groups[0].projects[0].id = format!("p{worker}-{i}");
                        store.save(cfg).expect("concurrent save failed");
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let (again, warning) = ConfigStore::load(path.clone());
        assert!(warning.is_none());
        assert_eq!(again.get(), store.get());
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn corrupt_file_is_backed_up_and_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, "{not json").unwrap();
        let (store, warning) = ConfigStore::load(path.clone());
        assert_eq!(store.get(), Config::default());
        assert!(warning.unwrap().contains("config.json.bak-"));
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("config.json.bak-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn invalid_loaded_config_is_backed_up_and_reset() {
        let cases = [
            ("unsupported version", r#"{"version":2,"groups":[]}"#),
            (
                "invalid host",
                r#"{"version":1,"groups":[{"id":"g","name":"G","projects":[{"id":"p","name":"P","host":"-oProxyCommand=x","path":"/tmp"}]}]}"#,
            ),
            (
                "invalid root",
                r#"{"version":1,"groups":[{"id":"g","name":"G","projects":[{"id":"p","name":"P","host":"devbox","path":"relative"}]}]}"#,
            ),
            (
                "duplicate project id",
                r#"{"version":1,"groups":[{"id":"g","name":"G","projects":[{"id":"p","name":"P1","host":"devbox","path":"/one"},{"id":"p","name":"P2","host":"devbox","path":"/two"}]}]}"#,
            ),
            ("invalid font size", r#"{"version":1,"groups":[],"settings":{"fontSize":99}}"#),
            ("unknown theme", r#"{"version":1,"groups":[],"settings":{"theme":"blue"}}"#),
        ];

        for (name, json) in cases {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("config.json");
            std::fs::write(&path, json).unwrap();

            let (store, warning) = ConfigStore::load(path);

            assert_eq!(store.get(), Config::default(), "{name}");
            assert!(warning.unwrap().contains("config.json.bak-"), "{name}");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "{name}");
        }
    }

    #[test]
    fn missing_optional_fields_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"version":1,"groups":[{"id":"g","name":"G"}]}"#).unwrap();
        let (store, warning) = ConfigStore::load(path);
        assert!(warning.is_none());
        assert!(store.get().groups[0].projects.is_empty());
        assert!(!store.get().groups[0].collapsed);
        assert!(store.get().groups[0].subgroups.is_empty());
    }

    fn with_subgroup() -> Config {
        let mut cfg = sample();
        cfg.groups[0].subgroups.push(Subgroup {
            id: "s1".into(),
            name: "Api".into(),
            collapsed: true,
            projects: vec![Project {
                id: "p2".into(),
                name: "api".into(),
                host: "devbox".into(),
                path: "/home/me/api".into(),
            }],
        });
        cfg
    }

    #[test]
    fn subgroups_roundtrip_and_their_projects_are_found() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let (store, _) = ConfigStore::load(path.clone());
        store.save(with_subgroup()).unwrap();
        assert_eq!(store.project("p2").unwrap().path, "/home/me/api");
        let (reloaded, warning) = ConfigStore::load(path);
        assert!(warning.is_none());
        assert_eq!(reloaded.get(), with_subgroup());
    }

    #[test]
    fn save_validates_projects_in_subgroups() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConfigStore::load(dir.path().join("config.json"));
        let mut bad_host = with_subgroup();
        bad_host.groups[0].subgroups[0].projects[0].host = "-oProxyCommand=x".into();
        assert!(store.save(bad_host).is_err());
        let mut dup = with_subgroup();
        dup.groups[0].subgroups[0].projects[0].id = "p1".into();
        assert!(matches!(store.save(dup), Err(AppError::Config(_))));
    }

    #[test]
    fn save_rejects_invalid_projects() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConfigStore::load(dir.path().join("config.json"));
        let mut bad_host = sample();
        bad_host.groups[0].projects[0].host = "-oProxyCommand=x".into();
        assert!(store.save(bad_host).is_err());
        let mut bad_path = sample();
        bad_path.groups[0].projects[0].path = "relative".into();
        assert!(store.save(bad_path).is_err());
        let mut dup = sample();
        let p = dup.groups[0].projects[0].clone();
        dup.groups[0].projects.push(p);
        assert!(matches!(store.save(dup), Err(AppError::Config(_))));
        assert_eq!(store.get(), Config::default());
    }

    #[test]
    fn config_without_settings_loads_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"version":1,"groups":[]}"#).unwrap();
        let (store, warning) = ConfigStore::load(path);
        assert!(warning.is_none());
        let s = store.get().settings;
        assert_eq!(s, Settings::default());
        assert_eq!(s.theme, ThemeMode::System);
        assert_eq!(s.font_size, 13);
        assert!(s.ui_font.is_none() && s.code_font.is_none());
        assert!(s.excludes.iter().any(|n| n == "node_modules") && s.excludes.iter().any(|n| n == "venv"));
    }

    #[test]
    fn settings_without_excludes_get_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"version":1,"groups":[],"settings":{"theme":"dark","fontSize":14}}"#).unwrap();
        let (store, warning) = ConfigStore::load(path);
        assert!(warning.is_none());
        assert_eq!(store.get().settings.excludes, Settings::default().excludes);
    }

    #[test]
    fn settings_roundtrip_as_camel_case() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let (store, _) = ConfigStore::load(path.clone());
        let mut cfg = sample();
        cfg.settings = Settings {
            theme: ThemeMode::Dark,
            ui_font: Some("Inter".into()),
            code_font: Some("JetBrains Mono".into()),
            font_size: 15,
            excludes: vec!["node_modules".into(), "my out".into()],
            project_order: ProjectOrder::Name,
        };
        store.save(cfg.clone()).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains(r#""theme": "dark""#));
        assert!(text.contains(r#""codeFont": "JetBrains Mono""#));
        assert!(text.contains(r#""fontSize": 15"#));
        assert!(text.contains(r#""projectOrder": "name""#));
        let (again, warning) = ConfigStore::load(path);
        assert!(warning.is_none());
        assert_eq!(again.get(), cfg);
    }

    #[test]
    fn save_rejects_invalid_settings() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConfigStore::load(dir.path().join("config.json"));
        let bad: Vec<(&str, Settings)> = vec![
            ("font too small", Settings { font_size: 9, ..Settings::default() }),
            ("font too big", Settings { font_size: 25, ..Settings::default() }),
            ("empty ui font", Settings { ui_font: Some("  ".into()), ..Settings::default() }),
            ("long code font", Settings { code_font: Some("x".repeat(101)), ..Settings::default() }),
            ("control char", Settings { ui_font: Some("Inter\n".into()), ..Settings::default() }),
        ];
        let ex = |names: &[&str]| Settings { excludes: names.iter().map(|n| n.to_string()).collect(), ..Settings::default() };
        let bad = bad.into_iter().chain([
            ("empty exclude", ex(&[""])),
            ("dot", ex(&["."])),
            ("dot dot", ex(&[".."])),
            ("path", ex(&["a/b"])),
            ("glob", ex(&["*.log"])),
            ("bracket", ex(&["[ab]"])),
            ("backslash", ex(&["a\\b"])),
            ("padded", ex(&[" build"])),
            ("newline", ex(&["a\nb"])),
            ("duplicate", ex(&["dist", "dist"])),
            ("too many", Settings { excludes: (0..101).map(|i| format!("d{i}")).collect(), ..Settings::default() }),
        ]);
        for (name, settings) in bad {
            let mut cfg = sample();
            cfg.settings = settings;
            assert!(matches!(store.save(cfg), Err(AppError::Config(_))), "{name}");
        }
        for size in [10, 24] {
            let mut cfg = sample();
            cfg.settings.font_size = size;
            assert!(store.save(cfg).is_ok(), "size {size}");
        }
        for names in [vec![], vec!["my out".to_string(), ".cache".into(), "a(b)+c$".into()]] {
            let mut cfg = sample();
            cfg.settings.excludes = names.clone();
            assert!(store.save(cfg).is_ok(), "{names:?}");
        }
    }

    #[test]
    fn local_projects_are_valid() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ConfigStore::load(dir.path().join("config.json"));
        let mut cfg = sample();
        cfg.groups[0].projects[0].host = crate::local_fs::LOCAL_HOST.into();
        cfg.groups[0].projects[0].path = "/Users/me/notes".into();
        store.save(cfg.clone()).unwrap();
        assert_eq!(store.project("p1").unwrap().host, "local");
    }

    #[test]
    fn json_is_camel_case() {
        let json = serde_json::to_string(&sample()).unwrap();
        assert!(json.contains(r#""collapsed":false"#));
        assert!(json.contains(r#""projects":["#));
    }
}

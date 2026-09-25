use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub family: String,
    pub monospace: bool,
}

/// Installed font families, sorted case-insensitively. Hidden system families (".SF…") are skipped.
pub fn list_families() -> Vec<FontFamily> {
    normalize(system_families())
}

fn normalize(mut fonts: Vec<FontFamily>) -> Vec<FontFamily> {
    fonts.retain(|f| !f.family.is_empty() && !f.family.starts_with('.'));
    fonts.sort_by_cached_key(|f| (f.family.to_lowercase(), f.family.clone()));
    fonts.dedup_by(|a, b| a.family == b.family);
    fonts
}

// Uses only Core Text calls that return values instead of panicking: release builds use
// `panic = "abort"`, so a panic inside core-text's attribute accessors would kill the app.
#[cfg(target_os = "macos")]
fn system_families() -> Vec<FontFamily> {
    use core_text::font_collection::{create_for_family, get_family_names};
    use core_text::font_descriptor::SymbolicTraitAccessors;

    get_family_names()
        .iter()
        .map(|name| {
            let family = name.to_string();
            let monospace = create_for_family(&family)
                .and_then(|c| c.get_descriptors())
                .and_then(|d| d.get(0).map(|d| core_text::font::new_from_descriptor(&d, 12.0)))
                .is_some_and(|font| font.symbolic_traits().is_monospace());
            FontFamily { family, monospace }
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn system_families() -> Vec<FontFamily> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(family: &str, monospace: bool) -> FontFamily {
        FontFamily { family: family.into(), monospace }
    }

    #[test]
    fn normalize_sorts_dedups_and_hides_system_families() {
        let out = normalize(vec![f("menlo", true), f(".SF NS", false), f("Arial", false), f("", false), f("Arial", false)]);
        assert_eq!(out, vec![f("Arial", false), f("menlo", true)]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lists_installed_families_with_monospace_flag() {
        let fonts = list_families();
        assert!(fonts.iter().any(|x| x.family == "Menlo" && x.monospace));
        assert!(fonts.iter().any(|x| x.family == "Helvetica" && !x.monospace));
    }
}

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    InvalidPath(String),
    NotFound(String),
    Binary(String),
    TooLarge(String),
    Ssh(String),
    Timeout(String),
    Config(String),
    Other(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (kind, msg) = match self {
            AppError::InvalidPath(m) => ("invalid path", m),
            AppError::NotFound(m) => ("not found", m),
            AppError::Binary(m) => ("binary file", m),
            AppError::TooLarge(m) => ("too large", m),
            AppError::Ssh(m) => ("ssh", m),
            AppError::Timeout(m) => ("timeout", m),
            AppError::Config(m) => ("config", m),
            AppError::Other(m) => ("error", m),
        };
        write!(f, "{kind}: {msg}")
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

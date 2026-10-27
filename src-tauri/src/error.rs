//! Tipo de erro único da aplicação. É serializado como texto simples
//! para que o frontend possa exibi-lo diretamente em um toast.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("Sessão inválida ou expirada. Faça login novamente.")]
    NaoAutenticado,
    #[error("Você não tem permissão para realizar esta ação.")]
    SemPermissao,
    #[error("Conflito de horário: {0}")]
    Conflito(String),
    #[error("Erro no banco de dados: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Erro de arquivo: {0}")]
    Io(#[from] std::io::Error),
    #[error("Erro de dados: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn msg(texto: impl Into<String>) -> Self {
        AppError::Msg(texto.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

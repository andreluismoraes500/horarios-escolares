//! Comandos Tauri expostos ao frontend. Todos recebem o `token` de sessão
//! e validam autenticação + permissão antes de qualquer operação.

pub mod arquivos;
pub mod autogerar;
pub mod auth;
pub mod backup;
pub mod cadastros;
pub mod escolas;
pub mod horarios;
pub mod usuarios;

use crate::db::Db;
use crate::error::AppError;
use std::path::PathBuf;

/// Estado global da aplicação, injetado nos comandos.
pub struct AppState {
    pub db: Db,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }
}

/// Remove espaços e transforma texto vazio em None.
pub fn opcional(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Nome obrigatório (não vazio, até 120 caracteres).
pub fn nome_valido(s: &str, campo: &str) -> Result<String, AppError> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::msg(format!("{campo} é obrigatório.")));
    }
    if t.chars().count() > 120 {
        return Err(AppError::msg(format!("{campo} deve ter no máximo 120 caracteres.")));
    }
    Ok(t.to_string())
}

/// Traduz violações de UNIQUE do SQLite em mensagens amigáveis.
pub fn traduzir(e: rusqlite::Error) -> AppError {
    if let rusqlite::Error::SqliteFailure(f, msg) = &e {
        if f.code == rusqlite::ErrorCode::ConstraintViolation {
            let m = msg.clone().unwrap_or_default();
            if m.contains("UNIQUE") {
                if m.contains("usuarios.email") {
                    return AppError::msg("Já existe um usuário com este e-mail.");
                }
                if m.contains("inicio_min") {
                    return AppError::msg("Já existe uma faixa de horário com este início.");
                }
                return AppError::msg("Já existe um registro com este nome nesta escola.");
            }
            if m.contains("FOREIGN KEY") {
                return AppError::msg("Registro vinculado a outros dados ou referência inválida.");
            }
        }
    }
    AppError::Db(e)
}

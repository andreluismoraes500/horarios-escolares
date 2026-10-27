//! Gravação de arquivos de relatório (PDF/CSV) no caminho escolhido pelo usuário.

use super::AppState;
use crate::auth;
use crate::error::{AppError, Result};
use base64::Engine;
use std::path::PathBuf;
use tauri::State;

/// Recebe o conteúdo em base64 (gerado no frontend) e grava no disco.
/// Só aceita extensões de relatório para limitar o que o app pode gravar.
#[tauri::command]
pub fn salvar_arquivo(
    state: State<AppState>,
    token: String,
    caminho: String,
    conteudo_base64: String,
) -> Result<()> {
    {
        let conn = state.db.conn();
        let ctx = auth::autenticar(&conn, &token)?;
        ctx.exigir(&conn, "relatorios", "ver", None)?;
    }
    let p = PathBuf::from(&caminho);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "pdf" && ext != "csv" {
        return Err(AppError::msg("Só é possível salvar arquivos .pdf ou .csv."));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(conteudo_base64.as_bytes())
        .map_err(|_| AppError::msg("Conteúdo do arquivo inválido."))?;
    std::fs::write(&p, bytes)?;
    Ok(())
}

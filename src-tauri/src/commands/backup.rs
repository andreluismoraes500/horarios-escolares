//! Comandos de backup/restauração (somente Super Admin).

use super::AppState;
use crate::auth;
use crate::backup as bkp;
use crate::db::{config_get, config_set};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize)]
pub struct EntradaBackup {
    pub id: i64,
    pub data: String,
    pub tipo: String,
    pub arquivo: String,
    pub tamanho: i64,
    pub usuario: String,
    pub sucesso: bool,
    pub detalhe: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ConfigBackup {
    /// "off" | "diario" | "semanal"
    pub auto: String,
    pub pasta: String,
    /// Nova senha dos backups automáticos (vazio = manter a atual).
    pub senha: Option<String>,
    pub tem_senha: bool,
    pub pasta_padrao: String,
    pub ultimo: Option<String>,
}

/// Valida a extensão do arquivo de backup.
fn caminho_bak(c: &str) -> Result<PathBuf> {
    let p = PathBuf::from(c);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("bak")) != Some(true) {
        return Err(AppError::msg("O arquivo de backup deve ter a extensão .bak."));
    }
    Ok(p)
}

#[tauri::command]
pub fn exportar_backup(state: State<AppState>, token: String, caminho: String, senha: String) -> Result<u64> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "backup", "criar", None)?;
    let destino = caminho_bak(&caminho)?;
    let tamanho = bkp::exportar(&conn, &state.tmp_dir(), &destino, &senha, &ctx.usuario.email, "manual")?;
    ctx.auditar(&conn, "exportar_backup", "backup", None, &caminho);
    Ok(tamanho)
}

/// Restaura o banco. Após o sucesso, todas as sessões são encerradas (o frontend refaz o login).
#[tauri::command]
pub fn importar_backup(
    state: State<AppState>,
    token: String,
    caminho: String,
    senha: String,
    criar_snapshot: bool,
) -> Result<Option<String>> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "backup", "editar", None)?;
    let origem = caminho_bak(&caminho)?;
    let pasta = config_get(&conn, "backup_pasta")
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| bkp::pasta_padrao(&state.data_dir));
    let snap = bkp::importar(
        &mut conn,
        &state.tmp_dir(),
        &origem,
        &senha,
        &ctx.usuario.email,
        if criar_snapshot { Some(pasta.as_path()) } else { None },
    )?;
    // Os dados de acesso voltaram ao estado do backup: encerra todas as sessões.
    conn.execute("DELETE FROM sessoes", [])?;
    conn.execute(
        "INSERT INTO audit_log (usuario_id, usuario, acao, entidade, detalhe)
         VALUES (NULL, ?1, 'importar_backup', 'backup', ?2)",
        rusqlite::params![ctx.usuario.email, caminho],
    )?;
    Ok(snap.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn listar_backups(state: State<AppState>, token: String) -> Result<Vec<EntradaBackup>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "backup", "ver", None)?;
    let mut st = conn.prepare(
        "SELECT id, data, tipo, arquivo, tamanho, usuario, sucesso, detalhe
         FROM backup_log ORDER BY id DESC LIMIT 200",
    )?;
    let v = st
        .query_map([], |r| {
            Ok(EntradaBackup {
                id: r.get(0)?,
                data: r.get(1)?,
                tipo: r.get(2)?,
                arquivo: r.get(3)?,
                tamanho: r.get(4)?,
                usuario: r.get(5)?,
                sucesso: r.get::<_, i64>(6)? != 0,
                detalhe: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

#[tauri::command]
pub fn obter_config_backup(state: State<AppState>, token: String) -> Result<ConfigBackup> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "backup", "ver", None)?;
    Ok(ConfigBackup {
        auto: config_get(&conn, "backup_auto").unwrap_or_else(|| "off".into()),
        pasta: config_get(&conn, "backup_pasta").unwrap_or_default(),
        senha: None,
        tem_senha: config_get(&conn, "backup_senha").map(|s| !s.is_empty()).unwrap_or(false),
        pasta_padrao: bkp::pasta_padrao(&state.data_dir).to_string_lossy().to_string(),
        ultimo: config_get(&conn, "backup_ultimo"),
    })
}

#[tauri::command]
pub fn salvar_config_backup(state: State<AppState>, token: String, config: ConfigBackup) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "backup", "editar", None)?;
    if !["off", "diario", "semanal"].contains(&config.auto.as_str()) {
        return Err(AppError::msg("Frequência inválida."));
    }
    if let Some(s) = config.senha.as_ref().filter(|s| !s.is_empty()) {
        if s.chars().count() < 6 {
            return Err(AppError::msg("A senha dos backups automáticos deve ter pelo menos 6 caracteres."));
        }
        config_set(&conn, "backup_senha", s)?;
    }
    if config.auto != "off" && config_get(&conn, "backup_senha").unwrap_or_default().is_empty() {
        return Err(AppError::msg("Defina uma senha para criptografar os backups automáticos."));
    }
    config_set(&conn, "backup_auto", &config.auto)?;
    config_set(&conn, "backup_pasta", config.pasta.trim())?;
    ctx.auditar(&conn, "config_backup", "backup", None, &config.auto);
    Ok(())
}

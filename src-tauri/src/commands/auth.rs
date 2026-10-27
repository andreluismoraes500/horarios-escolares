//! Login, logout e sessão persistente.

use super::AppState;
use crate::auth;
use crate::db::models::Usuario;
use crate::error::{AppError, Result};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct SessaoInfo {
    pub token: String,
    pub usuario: Usuario,
}

#[tauri::command]
pub fn login(state: State<AppState>, email: String, senha: String) -> Result<SessaoInfo> {
    let conn = state.db.conn();
    let (token, usuario) = auth::login(&conn, &email, &senha)?;
    conn.execute(
        "INSERT INTO audit_log (usuario_id, usuario, acao, entidade, entidade_id, detalhe)
         VALUES (?1, ?2, 'login', 'usuarios', ?1, '')",
        rusqlite::params![usuario.id, usuario.email],
    )?;
    Ok(SessaoInfo { token, usuario })
}

#[tauri::command]
pub fn logout(state: State<AppState>, token: String) -> Result<()> {
    auth::logout(&state.db.conn(), &token)
}

/// Valida o token salvo localmente ao abrir o app.
#[tauri::command]
pub fn sessao_atual(state: State<AppState>, token: String) -> Result<Usuario> {
    let conn = state.db.conn();
    Ok(auth::autenticar(&conn, &token)?.usuario)
}

#[tauri::command]
pub fn alterar_minha_senha(
    state: State<AppState>,
    token: String,
    senha_atual: String,
    senha_nova: String,
) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    auth::validar_senha(&senha_nova)?;
    let hash: String = conn.query_row(
        "SELECT senha_hash FROM usuarios WHERE id = ?1",
        [ctx.usuario.id],
        |r| r.get(0),
    )?;
    if !auth::verificar_senha(&senha_atual, &hash) {
        return Err(AppError::msg("Senha atual incorreta."));
    }
    conn.execute(
        "UPDATE usuarios SET senha_hash = ?1, atualizado_em = datetime('now') WHERE id = ?2",
        rusqlite::params![auth::hash_senha(&senha_nova)?, ctx.usuario.id],
    )?;
    ctx.auditar(&conn, "alterar_senha", "usuarios", Some(ctx.usuario.id), "");
    Ok(())
}

/// Lista as permissões ("recurso:acao") do papel do usuário logado, para o
/// frontend esconder/desabilitar botões (a validação real continua no backend).
#[tauri::command]
pub fn minhas_permissoes(state: State<AppState>, token: String) -> Result<Vec<String>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let mut st = conn.prepare("SELECT recurso || ':' || acao FROM permissoes WHERE papel = ?1")?;
    let v = st
        .query_map([&ctx.usuario.papel], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(v)
}

//! Gestão de usuários (somente Super Admin e Admin da escola) e log de auditoria.

use super::{nome_valido, traduzir, AppState};
use crate::auth::{self, Ctx};
use crate::db::models::{Usuario, UsuarioInput};
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

const PAPEIS: [&str; 5] = ["super_admin", "admin_escola", "coordenador", "professor", "visualizador"];

fn carregar(conn: &Connection, id: i64) -> Result<Usuario> {
    conn.query_row("SELECT * FROM usuarios WHERE id = ?1", [id], Usuario::from_row)
        .map_err(|_| AppError::msg("Usuário não encontrado."))
}

/// Admin da escola só gerencia usuários da própria escola e nunca super admins.
fn pode_gerenciar(ctx: &Ctx, alvo: &Usuario) -> bool {
    ctx.eh_super() || (alvo.papel != "super_admin" && alvo.escola_id == ctx.usuario.escola_id)
}

/// Valida o papel/escola/professor pretendidos e devolve a escola efetiva.
fn validar_destino(conn: &Connection, ctx: &Ctx, d: &UsuarioInput) -> Result<Option<i64>> {
    if !PAPEIS.contains(&d.papel.as_str()) {
        return Err(AppError::msg("Papel inválido."));
    }
    if !ctx.eh_super() && d.papel == "super_admin" {
        return Err(AppError::SemPermissao);
    }
    let escola = if d.papel == "super_admin" {
        None
    } else if ctx.eh_super() {
        Some(d.escola_id.ok_or_else(|| AppError::msg("Selecione a escola do usuário."))?)
    } else {
        ctx.usuario.escola_id // admin da escola: sempre a própria escola
    };
    if let Some(e) = escola {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM escolas WHERE id = ?1", [e], |r| r.get(0))?;
        if n == 0 {
            return Err(AppError::msg("Escola não encontrada."));
        }
    }
    if let Some(p) = d.professor_id {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM professores WHERE id = ?1 AND escola_id IS ?2",
            params![p, escola],
            |r| r.get(0),
        )?;
        if n == 0 {
            return Err(AppError::msg("O professor vinculado não pertence à escola do usuário."));
        }
    }
    if d.papel == "professor" && d.professor_id.is_none() {
        return Err(AppError::msg("Vincule o usuário a um professor cadastrado para ele ver a própria grade."));
    }
    Ok(escola)
}

fn email_valido(e: &str) -> Result<String> {
    let t = e.trim().to_lowercase();
    let ok = t.len() <= 160 && t.contains('@') && t.rsplit('@').next().map(|d| d.contains('.')).unwrap_or(false);
    if !ok {
        return Err(AppError::msg("E-mail inválido."));
    }
    Ok(t)
}

#[tauri::command]
pub fn listar_usuarios(state: State<AppState>, token: String) -> Result<Vec<Usuario>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "usuarios", "ver", None)?;
    let mut st = conn.prepare(
        "SELECT * FROM usuarios WHERE (?1 IS NULL OR escola_id = ?1) AND (?1 IS NULL OR papel != 'super_admin')
         ORDER BY nome COLLATE NOCASE",
    )?;
    let v = st
        .query_map(params![ctx.usuario.escola_id], Usuario::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

#[tauri::command]
pub fn criar_usuario(state: State<AppState>, token: String, dados: UsuarioInput) -> Result<Usuario> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "usuarios", "criar", None)?;
    let nome = nome_valido(&dados.nome, "O nome")?;
    let email = email_valido(&dados.email)?;
    let senha = dados.senha.clone().unwrap_or_default();
    auth::validar_senha(&senha)?;
    let escola = validar_destino(&conn, &ctx, &dados)?;
    conn.execute(
        "INSERT INTO usuarios (nome, email, senha_hash, papel, escola_id, professor_id, ativo)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![nome, email, auth::hash_senha(&senha)?, dados.papel, escola, dados.professor_id, dados.ativo as i64],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "usuarios", Some(id), &format!("{email} ({})", dados.papel));
    carregar(&conn, id)
}

#[tauri::command]
pub fn atualizar_usuario(
    state: State<AppState>,
    token: String,
    id: i64,
    dados: UsuarioInput,
) -> Result<Usuario> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "usuarios", "editar", None)?;
    let alvo = carregar(&conn, id)?;
    if !pode_gerenciar(&ctx, &alvo) {
        return Err(AppError::SemPermissao);
    }
    if id == ctx.usuario.id && (dados.papel != alvo.papel || !dados.ativo) {
        return Err(AppError::msg("Você não pode alterar o próprio papel nem se desativar."));
    }
    let nome = nome_valido(&dados.nome, "O nome")?;
    let email = email_valido(&dados.email)?;
    let escola = validar_destino(&conn, &ctx, &dados)?;
    conn.execute(
        "UPDATE usuarios SET nome=?1, email=?2, papel=?3, escola_id=?4, professor_id=?5, ativo=?6,
         atualizado_em=datetime('now') WHERE id=?7",
        params![nome, email, dados.papel, escola, dados.professor_id, dados.ativo as i64, id],
    )
    .map_err(traduzir)?;
    if let Some(s) = dados.senha.as_ref().filter(|s| !s.is_empty()) {
        auth::validar_senha(s)?;
        conn.execute(
            "UPDATE usuarios SET senha_hash=?1 WHERE id=?2",
            params![auth::hash_senha(s)?, id],
        )?;
        ctx.auditar(&conn, "redefinir_senha", "usuarios", Some(id), &email);
    }
    if !dados.ativo {
        conn.execute("DELETE FROM sessoes WHERE usuario_id = ?1", [id])?;
    }
    if alvo.papel != dados.papel {
        ctx.auditar(&conn, "mudar_permissao", "usuarios", Some(id), &format!("{email}: {} → {}", alvo.papel, dados.papel));
    } else {
        ctx.auditar(&conn, "editar", "usuarios", Some(id), &email);
    }
    carregar(&conn, id)
}

#[tauri::command]
pub fn excluir_usuario(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "usuarios", "excluir", None)?;
    if id == ctx.usuario.id {
        return Err(AppError::msg("Você não pode excluir o próprio usuário."));
    }
    let alvo = carregar(&conn, id)?;
    if !pode_gerenciar(&ctx, &alvo) {
        return Err(AppError::SemPermissao);
    }
    conn.execute("DELETE FROM usuarios WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "usuarios", Some(id), &alvo.email);
    Ok(())
}

#[derive(Serialize)]
pub struct EntradaAuditoria {
    pub id: i64,
    pub data: String,
    pub usuario: String,
    pub acao: String,
    pub entidade: String,
    pub entidade_id: Option<i64>,
    pub detalhe: Option<String>,
}

#[tauri::command]
pub fn listar_auditoria(
    state: State<AppState>,
    token: String,
    limite: Option<i64>,
    de: Option<String>,
    ate: Option<String>,
) -> Result<Vec<EntradaAuditoria>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "auditoria", "ver", None)?;
    let lim = limite.unwrap_or(200).clamp(1, 5000);
    // Datas no formato AAAA-MM-DD, no horário local do computador.
    let de = de.filter(|d| !d.trim().is_empty());
    let ate = ate.filter(|d| !d.trim().is_empty());
    // Admin da escola só vê ações de usuários da própria escola.
    let mut st = conn.prepare(
        "SELECT id, data, usuario, acao, entidade, entidade_id, detalhe FROM audit_log
         WHERE (?1 IS NULL OR usuario IN (SELECT email FROM usuarios WHERE escola_id = ?1))
           AND (?3 IS NULL OR date(data, 'localtime') >= ?3)
           AND (?4 IS NULL OR date(data, 'localtime') <= ?4)
         ORDER BY id DESC LIMIT ?2",
    )?;
    let v = st
        .query_map(params![ctx.usuario.escola_id, lim, de, ate], |r| {
            Ok(EntradaAuditoria {
                id: r.get(0)?,
                data: r.get(1)?,
                usuario: r.get(2)?,
                acao: r.get(3)?,
                entidade: r.get(4)?,
                entidade_id: r.get(5)?,
                detalhe: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

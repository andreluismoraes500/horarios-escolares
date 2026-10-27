//! CRUD de escolas.

use super::{nome_valido, opcional, traduzir, AppState};
use crate::auth;
use crate::db::models::{Escola, EscolaInput};
use crate::error::{AppError, Result};
use rusqlite::params;
use tauri::State;

fn validar(d: EscolaInput) -> Result<EscolaInput> {
    let cnpj = opcional(d.cnpj);
    if let Some(c) = &cnpj {
        let digitos = c.chars().filter(|x| x.is_ascii_digit()).count();
        if digitos != 14 {
            return Err(AppError::msg("CNPJ inválido: informe 14 dígitos."));
        }
    }
    let logo = opcional(d.logo);
    if let Some(l) = &logo {
        if !l.starts_with("data:image/") || l.len() > 2_000_000 {
            return Err(AppError::msg("Logo inválida (use uma imagem de até 1 MB)."));
        }
    }
    Ok(EscolaInput {
        nome: nome_valido(&d.nome, "O nome da escola")?,
        endereco: opcional(d.endereco),
        cnpj,
        logo,
    })
}

#[tauri::command]
pub fn listar_escolas(state: State<AppState>, token: String) -> Result<Vec<Escola>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "escolas", "ver", None)?;
    let mut st = conn.prepare(
        "SELECT * FROM escolas WHERE (?1 IS NULL OR id = ?1) ORDER BY nome COLLATE NOCASE",
    )?;
    let v = st
        .query_map(params![ctx.usuario.escola_id], Escola::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

#[tauri::command]
pub fn criar_escola(state: State<AppState>, token: String, dados: EscolaInput) -> Result<Escola> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "escolas", "criar", None)?;
    let d = validar(dados)?;
    conn.execute(
        "INSERT INTO escolas (nome, endereco, cnpj, logo) VALUES (?1,?2,?3,?4)",
        params![d.nome, d.endereco, d.cnpj, d.logo],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "escolas", Some(id), &d.nome);
    Ok(conn.query_row("SELECT * FROM escolas WHERE id = ?1", [id], Escola::from_row)?)
}

#[tauri::command]
pub fn atualizar_escola(
    state: State<AppState>,
    token: String,
    id: i64,
    dados: EscolaInput,
) -> Result<Escola> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "escolas", "editar", Some(id))?;
    let d = validar(dados)?;
    let n = conn
        .execute(
            "UPDATE escolas SET nome=?1, endereco=?2, cnpj=?3, logo=?4, atualizado_em=datetime('now')
             WHERE id=?5",
            params![d.nome, d.endereco, d.cnpj, d.logo, id],
        )
        .map_err(traduzir)?;
    if n == 0 {
        return Err(AppError::msg("Escola não encontrada."));
    }
    ctx.auditar(&conn, "editar", "escolas", Some(id), &d.nome);
    Ok(conn.query_row("SELECT * FROM escolas WHERE id = ?1", [id], Escola::from_row)?)
}

#[tauri::command]
pub fn excluir_escola(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "escolas", "excluir", Some(id))?;
    let nome: String = conn
        .query_row("SELECT nome FROM escolas WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| AppError::msg("Escola não encontrada."))?;
    conn.execute("DELETE FROM escolas WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "escolas", Some(id), &format!("{nome} (e todos os seus dados)"));
    Ok(())
}

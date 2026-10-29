// Cadastro de coordenadores (turmas que coordenam + expediente com horários variados).

use super::{nome_valido, opcional, AppState};
use crate::auth;
use crate::db::models::*;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use tauri::State;

/// Valida o JSON do expediente e devolve-o normalizado (ordenado por dia e início).
fn validar_expediente(txt: &str) -> Result<String> {
    let v: serde_json::Value = serde_json::from_str(if txt.trim().is_empty() { "[]" } else { txt })
        .map_err(|_| AppError::msg("Expediente inválido."))?;
    let arr = v.as_array().ok_or_else(|| AppError::msg("Expediente inválido."))?;
    let mut itens: Vec<(i64, i64, i64)> = Vec::new();
    for it in arr {
        let dia = it["dia"].as_i64().unwrap_or(0);
        let ini = it["ini"].as_i64().unwrap_or(-1);
        let fim = it["fim"].as_i64().unwrap_or(-1);
        if !(1..=6).contains(&dia) || !(0..1440).contains(&ini) || !(1..=1440).contains(&fim) || fim <= ini {
            return Err(AppError::msg("Cada período do expediente precisa de dia, início e fim válidos (fim depois do início)."));
        }
        itens.push((dia, ini, fim));
    }
    itens.sort();
    for w in itens.windows(2) {
        if w[0].0 == w[1].0 && w[1].1 < w[0].2 {
            return Err(AppError::msg("Há períodos do expediente que se sobrepõem no mesmo dia."));
        }
    }
    let out: Vec<serde_json::Value> = itens.iter().map(|(d, i, f)| serde_json::json!({"dia": d, "ini": i, "fim": f})).collect();
    Ok(serde_json::to_string(&out).unwrap_or_else(|_| "[]".into()))
}

fn carregar(conn: &Connection, id: i64) -> Result<Coordenador> {
    let mut c = conn
        .query_row(
            "SELECT id, escola_id, nome, email, telefone, expediente FROM coordenadores WHERE id = ?1",
            [id],
            |r| Ok(Coordenador { id: r.get(0)?, escola_id: r.get(1)?, nome: r.get(2)?, email: r.get(3)?, telefone: r.get(4)?, expediente: r.get(5)?, turma_ids: vec![] }),
        )
        .map_err(|_| AppError::msg("Coordenador não encontrado."))?;
    let mut st = conn.prepare("SELECT turma_id FROM coordenador_turmas WHERE coordenador_id = ?1 ORDER BY turma_id")?;
    c.turma_ids = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(c)
}

fn gravar_turmas(conn: &Connection, id: i64, escola_id: i64, turmas: &[i64]) -> Result<()> {
    conn.execute("DELETE FROM coordenador_turmas WHERE coordenador_id = ?1", [id])?;
    for t in turmas {
        let ok: i64 = conn.query_row("SELECT COUNT(*) FROM turmas WHERE id = ?1 AND escola_id = ?2", params![t, escola_id], |r| r.get(0))?;
        if ok == 0 {
            return Err(AppError::msg("Turma inválida para esta escola."));
        }
        conn.execute("INSERT OR IGNORE INTO coordenador_turmas (coordenador_id, turma_id) VALUES (?1, ?2)", params![id, t])?;
    }
    Ok(())
}

#[tauri::command]
pub fn listar_coordenadores(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Coordenador>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "professores", "ver", Some(escola_id))?;
    let ids: Vec<i64> = {
        let mut st = conn.prepare("SELECT id FROM coordenadores WHERE escola_id = ?1 ORDER BY nome COLLATE NOCASE")?;
        let v = st.query_map([escola_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
        v
    };
    ids.into_iter().map(|i| carregar(&conn, i)).collect()
}

#[tauri::command]
pub fn criar_coordenador(state: State<AppState>, token: String, dados: CoordenadorInput) -> Result<Coordenador> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "professores", "criar", Some(dados.escola_id))?;
    let nome = nome_valido(&dados.nome, "O nome do coordenador")?;
    let exp = validar_expediente(&dados.expediente)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO coordenadores (escola_id, nome, email, telefone, expediente) VALUES (?1,?2,?3,?4,?5)",
        params![dados.escola_id, nome, opcional(dados.email), opcional(dados.telefone), exp],
    )?;
    let id = tx.last_insert_rowid();
    gravar_turmas(&tx, id, dados.escola_id, &dados.turma_ids)?;
    ctx.auditar(&tx, "criar", "coordenadores", Some(id), &nome);
    tx.commit()?;
    carregar(&conn, id)
}

#[tauri::command]
pub fn atualizar_coordenador(state: State<AppState>, token: String, id: i64, dados: CoordenadorInput) -> Result<Coordenador> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let atual = carregar(&conn, id)?;
    ctx.exigir(&conn, "professores", "editar", Some(atual.escola_id))?;
    let nome = nome_valido(&dados.nome, "O nome do coordenador")?;
    let exp = validar_expediente(&dados.expediente)?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE coordenadores SET nome=?1, email=?2, telefone=?3, expediente=?4 WHERE id=?5",
        params![nome, opcional(dados.email), opcional(dados.telefone), exp, id],
    )?;
    gravar_turmas(&tx, id, atual.escola_id, &dados.turma_ids)?;
    ctx.auditar(&tx, "editar", "coordenadores", Some(id), &nome);
    tx.commit()?;
    carregar(&conn, id)
}

#[tauri::command]
pub fn excluir_coordenador(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let c = carregar(&conn, id)?;
    ctx.exigir(&conn, "professores", "excluir", Some(c.escola_id))?;
    conn.execute("DELETE FROM coordenadores WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "coordenadores", Some(id), &c.nome);
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn expediente_valido_e_normalizado() {
        let r = validar_expediente(r#"[{"dia":2,"ini":600,"fim":720},{"dia":1,"ini":420,"fim":720},{"dia":1,"ini":1080,"fim":1320}]"#).unwrap();
        assert!(r.starts_with(r#"[{"dia":1,"fim":720,"ini":420}"#) || r.contains(r#""dia":1"#));
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 3);
        assert_eq!(v[0]["dia"], 1);
        assert_eq!(v[2]["dia"], 2);
    }

    #[test]
    fn expediente_invalido_e_barrado() {
        assert!(validar_expediente(r#"[{"dia":7,"ini":420,"fim":720}]"#).is_err());
        assert!(validar_expediente(r#"[{"dia":1,"ini":720,"fim":420}]"#).is_err());
        assert!(validar_expediente(r#"[{"dia":1,"ini":420,"fim":720},{"dia":1,"ini":600,"fim":800}]"#).is_err());
        assert!(validar_expediente("lixo").is_err());
        assert_eq!(validar_expediente("").unwrap(), "[]");
    }
}

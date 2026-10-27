//! CRUD de professores, matérias, salas e turmas (todos vinculados a uma escola).

use super::{nome_valido, opcional, traduzir, AppState};
use crate::auth;
use crate::db::models::*;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use tauri::State;

const TIPOS_SALA: [&str; 6] = ["sala_aula", "laboratorio", "quadra", "biblioteca", "auditorio", "outro"];
const TURNOS: [&str; 3] = ["manha", "tarde", "noite"];

/// Descobre a escola de um registro (para checar permissão antes de editar/excluir).
fn escola_do_registro(conn: &Connection, tabela: &str, id: i64) -> Result<i64> {
    // `tabela` é sempre uma constante interna; o id é parametrizado.
    let sql = format!("SELECT escola_id FROM {tabela} WHERE id = ?1");
    conn.query_row(&sql, [id], |r| r.get(0))
        .map_err(|_| AppError::msg("Registro não encontrado."))
}

fn validar_cor(cor: &str) -> Result<String> {
    let c = cor.trim();
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit());
    if !ok {
        return Err(AppError::msg("Cor inválida (use o formato #RRGGBB)."));
    }
    Ok(c.to_lowercase())
}

// ------------------------------- Professores -------------------------------

fn carregar_professor(conn: &Connection, id: i64) -> Result<Professor> {
    let mut p = conn
        .query_row("SELECT * FROM professores WHERE id = ?1", [id], |r| {
            Ok(Professor {
                id: r.get("id")?,
                escola_id: r.get("escola_id")?,
                nome: r.get("nome")?,
                email: r.get("email")?,
                telefone: r.get("telefone")?,
                disponibilidade: r.get("disponibilidade")?,
                cor: r.get("cor")?,
                max_aulas_semana: r.get("max_aulas_semana")?,
                max_aulas_dia: r.get("max_aulas_dia")?,
                deslocamento_min: r.get("deslocamento_min")?,
                intersticio_horas: r.get("intersticio_horas")?,
                da_aula_sabado: r.get::<_, i64>("da_aula_sabado")? != 0,
                materia_ids: vec![],
            })
        })
        .map_err(|_| AppError::msg("Professor não encontrado."))?;
    let mut st = conn.prepare("SELECT materia_id FROM professor_materias WHERE professor_id = ?1")?;
    p.materia_ids = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(p)
}

/// Valida os limites do professor.
fn validar_limites(d: &ProfessorInput) -> Result<()> {
    let faixa = |v: Option<i64>, max: i64, nome: &str| -> Result<()> {
        if let Some(x) = v {
            if !(1..=max).contains(&x) {
                return Err(AppError::msg(format!("{nome} deve estar entre 1 e {max} (ou vazio para sem limite).")));
            }
        }
        Ok(())
    };
    faixa(d.max_aulas_semana, 60, "O máximo de aulas por semana")?;
    faixa(d.max_aulas_dia, 12, "O máximo de aulas por dia")?;
    if !(0..=240).contains(&d.deslocamento_min) {
        return Err(AppError::msg("O deslocamento deve estar entre 0 e 240 minutos."));
    }
    if !(0..=24).contains(&d.intersticio_horas) {
        return Err(AppError::msg("O interstício deve estar entre 0 e 24 horas."));
    }
    Ok(())
}

fn gravar_materias_do_professor(conn: &Connection, prof: i64, escola: i64, ids: &[i64]) -> Result<()> {
    conn.execute("DELETE FROM professor_materias WHERE professor_id = ?1", [prof])?;
    for m in ids {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM materias WHERE id = ?1 AND escola_id = ?2",
            params![m, escola],
            |r| r.get(0),
        )?;
        if n == 0 {
            return Err(AppError::msg("Matéria inválida para esta escola."));
        }
        conn.execute(
            "INSERT OR IGNORE INTO professor_materias (professor_id, materia_id) VALUES (?1,?2)",
            params![prof, m],
        )?;
    }
    Ok(())
}

fn validar_disponibilidade(json: &str) -> Result<String> {
    let v: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|_| AppError::msg("Disponibilidade inválida."))?;
    for item in &v {
        if item["dia"].as_i64().is_none() || item["horario_id"].as_i64().is_none() {
            return Err(AppError::msg("Disponibilidade inválida."));
        }
    }
    Ok(serde_json::to_string(&v)?)
}

#[tauri::command]
pub fn listar_professores(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Professor>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "professores", "ver", Some(escola_id))?;
    let mut st = conn.prepare(
        "SELECT id FROM professores WHERE escola_id = ?1 AND (?2 IS NULL OR id = ?2)
         ORDER BY nome COLLATE NOCASE",
    )?;
    // Usuário com papel "professor" enxerga apenas o próprio cadastro.
    let so_este = if ctx.usuario.papel == "professor" {
        Some(ctx.usuario.professor_id.unwrap_or(-1))
    } else {
        None
    };
    let ids: Vec<i64> = st
        .query_map(params![escola_id, so_este], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| carregar_professor(&conn, id)).collect()
}

#[tauri::command]
pub fn criar_professor(state: State<AppState>, token: String, dados: ProfessorInput) -> Result<Professor> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "professores", "criar", Some(dados.escola_id))?;
    let nome = nome_valido(&dados.nome, "O nome do professor")?;
    let disp = validar_disponibilidade(&dados.disponibilidade)?;
    validar_limites(&dados)?;
    let cor = match opcional(dados.cor.clone()) {
        Some(c) => validar_cor(&c)?,
        None => {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM professores WHERE escola_id = ?1", [dados.escola_id], |r| r.get(0))?;
            crate::db::PALETA_PROFESSORES[n as usize % crate::db::PALETA_PROFESSORES.len()].to_string()
        }
    };
    conn.execute(
        "INSERT INTO professores (escola_id, nome, email, telefone, disponibilidade, cor,
           max_aulas_semana, max_aulas_dia, deslocamento_min, intersticio_horas, da_aula_sabado)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![dados.escola_id, nome, opcional(dados.email), opcional(dados.telefone), disp, cor,
                dados.max_aulas_semana, dados.max_aulas_dia, dados.deslocamento_min, dados.intersticio_horas,
                dados.da_aula_sabado as i64],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    gravar_materias_do_professor(&conn, id, dados.escola_id, &dados.materia_ids)?;
    ctx.auditar(&conn, "criar", "professores", Some(id), &nome);
    carregar_professor(&conn, id)
}

#[tauri::command]
pub fn atualizar_professor(
    state: State<AppState>,
    token: String,
    id: i64,
    dados: ProfessorInput,
) -> Result<Professor> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "professores", id)?;
    ctx.exigir(&conn, "professores", "editar", Some(escola))?;
    let nome = nome_valido(&dados.nome, "O nome do professor")?;
    let disp = validar_disponibilidade(&dados.disponibilidade)?;
    validar_limites(&dados)?;
    let cor_atual: String = conn.query_row("SELECT cor FROM professores WHERE id=?1", [id], |r| r.get(0))?;
    let cor = match opcional(dados.cor.clone()) {
        Some(c) => validar_cor(&c)?,
        None => cor_atual,
    };
    conn.execute(
        "UPDATE professores SET nome=?1, email=?2, telefone=?3, disponibilidade=?4, cor=?5,
         max_aulas_semana=?6, max_aulas_dia=?7, deslocamento_min=?8, intersticio_horas=?9, da_aula_sabado=?10,
         atualizado_em=datetime('now') WHERE id=?11",
        params![nome, opcional(dados.email), opcional(dados.telefone), disp, cor,
                dados.max_aulas_semana, dados.max_aulas_dia, dados.deslocamento_min, dados.intersticio_horas,
                dados.da_aula_sabado as i64, id],
    )
    .map_err(traduzir)?;
    gravar_materias_do_professor(&conn, id, escola, &dados.materia_ids)?;
    ctx.auditar(&conn, "editar", "professores", Some(id), &nome);
    carregar_professor(&conn, id)
}

#[tauri::command]
pub fn excluir_professor(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "professores", id)?;
    ctx.exigir(&conn, "professores", "excluir", Some(escola))?;
    let nome: String = conn.query_row("SELECT nome FROM professores WHERE id=?1", [id], |r| r.get(0))?;
    // As aulas dele viram "aulas livres" (professor_id = NULL) pelo ON DELETE SET NULL.
    conn.execute("DELETE FROM professores WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "professores", Some(id), &nome);
    Ok(())
}

// -------------------------------- Matérias ---------------------------------

#[tauri::command]
pub fn listar_materias(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Materia>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "materias", "ver", Some(escola_id))?;
    let mut st = conn.prepare(
        "SELECT id, escola_id, nome, cor FROM materias WHERE escola_id = ?1 ORDER BY nome COLLATE NOCASE",
    )?;
    let v = st
        .query_map([escola_id], |r| {
            Ok(Materia { id: r.get(0)?, escola_id: r.get(1)?, nome: r.get(2)?, cor: r.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

fn materia_por_id(conn: &Connection, id: i64) -> Result<Materia> {
    Ok(conn.query_row("SELECT id, escola_id, nome, cor FROM materias WHERE id=?1", [id], |r| {
        Ok(Materia { id: r.get(0)?, escola_id: r.get(1)?, nome: r.get(2)?, cor: r.get(3)? })
    })?)
}

#[tauri::command]
pub fn criar_materia(state: State<AppState>, token: String, dados: MateriaInput) -> Result<Materia> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "materias", "criar", Some(dados.escola_id))?;
    let nome = nome_valido(&dados.nome, "O nome da matéria")?;
    let cor = validar_cor(&dados.cor)?;
    conn.execute(
        "INSERT INTO materias (escola_id, nome, cor) VALUES (?1,?2,?3)",
        params![dados.escola_id, nome, cor],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "materias", Some(id), &nome);
    materia_por_id(&conn, id)
}

#[tauri::command]
pub fn atualizar_materia(state: State<AppState>, token: String, id: i64, dados: MateriaInput) -> Result<Materia> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "materias", id)?;
    ctx.exigir(&conn, "materias", "editar", Some(escola))?;
    let nome = nome_valido(&dados.nome, "O nome da matéria")?;
    let cor = validar_cor(&dados.cor)?;
    conn.execute(
        "UPDATE materias SET nome=?1, cor=?2, atualizado_em=datetime('now') WHERE id=?3",
        params![nome, cor, id],
    )
    .map_err(traduzir)?;
    ctx.auditar(&conn, "editar", "materias", Some(id), &nome);
    materia_por_id(&conn, id)
}

#[tauri::command]
pub fn excluir_materia(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "materias", id)?;
    ctx.exigir(&conn, "materias", "excluir", Some(escola))?;
    let nome: String = conn.query_row("SELECT nome FROM materias WHERE id=?1", [id], |r| r.get(0))?;
    conn.execute("DELETE FROM materias WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "materias", Some(id), &nome);
    Ok(())
}

// ---------------------------------- Salas ----------------------------------

fn sala_por_id(conn: &Connection, id: i64) -> Result<Sala> {
    Ok(conn.query_row(
        "SELECT id, escola_id, nome, tipo, capacidade, observacoes FROM salas WHERE id=?1",
        [id],
        |r| {
            Ok(Sala {
                id: r.get(0)?,
                escola_id: r.get(1)?,
                nome: r.get(2)?,
                tipo: r.get(3)?,
                capacidade: r.get(4)?,
                observacoes: r.get(5)?,
            })
        },
    )?)
}

fn validar_sala(d: &SalaInput) -> Result<String> {
    if !TIPOS_SALA.contains(&d.tipo.as_str()) {
        return Err(AppError::msg("Tipo de sala inválido."));
    }
    if d.capacidade < 0 || d.capacidade > 100_000 {
        return Err(AppError::msg("Capacidade inválida."));
    }
    nome_valido(&d.nome, "O nome da sala")
}

#[tauri::command]
pub fn listar_salas(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Sala>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "salas", "ver", Some(escola_id))?;
    let mut st = conn.prepare("SELECT id FROM salas WHERE escola_id = ?1 ORDER BY nome COLLATE NOCASE")?;
    let ids: Vec<i64> = st.query_map([escola_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| sala_por_id(&conn, id)).collect()
}

#[tauri::command]
pub fn criar_sala(state: State<AppState>, token: String, dados: SalaInput) -> Result<Sala> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "salas", "criar", Some(dados.escola_id))?;
    let nome = validar_sala(&dados)?;
    conn.execute(
        "INSERT INTO salas (escola_id, nome, tipo, capacidade, observacoes) VALUES (?1,?2,?3,?4,?5)",
        params![dados.escola_id, nome, dados.tipo, dados.capacidade, opcional(dados.observacoes)],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "salas", Some(id), &nome);
    sala_por_id(&conn, id)
}

#[tauri::command]
pub fn atualizar_sala(state: State<AppState>, token: String, id: i64, dados: SalaInput) -> Result<Sala> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "salas", id)?;
    ctx.exigir(&conn, "salas", "editar", Some(escola))?;
    let nome = validar_sala(&dados)?;
    conn.execute(
        "UPDATE salas SET nome=?1, tipo=?2, capacidade=?3, observacoes=?4, atualizado_em=datetime('now')
         WHERE id=?5",
        params![nome, dados.tipo, dados.capacidade, opcional(dados.observacoes), id],
    )
    .map_err(traduzir)?;
    ctx.auditar(&conn, "editar", "salas", Some(id), &nome);
    sala_por_id(&conn, id)
}

#[tauri::command]
pub fn excluir_sala(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "salas", id)?;
    ctx.exigir(&conn, "salas", "excluir", Some(escola))?;
    let nome: String = conn.query_row("SELECT nome FROM salas WHERE id=?1", [id], |r| r.get(0))?;
    conn.execute("DELETE FROM salas WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "salas", Some(id), &format!("{nome} (e suas aulas)"));
    Ok(())
}

// ---------------------------------- Turmas ---------------------------------

fn turma_por_id(conn: &Connection, id: i64) -> Result<Turma> {
    Ok(conn.query_row(
        "SELECT id, escola_id, nome, serie, turno, num_alunos, fim_max_min, grade_id FROM turmas WHERE id=?1",
        [id],
        |r| {
            Ok(Turma {
                id: r.get(0)?,
                escola_id: r.get(1)?,
                nome: r.get(2)?,
                serie: r.get(3)?,
                turno: r.get(4)?,
                num_alunos: r.get(5)?,
                fim_max_min: r.get(6)?,
                grade_id: r.get(7)?,
            })
        },
    )?)
}

fn validar_turma(d: &TurmaInput) -> Result<String> {
    if !TURNOS.contains(&d.turno.as_str()) {
        return Err(AppError::msg("Turno inválido."));
    }
    if d.num_alunos < 0 || d.num_alunos > 10_000 {
        return Err(AppError::msg("Número de alunos inválido."));
    }
    if let Some(f) = d.fim_max_min {
        if !(1..=1440).contains(&f) {
            return Err(AppError::msg("Horário de término da turma inválido."));
        }
    }
    nome_valido(&d.nome, "O nome da turma")
}

#[tauri::command]
pub fn listar_turmas(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Turma>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "ver", Some(escola_id))?;
    let mut st = conn.prepare("SELECT id FROM turmas WHERE escola_id = ?1 ORDER BY nome COLLATE NOCASE")?;
    let ids: Vec<i64> = st.query_map([escola_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| turma_por_id(&conn, id)).collect()
}

#[tauri::command]
pub fn criar_turma(state: State<AppState>, token: String, dados: TurmaInput) -> Result<Turma> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "criar", Some(dados.escola_id))?;
    let nome = validar_turma(&dados)?;
    let grade = super::horarios::resolver_grade(&conn, dados.escola_id, dados.grade_id)?;
    conn.execute(
        "INSERT INTO turmas (escola_id, nome, serie, turno, num_alunos, fim_max_min, grade_id) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![dados.escola_id, nome, opcional(dados.serie), dados.turno, dados.num_alunos, dados.fim_max_min, grade],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "turmas", Some(id), &nome);
    turma_por_id(&conn, id)
}

#[tauri::command]
pub fn atualizar_turma(state: State<AppState>, token: String, id: i64, dados: TurmaInput) -> Result<Turma> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "turmas", id)?;
    ctx.exigir(&conn, "turmas", "editar", Some(escola))?;
    let nome = validar_turma(&dados)?;
    let atual: i64 = conn.query_row("SELECT grade_id FROM turmas WHERE id=?1", [id], |r| r.get(0))?;
    let grade = match dados.grade_id {
        None => atual,
        Some(_) => super::horarios::resolver_grade(&conn, escola, dados.grade_id)?,
    };
    if grade != atual {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM aula_turmas WHERE turma_id=?1", [id], |r| r.get(0))?;
        if n > 0 {
            return Err(AppError::msg("Esta turma já tem aulas na grade; remova-as antes de trocar a grade de horários."));
        }
    }
    conn.execute(
        "UPDATE turmas SET nome=?1, serie=?2, turno=?3, num_alunos=?4, fim_max_min=?5, grade_id=?7, atualizado_em=datetime('now')
         WHERE id=?6",
        params![nome, opcional(dados.serie), dados.turno, dados.num_alunos, dados.fim_max_min, id, grade],
    )
    .map_err(traduzir)?;
    ctx.auditar(&conn, "editar", "turmas", Some(id), &nome);
    turma_por_id(&conn, id)
}

#[tauri::command]
pub fn excluir_turma(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "turmas", id)?;
    ctx.exigir(&conn, "turmas", "excluir", Some(escola))?;
    let nome: String = conn.query_row("SELECT nome FROM turmas WHERE id=?1", [id], |r| r.get(0))?;
    conn.execute("DELETE FROM turmas WHERE id = ?1", [id])?;
    crate::db::horarios::limpar_aulas_orfas(&conn)?;
    ctx.auditar(&conn, "excluir", "turmas", Some(id), &format!("{nome} (e suas aulas)"));
    Ok(())
}

// --------------------------------- Grupos ----------------------------------
// Um grupo é uma subdivisão de uma turma (ex.: "Grupo 1" e "Grupo 2") que pode
// ter aulas diferentes ao mesmo tempo (uma na sala, outra no laboratório).

#[tauri::command]
pub fn listar_grupos(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Grupo>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "ver", Some(escola_id))?;
    let mut st = conn.prepare(
        "SELECT id, escola_id, turma_id, nome FROM grupos WHERE escola_id = ?1 ORDER BY turma_id, nome COLLATE NOCASE",
    )?;
    let v = st
        .query_map([escola_id], |r| {
            Ok(Grupo { id: r.get(0)?, escola_id: r.get(1)?, turma_id: r.get(2)?, nome: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

fn grupo_por_id(conn: &Connection, id: i64) -> Result<Grupo> {
    conn.query_row("SELECT id, escola_id, turma_id, nome FROM grupos WHERE id = ?1", [id], |r| {
        Ok(Grupo { id: r.get(0)?, escola_id: r.get(1)?, turma_id: r.get(2)?, nome: r.get(3)? })
    })
    .map_err(|_| AppError::msg("Grupo não encontrado."))
}

#[tauri::command]
pub fn criar_grupo(state: State<AppState>, token: String, dados: GrupoInput) -> Result<Grupo> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "editar", Some(dados.escola_id))?;
    let nome = nome_valido(&dados.nome, "Nome do grupo")?;
    let ok: i64 = conn.query_row(
        "SELECT COUNT(*) FROM turmas WHERE id = ?1 AND escola_id = ?2",
        params![dados.turma_id, dados.escola_id],
        |r| r.get(0),
    )?;
    if ok == 0 {
        return Err(AppError::msg("Turma não pertence a esta escola."));
    }
    conn.execute(
        "INSERT INTO grupos (escola_id, turma_id, nome) VALUES (?1,?2,?3)",
        params![dados.escola_id, dados.turma_id, nome],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "grupos", Some(id), &nome);
    grupo_por_id(&conn, id)
}

#[tauri::command]
pub fn atualizar_grupo(state: State<AppState>, token: String, id: i64, nome: String) -> Result<Grupo> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "grupos", id)?;
    ctx.exigir(&conn, "turmas", "editar", Some(escola))?;
    let nome = nome_valido(&nome, "Nome do grupo")?;
    conn.execute("UPDATE grupos SET nome = ?1 WHERE id = ?2", params![nome, id]).map_err(traduzir)?;
    ctx.auditar(&conn, "editar", "grupos", Some(id), &nome);
    grupo_por_id(&conn, id)
}

#[tauri::command]
pub fn excluir_grupo(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola = escola_do_registro(&conn, "grupos", id)?;
    ctx.exigir(&conn, "turmas", "editar", Some(escola))?;
    let g = grupo_por_id(&conn, id)?;
    conn.execute("DELETE FROM grupos WHERE id = ?1", [id])?;
    crate::db::horarios::limpar_aulas_orfas(&conn)?;
    ctx.auditar(&conn, "excluir", "grupos", Some(id), &format!("{} (e suas aulas)", g.nome));
    Ok(())
}

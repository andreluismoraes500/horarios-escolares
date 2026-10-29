//! Faixas de horário (com duração e intervalos configuráveis) e aulas da grade.

use super::{nome_valido, opcional, traduzir, AppState};
use crate::auth::{self, Ctx};
use crate::db::horarios::{
    avisos_disponibilidade, buscar_aulas, conflitos_no_banco, gravar_turmas, inserir_aula, gerar_faixas, resumir_conflitos, sobrepoe,
    validar_referencias, IntervaloCfg,
};
use crate::db::models::*;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

// =========================== Faixas de horário ===========================

fn listar_h(conn: &Connection, escola_id: i64) -> Result<Vec<Horario>> {
    let mut st = conn.prepare(
        "SELECT id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno, grade_id
         FROM horarios_base WHERE escola_id = ?1 ORDER BY grade_id, inicio_min",
    )?;
    let v = st
        .query_map([escola_id], |r| {
            Ok(Horario {
                id: r.get(0)?,
                escola_id: r.get(1)?,
                ordem: r.get(2)?,
                rotulo: r.get(3)?,
                inicio_min: r.get(4)?,
                fim_min: r.get(5)?,
                tipo: r.get(6)?,
                turno: r.get(7)?,
                grade_id: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Renumera a coluna `ordem` conforme o horário de início.
fn reordenar(conn: &Connection, escola_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE horarios_base SET ordem = (
            SELECT COUNT(*) FROM horarios_base h2
            WHERE h2.grade_id = horarios_base.grade_id AND h2.inicio_min <= horarios_base.inicio_min)
         WHERE escola_id = ?1",
        [escola_id],
    )?;
    Ok(())
}

/// Primeira grade da escola (a "Padrão"), usada quando nenhuma é informada.
pub fn grade_padrao(conn: &Connection, escola_id: i64) -> Result<i64> {
    conn.query_row("SELECT MIN(id) FROM grades WHERE escola_id = ?1", [escola_id], |r| r.get::<_, Option<i64>>(0))?
        .ok_or_else(|| AppError::msg("A escola não tem grade de horários."))
}

/// Usa a grade informada (que deve ser da escola) ou a padrão.
pub fn resolver_grade(conn: &Connection, escola_id: i64, grade_id: Option<i64>) -> Result<i64> {
    match grade_id {
        None => grade_padrao(conn, escola_id),
        Some(g) => {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM grades WHERE id = ?1 AND escola_id = ?2",
                params![g, escola_id],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("Grade de horários não pertence a esta escola."));
            }
            Ok(g)
        }
    }
}

/// Garante que a faixa [ini, fim) não se sobrepõe a nenhuma outra DA MESMA GRADE.
/// (Grades diferentes podem se sobrepor no relógio.)
fn checar_sobreposicao(conn: &Connection, escola_id: i64, grade_id: i64, ignorar: Option<i64>, ini: i64, fim: i64) -> Result<()> {
    for h in listar_h(conn, escola_id)?.into_iter().filter(|h| h.grade_id == grade_id) {
        if Some(h.id) != ignorar && sobrepoe(ini, fim, h.inicio_min, h.fim_min) {
            return Err(AppError::msg(format!(
                "A faixa se sobrepõe a \"{}\" ({}–{}).",
                h.rotulo,
                crate::db::horarios::formatar_min(h.inicio_min),
                crate::db::horarios::formatar_min(h.fim_min)
            )));
        }
    }
    Ok(())
}

fn validar_faixa(d: &HorarioInput) -> Result<String> {
    if d.tipo != "aula" && d.tipo != "intervalo" {
        return Err(AppError::msg("Tipo de faixa inválido."));
    }
    if !["manha", "tarde", "noite"].contains(&d.turno.as_str()) {
        return Err(AppError::msg("Turno inválido."));
    }
    if !(0..1440).contains(&d.inicio_min) || !(1..=1440).contains(&d.fim_min) || d.fim_min <= d.inicio_min {
        return Err(AppError::msg("O horário de término deve ser depois do início (no mesmo dia)."));
    }
    nome_valido(&d.rotulo, "O rótulo")
}

#[tauri::command]
pub fn listar_horarios(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Horario>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "ver", Some(escola_id))?;
    listar_h(&conn, escola_id)
}

// ============================ Grades de horário ============================

#[tauri::command]
pub fn listar_grades(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Grade>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "ver", Some(escola_id))?;
    let mut st = conn.prepare("SELECT id, escola_id, nome FROM grades WHERE escola_id = ?1 ORDER BY id")?;
    let v = st
        .query_map([escola_id], |r| Ok(Grade { id: r.get(0)?, escola_id: r.get(1)?, nome: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Cria uma grade, opcionalmente copiando as faixas de outra.
#[tauri::command]
pub fn criar_grade(state: State<AppState>, token: String, escola_id: i64, nome: String, copiar_de: Option<i64>) -> Result<Grade> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "criar", Some(escola_id))?;
    let nome = nome_valido(&nome, "O nome da grade")?;
    let origem = match copiar_de {
        Some(g) => Some(resolver_grade(&conn, escola_id, Some(g))?),
        None => None,
    };
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO grades (escola_id, nome) VALUES (?1, ?2)", params![escola_id, nome]).map_err(traduzir)?;
    let id = tx.last_insert_rowid();
    if let Some(o) = origem {
        tx.execute(
            "INSERT INTO horarios_base (escola_id, grade_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
             SELECT escola_id, ?1, ordem, rotulo, inicio_min, fim_min, tipo, turno FROM horarios_base WHERE grade_id = ?2",
            params![id, o],
        )?;
    }
    ctx.auditar(&tx, "criar", "grades", Some(id), &nome);
    tx.commit()?;
    Ok(Grade { id, escola_id, nome })
}

#[tauri::command]
pub fn renomear_grade(state: State<AppState>, token: String, id: i64, nome: String) -> Result<Grade> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola: i64 = conn
        .query_row("SELECT escola_id FROM grades WHERE id=?1", [id], |r| r.get(0))
        .map_err(|_| AppError::msg("Grade não encontrada."))?;
    ctx.exigir(&conn, "horarios", "editar", Some(escola))?;
    let nome = nome_valido(&nome, "O nome da grade")?;
    conn.execute("UPDATE grades SET nome = ?1 WHERE id = ?2", params![nome, id]).map_err(traduzir)?;
    ctx.auditar(&conn, "editar", "grades", Some(id), &nome);
    Ok(Grade { id, escola_id: escola, nome })
}

/// Exclui a grade e suas faixas (e as aulas nelas). Não exclui a última grade nem uma grade em uso por turmas.
#[tauri::command]
pub fn excluir_grade(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let (escola, nome): (i64, String) = conn
        .query_row("SELECT escola_id, nome FROM grades WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| AppError::msg("Grade não encontrada."))?;
    ctx.exigir(&conn, "horarios", "excluir", Some(escola))?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM grades WHERE escola_id=?1", [escola], |r| r.get(0))?;
    if total <= 1 {
        return Err(AppError::msg("A escola precisa ter ao menos uma grade de horários."));
    }
    let em_uso: i64 = conn.query_row("SELECT COUNT(*) FROM turmas WHERE grade_id=?1", [id], |r| r.get(0))?;
    if em_uso > 0 {
        return Err(AppError::msg(format!(
            "{em_uso} turma(s) usam esta grade. Troque a grade dessas turmas antes de excluir."
        )));
    }
    conn.execute("DELETE FROM grades WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "grades", Some(id), &nome);
    Ok(())
}

#[derive(Deserialize)]
pub struct GerarParams {
    pub escola_id: i64,
    /// Início da 1ª aula, em minutos desde 00:00 (ex.: 07:10 = 430).
    pub inicio_min: i64,
    /// Duração de cada aula em minutos (ex.: 50).
    pub duracao_min: i64,
    pub qtd_aulas: i64,
    pub intervalos: Vec<IntervaloCfg>,
    /// Grade que recebe as faixas (None = grade padrão).
    #[serde(default)]
    pub grade_id: Option<i64>,
    /// Turno dos horários gerados: "manha" | "tarde" | "noite".
    pub turno: String,
    /// "substituir" apaga os horários DESTE TURNO antes de gerar; "adicionar" mantém os existentes.
    pub modo: String,
    /// Texto opcional antes do rótulo (ex.: "Bloco B").
    pub prefixo: Option<String>,
    /// Confirma a exclusão das aulas já alocadas ao substituir.
    pub confirmar_exclusao: bool,
}

#[tauri::command]
pub fn gerar_horarios(state: State<AppState>, token: String, dados: GerarParams) -> Result<Vec<Horario>> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "criar", Some(dados.escola_id))?;
    let faixas = gerar_faixas(
        dados.inicio_min,
        dados.duracao_min,
        dados.qtd_aulas,
        &dados.intervalos,
        dados.prefixo.as_deref(),
    )?;
    if !["manha", "tarde", "noite"].contains(&dados.turno.as_str()) {
        return Err(AppError::msg("Turno inválido."));
    }
    let substituir = dados.modo == "substituir";
    let grade = resolver_grade(&conn, dados.escola_id, dados.grade_id)?;
    let tx = conn.transaction()?;
    if substituir {
        ctx.exigir(&tx, "horarios", "excluir", Some(dados.escola_id))?;
        // Só as aulas deste turno são afetadas.
        let aulas: i64 = tx.query_row(
            "SELECT COUNT(*) FROM aulas WHERE horario_id IN
               (SELECT id FROM horarios_base WHERE grade_id = ?1 AND turno = ?2)",
            params![grade, dados.turno],
            |r| r.get(0),
        )?;
        if aulas > 0 && !dados.confirmar_exclusao {
            return Err(AppError::msg(format!(
                "Existem {aulas} aula(s) alocadas neste turno. Substituir os horários apagará essas aulas."
            )));
        }
        tx.execute(
            "DELETE FROM horarios_base WHERE grade_id = ?1 AND turno = ?2",
            params![grade, dados.turno],
        )?;
    }
    // Nenhuma faixa nova pode se sobrepor às que permanecem na mesma grade (de qualquer turno).
    for f in &faixas {
        checar_sobreposicao(&tx, dados.escola_id, grade, None, f.inicio_min, f.fim_min)?;
    }
    for f in &faixas {
        tx.execute(
            "INSERT INTO horarios_base (escola_id, grade_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
             VALUES (?1, ?7, 0, ?2, ?3, ?4, ?5, ?6)",
            params![dados.escola_id, f.rotulo, f.inicio_min, f.fim_min, f.tipo, dados.turno, grade],
        )
        .map_err(traduzir)?;
    }
    reordenar(&tx, dados.escola_id)?;
    ctx.auditar(
        &tx,
        if substituir { "gerar_horarios_substituir" } else { "gerar_horarios_adicionar" },
        "horarios_base",
        None,
        &format!("{} faixas ({}), aulas de {} min", faixas.len(), dados.turno, dados.duracao_min),
    );
    tx.commit()?;
    listar_h(&conn, dados.escola_id)
}

#[tauri::command]
pub fn criar_horario(state: State<AppState>, token: String, dados: HorarioInput) -> Result<Horario> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "criar", Some(dados.escola_id))?;
    let rotulo = validar_faixa(&dados)?;
    let grade = resolver_grade(&conn, dados.escola_id, dados.grade_id)?;
    checar_sobreposicao(&conn, dados.escola_id, grade, None, dados.inicio_min, dados.fim_min)?;
    conn.execute(
        "INSERT INTO horarios_base (escola_id, grade_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
         VALUES (?1, ?7, 0, ?2, ?3, ?4, ?5, ?6)",
        params![dados.escola_id, rotulo, dados.inicio_min, dados.fim_min, dados.tipo, dados.turno, grade],
    )
    .map_err(traduzir)?;
    let id = conn.last_insert_rowid();
    reordenar(&conn, dados.escola_id)?;
    ctx.auditar(&conn, "criar", "horarios_base", Some(id), &rotulo);
    listar_h(&conn, dados.escola_id)?
        .into_iter()
        .find(|h| h.id == id)
        .ok_or_else(|| AppError::msg("Falha ao criar a faixa."))
}

#[tauri::command]
pub fn atualizar_horario(state: State<AppState>, token: String, id: i64, dados: HorarioInput) -> Result<Horario> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let (escola, tipo_atual, turno_atual): (i64, String, String) = conn
        .query_row("SELECT escola_id, tipo, turno FROM horarios_base WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|_| AppError::msg("Faixa de horário não encontrada."))?;
    ctx.exigir(&conn, "horarios", "editar", Some(escola))?;
    let rotulo = validar_faixa(&dados)?;
    if tipo_atual == "aula" && dados.tipo == "intervalo" {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM aulas WHERE horario_id=?1", [id], |r| r.get(0))?;
        if n > 0 {
            return Err(AppError::msg("Esta faixa possui aulas alocadas; remova-as antes de transformá-la em intervalo."));
        }
    }
    if turno_atual != dados.turno {
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM aulas WHERE horario_id=?1", [id], |r| r.get(0))?;
        if n > 0 {
            return Err(AppError::msg("Esta faixa possui aulas alocadas; remova-as antes de mudar o turno."));
        }
    }
    let grade: i64 = conn.query_row("SELECT grade_id FROM horarios_base WHERE id=?1", [id], |r| r.get(0))?;
    checar_sobreposicao(&conn, escola, grade, Some(id), dados.inicio_min, dados.fim_min)?;
    conn.execute(
        "UPDATE horarios_base SET rotulo=?1, inicio_min=?2, fim_min=?3, tipo=?4, turno=?5 WHERE id=?6",
        params![rotulo, dados.inicio_min, dados.fim_min, dados.tipo, dados.turno, id],
    )
    .map_err(traduzir)?;
    reordenar(&conn, escola)?;
    ctx.auditar(&conn, "editar", "horarios_base", Some(id), &rotulo);
    listar_h(&conn, escola)?
        .into_iter()
        .find(|h| h.id == id)
        .ok_or_else(|| AppError::msg("Faixa não encontrada."))
}

#[tauri::command]
pub fn excluir_horario(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let (escola, rotulo): (i64, String) = conn
        .query_row("SELECT escola_id, rotulo FROM horarios_base WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| AppError::msg("Faixa de horário não encontrada."))?;
    ctx.exigir(&conn, "horarios", "excluir", Some(escola))?;
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM aulas WHERE horario_id=?1", [id], |r| r.get(0))?;
    conn.execute("DELETE FROM horarios_base WHERE id = ?1", [id])?;
    reordenar(&conn, escola)?;
    ctx.auditar(&conn, "excluir", "horarios_base", Some(id), &format!("{rotulo} ({n} aulas removidas)"));
    Ok(())
}

/// Exclui várias faixas de uma vez (as aulas alocadas nelas também são removidas).
#[tauri::command]
pub fn excluir_horarios(state: State<AppState>, token: String, ids: Vec<i64>) -> Result<i64> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut escola_comum: Option<i64> = None;
    let mut aulas_removidas = 0i64;
    for id in &ids {
        let escola: i64 = tx
            .query_row("SELECT escola_id FROM horarios_base WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| AppError::msg("Faixa de horário não encontrada."))?;
        if *escola_comum.get_or_insert(escola) != escola {
            return Err(AppError::SemPermissao);
        }
        ctx.exigir(&tx, "horarios", "excluir", Some(escola))?;
        aulas_removidas += tx.query_row("SELECT COUNT(*) FROM aulas WHERE horario_id=?1", [id], |r| r.get::<_, i64>(0))?;
        tx.execute("DELETE FROM horarios_base WHERE id = ?1", [id])?;
    }
    let escola = escola_comum.unwrap();
    reordenar(&tx, escola)?;
    tx.commit()?;
    ctx.auditar(
        &conn,
        "excluir",
        "horarios_base",
        None,
        &format!("{} faixas ({aulas_removidas} aulas removidas)", ids.len()),
    );
    Ok(ids.len() as i64)
}

// ================================= Aulas =================================

fn aula_por_id(conn: &Connection, id: i64) -> Result<Aula> {
    buscar_aulas(conn, "SELECT * FROM aulas WHERE id = ?1", [id])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::msg("Aula não encontrada."))
}

fn para_input(a: &Aula) -> AulaInput {
    AulaInput {
        escola_id: a.escola_id,
        dia_semana: a.dia_semana,
        horario_id: a.horario_id,
        sala_id: a.sala_id,
        professor_id: a.professor_id,
        materia_id: a.materia_id,
        turmas: a.turmas.clone(),
        observacao: a.observacao.clone(),
    }
}

/// Usuário com papel "professor" só pode ver (e consultar) as próprias aulas.
fn restringe_professor(ctx: &Ctx) -> Option<i64> {
    if ctx.usuario.papel == "professor" {
        Some(ctx.usuario.professor_id.unwrap_or(-1))
    } else {
        None
    }
}

#[tauri::command]
pub fn listar_aulas(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Aula>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "ver", Some(escola_id))?;
    buscar_aulas(
        &conn,
        "SELECT * FROM aulas WHERE escola_id = ?1 AND (?2 IS NULL OR professor_id = ?2)
         ORDER BY dia_semana, horario_id",
        params![escola_id, restringe_professor(&ctx)],
    )
}

/// Verificação (sem gravar) para dar feedback antes de salvar/arrastar.
#[tauri::command]
pub fn verificar_aula(
    state: State<AppState>,
    token: String,
    dados: AulaInput,
    ignorar_id: Option<i64>,
) -> Result<Verificacao> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "ver", Some(dados.escola_id))?;
    validar_referencias(&conn, &dados)?;
    let ignorar: Vec<i64> = ignorar_id.into_iter().collect();
    Ok(Verificacao {
        conflitos: conflitos_no_banco(&conn, &dados, &ignorar)?,
        avisos: avisos_disponibilidade(&conn, &dados, &ignorar)?,
    })
}

#[tauri::command]
pub fn criar_aula(state: State<AppState>, token: String, dados: AulaInput) -> Result<Aula> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "criar", Some(dados.escola_id))?;
    validar_referencias(&conn, &dados)?;
    let c = conflitos_no_banco(&conn, &dados, &[])?;
    if !c.is_empty() {
        return Err(AppError::Conflito(resumir_conflitos(&c)));
    }
    let tx = conn.unchecked_transaction()?;
    let id = inserir_aula(&tx, None, &dados, opcional(dados.observacao.clone())).map_err(conflito_ou_erro)?;
    tx.commit()?;
    aula_por_id(&conn, id)
}

/// Uma violação dos índices únicos também é um conflito (rede de segurança no banco).
fn conflito_ou_erro(e: rusqlite::Error) -> AppError {
    if let rusqlite::Error::SqliteFailure(f, Some(m)) = &e {
        if f.code == rusqlite::ErrorCode::ConstraintViolation && m.contains("UNIQUE") {
            return AppError::Conflito("sala, professor ou turma já ocupados neste dia e horário.".into());
        }
    }
    traduzir(e)
}

fn gravar_atualizacao(conn: &Connection, ctx: &Ctx, id: i64, dados: AulaInput) -> Result<Aula> {
    let atual = aula_por_id(conn, id)?;
    ctx.exigir(conn, "aulas", "editar", Some(atual.escola_id))?;
    if dados.escola_id != atual.escola_id {
        return Err(AppError::msg("Não é possível mudar a aula de escola."));
    }
    validar_referencias(conn, &dados)?;
    let c = conflitos_no_banco(conn, &dados, &[id])?;
    if !c.is_empty() {
        return Err(AppError::Conflito(resumir_conflitos(&c)));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE aulas SET dia_semana=?1, horario_id=?2, sala_id=?3, professor_id=?4, materia_id=?5,
         observacao=?6, atualizado_em=datetime('now') WHERE id=?7",
        params![
            dados.dia_semana, dados.horario_id, dados.sala_id, dados.professor_id,
            dados.materia_id, opcional(dados.observacao.clone()), id
        ],
    )
    .map_err(conflito_ou_erro)?;
    gravar_turmas(&tx, id, &dados.turmas)?;
    tx.commit()?;
    aula_por_id(conn, id)
}

#[tauri::command]
pub fn atualizar_aula(state: State<AppState>, token: String, id: i64, dados: AulaInput) -> Result<Aula> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    gravar_atualizacao(&conn, &ctx, id, dados)
}

/// Move uma aula para outro dia/horário (arrastar e soltar).
#[tauri::command]
pub fn mover_aula(
    state: State<AppState>,
    token: String,
    id: i64,
    dia_semana: i64,
    horario_id: i64,
) -> Result<Aula> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let atual = aula_por_id(&conn, id)?;
    let mut novo = para_input(&atual);
    novo.dia_semana = dia_semana;
    novo.horario_id = horario_id;
    gravar_atualizacao(&conn, &ctx, id, novo)
}

/// Troca de lugar duas aulas (arrastar uma aula sobre outra).
#[tauri::command]
pub fn trocar_aulas(state: State<AppState>, token: String, id_a: i64, id_b: i64) -> Result<()> {
    let mut conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    if id_a == id_b {
        return Ok(());
    }
    let a = aula_por_id(&conn, id_a)?;
    let b = aula_por_id(&conn, id_b)?;
    if a.escola_id != b.escola_id {
        return Err(AppError::SemPermissao);
    }
    ctx.exigir(&conn, "aulas", "editar", Some(a.escola_id))?;
    // Cada aula assume o dia/horário da outra.
    let mut a_novo = para_input(&a);
    a_novo.dia_semana = b.dia_semana;
    a_novo.horario_id = b.horario_id;
    let mut b_novo = para_input(&b);
    b_novo.dia_semana = a.dia_semana;
    b_novo.horario_id = a.horario_id;
    let ignorar = [id_a, id_b];
    for n in [&a_novo, &b_novo] {
        let c = conflitos_no_banco(&conn, n, &ignorar)?;
        if !c.is_empty() {
            return Err(AppError::Conflito(resumir_conflitos(&c)));
        }
    }
    // Os índices únicos são checados a cada comando, então regravamos as duas
    // dentro de uma transação: remove ambas e reinsere com o mesmo id.
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM aulas WHERE id IN (?1, ?2)", [id_a, id_b])?;
    for (id, n) in [(id_a, &a_novo), (id_b, &b_novo)] {
        inserir_aula(&tx, Some(id), n, n.observacao.clone()).map_err(conflito_ou_erro)?;
    }
    tx.commit()?;
    Ok(())
}

/// Move várias aulas de uma vez (bloco de turma dividida) para o mesmo dia/horário, tudo ou nada.
#[tauri::command]
pub fn mover_aulas(state: State<AppState>, token: String, ids: Vec<i64>, dia_semana: i64, horario_id: i64) -> Result<Vec<Aula>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let tx = conn.unchecked_transaction()?;
    let mut saida = Vec::new();
    for id in &ids {
        let atual = aula_por_id(&tx, *id)?;
        ctx.exigir(&tx, "aulas", "editar", Some(atual.escola_id))?;
        let mut n = para_input(&atual);
        n.dia_semana = dia_semana;
        n.horario_id = horario_id;
        validar_referencias(&tx, &n)?;
        let c = conflitos_no_banco(&tx, &n, &ids)?;
        if !c.is_empty() {
            return Err(AppError::Conflito(resumir_conflitos(&c)));
        }
        tx.execute(
            "UPDATE aulas SET dia_semana=?1, horario_id=?2, atualizado_em=datetime('now') WHERE id=?3",
            params![dia_semana, horario_id, id],
        )
        .map_err(conflito_ou_erro)?;
    }
    tx.commit()?;
    for id in &ids {
        saida.push(aula_por_id(&conn, *id)?);
    }
    Ok(saida)
}

/// Copia um bloco de aulas (turma dividida) para outro dia/horário. Com `rodizio`, as
/// matérias/professores/salas giram entre os grupos (A: mat 1, B: mat 2 → A: mat 2, B: mat 1).
#[tauri::command]
pub fn copiar_aulas(
    state: State<AppState>,
    token: String,
    ids: Vec<i64>,
    dia_semana: i64,
    horario_id: i64,
    rodizio: bool,
) -> Result<Vec<Aula>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let mut fontes = Vec::new();
    for id in &ids {
        fontes.push(aula_por_id(&conn, *id)?);
    }
    let n = fontes.len();
    let tx = conn.unchecked_transaction()?;
    let mut novos = Vec::new();
    for (i, f) in fontes.iter().enumerate() {
        ctx.exigir(&tx, "aulas", "criar", Some(f.escola_id))?;
        let mut a = para_input(f);
        if rodizio && n > 1 {
            let o = &fontes[(i + 1) % n];
            a.materia_id = o.materia_id;
            a.professor_id = o.professor_id;
            a.sala_id = o.sala_id;
        }
        a.dia_semana = dia_semana;
        a.horario_id = horario_id;
        validar_referencias(&tx, &a)?;
        let c = conflitos_no_banco(&tx, &a, &[])?;
        if !c.is_empty() {
            return Err(AppError::Conflito(resumir_conflitos(&c)));
        }
        novos.push(inserir_aula(&tx, None, &a, opcional(a.observacao.clone())).map_err(conflito_ou_erro)?);
    }
    tx.commit()?;
    novos.iter().map(|id| aula_por_id(&conn, *id)).collect()
}

/// Exclui várias aulas de uma vez (seleção ou grade inteira).
#[tauri::command]
pub fn excluir_aulas(state: State<AppState>, token: String, ids: Vec<i64>) -> Result<i64> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let tx = conn.unchecked_transaction()?;
    for id in &ids {
        let a = aula_por_id(&tx, *id)?;
        ctx.exigir(&tx, "aulas", "excluir", Some(a.escola_id))?;
        tx.execute("DELETE FROM aulas WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    ctx.auditar(&conn, "excluir", "aulas", None, &format!("{} aula(s) em lote", ids.len()));
    Ok(ids.len() as i64)
}

/// Apaga todas as aulas da escola (botão "Limpar grade").
#[tauri::command]
pub fn limpar_grade(state: State<AppState>, token: String, escola_id: i64) -> Result<i64> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "excluir", Some(escola_id))?;
    let n = conn.execute("DELETE FROM aulas WHERE escola_id = ?1", [escola_id])?;
    ctx.auditar(&conn, "excluir", "aulas", None, &format!("grade limpa: {n} aula(s)"));
    Ok(n as i64)
}

#[tauri::command]
pub fn excluir_aula(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let a = aula_por_id(&conn, id)?;
    ctx.exigir(&conn, "aulas", "excluir", Some(a.escola_id))?;
    conn.execute("DELETE FROM aulas WHERE id = ?1", [id])?;
    ctx.auditar(
        &conn,
        "excluir",
        "aulas",
        Some(id),
        &format!("dia {} horário {} ({} turma(s))", a.dia_semana, a.horario_id, a.turmas.len()),
    );
    Ok(())
}

// ================================ Resumo =================================

#[derive(Serialize)]
pub struct Resumo {
    pub professores: i64,
    pub materias: i64,
    pub salas: i64,
    pub turmas: i64,
    pub faixas_aula: i64,
    pub aulas: i64,
    pub aulas_livres: i64,
    /// Total de posições possíveis (dias úteis × faixas de aula do turno de cada turma).
    pub capacidade_grade: i64,
}

#[tauri::command]
pub fn obter_resumo(state: State<AppState>, token: String, escola_id: i64) -> Result<Resumo> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "ver", Some(escola_id))?;
    let cont = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [escola_id], |r| r.get(0))?) };
    let turmas = cont("SELECT COUNT(*) FROM turmas WHERE escola_id = ?1")?;
    let faixas = cont("SELECT COUNT(*) FROM horarios_base WHERE escola_id = ?1 AND tipo = 'aula'")?;
    // Posições possíveis: para cada turma, as faixas de aula da sua jornada × 5 dias.
    let mut posicoes = 0i64;
    {
        let mut st = conn.prepare("SELECT turno, fim_max_min, grade_id FROM turmas WHERE escola_id = ?1")?;
        let ts: Vec<(String, Option<i64>, i64)> =
            st.query_map([escola_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        let mut st = conn.prepare(
            "SELECT turno, inicio_min, fim_min, grade_id FROM horarios_base WHERE escola_id = ?1 AND tipo = 'aula'",
        )?;
        let fs: Vec<(String, i64, i64, i64)> = st
            .query_map([escola_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (turno, fim_max, grade) in ts {
            let fs: Vec<&(String, i64, i64, i64)> = fs.iter().filter(|f| f.3 == grade).collect();
            let proprias: Vec<&&(String, i64, i64, i64)> = fs.iter().filter(|f| f.0 == turno).collect();
            let (Some(ini_t), Some(fim_t)) = (proprias.iter().map(|f| f.1).min(), proprias.iter().map(|f| f.2).max()) else {
                continue;
            };
            posicoes += fs
                .iter()
                .filter(|f| crate::db::horarios::faixa_permitida(&turno, fim_max, ini_t, fim_t, &f.0, f.1, f.2))
                .count() as i64;
        }
    }
    Ok(Resumo {
        professores: cont("SELECT COUNT(*) FROM professores WHERE escola_id = ?1")?,
        materias: cont("SELECT COUNT(*) FROM materias WHERE escola_id = ?1")?,
        salas: cont("SELECT COUNT(*) FROM salas WHERE escola_id = ?1")?,
        turmas,
        faixas_aula: faixas,
        aulas: cont("SELECT COUNT(*) FROM aulas WHERE escola_id = ?1")?,
        aulas_livres: cont(
            "SELECT COUNT(*) FROM aulas WHERE escola_id = ?1 AND (professor_id IS NULL OR materia_id IS NULL)",
        )?,
        capacidade_grade: 5 * posicoes,
    })
}

// ============================ Feriados e recessos ============================

fn data_valida(t: &str) -> bool {
    chrono::NaiveDate::parse_from_str(t, "%Y-%m-%d").is_ok()
}

fn validar_feriado(d: &FeriadoInput) -> Result<String> {
    let nome = nome_valido(&d.nome, "O nome do feriado")?;
    if !data_valida(&d.data_ini) || !data_valida(&d.data_fim) {
        return Err(AppError::msg("Informe datas válidas."));
    }
    if d.data_fim < d.data_ini {
        return Err(AppError::msg("A data final não pode ser anterior à inicial."));
    }
    Ok(nome)
}

fn feriado_por_id(conn: &Connection, id: i64) -> Result<Feriado> {
    conn.query_row(
        "SELECT id, escola_id, data_ini, data_fim, nome, tipo, bloqueia_assinatura FROM feriados WHERE id = ?1",
        [id],
        |r| Ok(Feriado { id: r.get(0)?, escola_id: r.get(1)?, data_ini: r.get(2)?, data_fim: r.get(3)?, nome: r.get(4)?, tipo: r.get(5)?, bloqueia_assinatura: r.get::<_, i64>(6)? != 0 }),
    )
    .map_err(|_| AppError::msg("Feriado não encontrado."))
}

#[tauri::command]
pub fn listar_feriados(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Feriado>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "ver", Some(escola_id))?;
    let mut st = conn.prepare(
        "SELECT id, escola_id, data_ini, data_fim, nome, tipo, bloqueia_assinatura FROM feriados
         WHERE escola_id = ?1 ORDER BY data_ini, id",
    )?;
    let v = st
        .query_map([escola_id], |r| {
            Ok(Feriado { id: r.get(0)?, escola_id: r.get(1)?, data_ini: r.get(2)?, data_fim: r.get(3)?, nome: r.get(4)?, tipo: r.get(5)?, bloqueia_assinatura: r.get::<_, i64>(6)? != 0 })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

#[tauri::command]
pub fn criar_feriado(state: State<AppState>, token: String, dados: FeriadoInput) -> Result<Feriado> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "horarios", "criar", Some(dados.escola_id))?;
    let nome = validar_feriado(&dados)?;
    conn.execute(
        "INSERT INTO feriados (escola_id, data_ini, data_fim, nome, tipo, bloqueia_assinatura) VALUES (?1,?2,?3,?4,?5,?6)",
        params![dados.escola_id, dados.data_ini, dados.data_fim, nome, dados.tipo, dados.bloqueia_assinatura as i64],
    )?;
    let id = conn.last_insert_rowid();
    ctx.auditar(&conn, "criar", "feriados", Some(id), &format!("{nome} ({} a {})", dados.data_ini, dados.data_fim));
    feriado_por_id(&conn, id)
}

#[tauri::command]
pub fn atualizar_feriado(state: State<AppState>, token: String, id: i64, dados: FeriadoInput) -> Result<Feriado> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let atual = feriado_por_id(&conn, id)?;
    ctx.exigir(&conn, "horarios", "editar", Some(atual.escola_id))?;
    let nome = validar_feriado(&dados)?;
    conn.execute(
        "UPDATE feriados SET data_ini=?1, data_fim=?2, nome=?3, tipo=?4, bloqueia_assinatura=?5 WHERE id=?6",
        params![dados.data_ini, dados.data_fim, nome, dados.tipo, dados.bloqueia_assinatura as i64, id],
    )?;
    ctx.auditar(&conn, "editar", "feriados", Some(id), &nome);
    feriado_por_id(&conn, id)
}

#[tauri::command]
pub fn excluir_feriado(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let f = feriado_por_id(&conn, id)?;
    ctx.exigir(&conn, "horarios", "excluir", Some(f.escola_id))?;
    conn.execute("DELETE FROM feriados WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "feriados", Some(id), &f.nome);
    Ok(())
}

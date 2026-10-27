//! Demandas semanais (aulas por turma e matéria) e geração automática da grade.

use super::{traduzir, AppState};
use crate::auth;
use crate::db::autogerar::{self as motor, Alocacao, Pendencia};
use crate::db::horarios::{buscar_aulas, conflitos_no_banco, inserir_aula, validar_referencias};
use crate::db::models::*;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

fn demanda_de(r: &rusqlite::Row) -> rusqlite::Result<Demanda> {
    Ok(Demanda {
        id: r.get("id")?,
        escola_id: r.get("escola_id")?,
        turma_id: r.get("turma_id")?,
        materia_id: r.get("materia_id")?,
        aulas_semana: r.get("aulas_semana")?,
        professor_id: r.get("professor_id")?,
        sala_id: r.get("sala_id")?,
        max_por_dia: r.get("max_por_dia")?,
    })
}

fn listar_d(conn: &Connection, escola_id: i64) -> Result<Vec<Demanda>> {
    let mut st = conn.prepare("SELECT * FROM demandas WHERE escola_id = ?1 ORDER BY turma_id, id")?;
    let v = st.query_map([escola_id], demanda_de)?.collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

#[tauri::command]
pub fn listar_demandas(state: State<AppState>, token: String, escola_id: i64) -> Result<Vec<Demanda>> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "ver", Some(escola_id))?;
    listar_d(&conn, escola_id)
}

/// Confere se turma, matéria, professor e sala pertencem à escola.
fn validar_demanda(conn: &Connection, d: &DemandaInput) -> Result<()> {
    if !(1..=30).contains(&d.aulas_semana) {
        return Err(AppError::msg("Aulas por semana deve estar entre 1 e 30."));
    }
    if !(1..=6).contains(&d.max_por_dia) {
        return Err(AppError::msg("O máximo por dia deve estar entre 1 e 6."));
    }
    let checagens: [(&str, Option<i64>, &str); 4] = [
        ("turmas", Some(d.turma_id), "Turma"),
        ("materias", Some(d.materia_id), "Matéria"),
        ("professores", d.professor_id, "Professor"),
        ("salas", d.sala_id, "Sala"),
    ];
    for (tabela, id, nome) in checagens {
        if let Some(id) = id {
            let sql = format!("SELECT COUNT(*) FROM {tabela} WHERE id = ?1 AND escola_id = ?2");
            let n: i64 = conn.query_row(&sql, params![id, d.escola_id], |r| r.get(0))?;
            if n == 0 {
                return Err(AppError::msg(format!("{nome} não pertence a esta escola.")));
            }
        }
    }
    Ok(())
}

fn gravar_demanda(conn: &Connection, d: &DemandaInput) -> Result<()> {
    validar_demanda(conn, d)?;
    conn.execute(
        "INSERT INTO demandas (escola_id, turma_id, materia_id, aulas_semana, professor_id, sala_id, max_por_dia)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(turma_id, materia_id) DO UPDATE SET
           aulas_semana = excluded.aulas_semana, professor_id = excluded.professor_id,
           sala_id = excluded.sala_id, max_por_dia = excluded.max_por_dia",
        params![d.escola_id, d.turma_id, d.materia_id, d.aulas_semana, d.professor_id, d.sala_id, d.max_por_dia],
    )
    .map_err(traduzir)?;
    Ok(())
}

/// Cria ou atualiza a demanda de uma matéria numa turma.
#[tauri::command]
pub fn salvar_demanda(state: State<AppState>, token: String, dados: DemandaInput) -> Result<Demanda> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "turmas", "editar", Some(dados.escola_id))?;
    gravar_demanda(&conn, &dados)?;
    ctx.auditar(&conn, "editar", "demandas", None, &format!("turma {} matéria {}", dados.turma_id, dados.materia_id));
    conn.query_row(
        "SELECT * FROM demandas WHERE turma_id = ?1 AND materia_id = ?2",
        params![dados.turma_id, dados.materia_id],
        demanda_de,
    )
    .map_err(|e| traduzir(e))
}

#[tauri::command]
pub fn excluir_demanda(state: State<AppState>, token: String, id: i64) -> Result<()> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola: i64 = conn
        .query_row("SELECT escola_id FROM demandas WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| AppError::msg("Registro não encontrado."))?;
    ctx.exigir(&conn, "turmas", "editar", Some(escola))?;
    conn.execute("DELETE FROM demandas WHERE id = ?1", [id])?;
    ctx.auditar(&conn, "excluir", "demandas", Some(id), "");
    Ok(())
}

/// Copia as demandas de uma turma para outras (ex.: todas as turmas do mesmo ano).
#[tauri::command]
pub fn copiar_demandas(
    state: State<AppState>,
    token: String,
    turma_origem: i64,
    turmas_destino: Vec<i64>,
) -> Result<i64> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    let escola: i64 = conn
        .query_row("SELECT escola_id FROM turmas WHERE id = ?1", [turma_origem], |r| r.get(0))
        .map_err(|_| AppError::msg("Turma não encontrada."))?;
    ctx.exigir(&conn, "turmas", "editar", Some(escola))?;
    let mut st = conn.prepare("SELECT * FROM demandas WHERE turma_id = ?1")?;
    let origem: Vec<Demanda> = st.query_map([turma_origem], demanda_de)?.collect::<rusqlite::Result<_>>()?;
    drop(st);
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for destino in turmas_destino.into_iter().filter(|t| *t != turma_origem) {
        for d in &origem {
            gravar_demanda(
                &tx,
                &DemandaInput {
                    escola_id: escola,
                    turma_id: destino,
                    materia_id: d.materia_id,
                    aulas_semana: d.aulas_semana,
                    professor_id: d.professor_id,
                    sala_id: d.sala_id,
                    max_por_dia: d.max_por_dia,
                },
            )?;
            n += 1;
        }
    }
    tx.commit()?;
    ctx.auditar(&conn, "editar", "demandas", None, &format!("copiadas {n} demandas da turma {turma_origem}"));
    Ok(n)
}

// ============================ Geração automática ============================

#[derive(Serialize)]
pub struct ResultadoGeracao {
    pub alocacoes: Vec<Alocacao>,
    pub pendencias: Vec<Pendencia>,
    pub total_demandado: i64,
    pub total_alocado: i64,
    pub sem_sala: i64,
    /// Aulas removidas no modo "refazer" (só quando aplicado).
    pub removidas: i64,
    /// Aulas efetivamente gravadas (só quando aplicado).
    pub gravadas: i64,
    pub aplicado: bool,
}

fn montar_entrada(
    conn: &Connection,
    escola_id: i64,
    escopo: &HashSet<i64>,
    refazer: bool,
    sabado: bool,
) -> Result<(motor::Entrada, i64, Vec<i64>)> {
    // Faixas de aula, ordenadas por início dentro de cada turno.
    let mut st = conn.prepare(
        "SELECT id, turno, inicio_min, fim_min, grade_id FROM horarios_base WHERE escola_id = ?1 AND tipo = 'aula' ORDER BY inicio_min",
    )?;
    let linhas: Vec<(i64, String, i64, i64, i64)> =
        st.query_map([escola_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut contagem: std::collections::HashMap<(i64, String), usize> = Default::default();
    let faixas: Vec<motor::Faixa> = linhas
        .into_iter()
        .map(|(id, turno, ini, fim, grade_id)| {
            let o = contagem.entry((grade_id, turno.clone())).or_insert(0);
            let f = motor::Faixa { id, grade_id, turno, ordem: *o, ini, fim };
            *o += 1;
            f
        })
        .collect();

    let mut st = conn.prepare("SELECT id, turno, num_alunos, fim_max_min, grade_id FROM turmas WHERE escola_id = ?1")?;
    let turmas: Vec<motor::TurmaE> = st
        .query_map([escola_id], |r| {
            Ok(motor::TurmaE { id: r.get(0)?, turno: r.get(1)?, alunos: r.get(2)?, fim_max: r.get(3)?, grade_id: r.get(4)? })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut st = conn.prepare("SELECT id, disponibilidade, max_aulas_semana, max_aulas_dia, deslocamento_min, intersticio_horas, da_aula_sabado
         FROM professores WHERE escola_id = ?1",
    )?;
    type Linha = (i64, String, Option<i64>, Option<i64>, i64, i64, i64);
    let profs_raw: Vec<Linha> = st
        .query_map([escola_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut professores = Vec::new();
    for (id, json, max_semana, max_dia, desloc, inter_h, sabado) in profs_raw {
        let lista: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap_or_default();
        // Indisponibilidade vale só para a faixa marcada (cada grade tem as suas).
        let indisp = lista
            .iter()
            .filter_map(|v| Some((v["dia"].as_i64()?, v["horario_id"].as_i64()?)))
            .collect();
        let mut st = conn.prepare("SELECT materia_id FROM professor_materias WHERE professor_id = ?1")?;
        let materias: Vec<i64> = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        professores.push(motor::Prof {
            id,
            materias,
            indisp,
            max_semana,
            max_dia,
            desloc_min: desloc,
            intersticio_min: inter_h * 60,
            sem_sabado: sabado == 0,
        });
    }

    let mut st = conn.prepare("SELECT id, tipo, capacidade FROM salas WHERE escola_id = ?1")?;
    let salas: Vec<motor::SalaE> = st
        .query_map([escola_id], |r| Ok(motor::SalaE { id: r.get(0)?, tipo: r.get(1)?, capacidade: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;

    let demandas: Vec<motor::DemandaE> = listar_d(conn, escola_id)?
        .into_iter()
        .filter(|d| escopo.contains(&d.turma_id))
        .map(|d| motor::DemandaE {
            turma_id: d.turma_id,
            materia_id: d.materia_id,
            aulas: d.aulas_semana,
            professor_id: d.professor_id,
            sala_id: d.sala_id,
            max_dia: d.max_por_dia,
        })
        .collect();
    let total: i64 = demandas.iter().map(|d| d.aulas).sum();

    // Aulas existentes; no modo "refazer" ignora (e depois apaga) as que pertencem só a turmas do escopo.
    let todas = buscar_aulas(conn, "SELECT * FROM aulas WHERE escola_id = ?1", [escola_id])?;
    let mut a_remover = Vec::new();
    let mut existentes = Vec::new();
    for a in todas {
        let so_escopo = !a.turmas.is_empty() && a.turmas.iter().all(|t| escopo.contains(&t.turma_id));
        if refazer && so_escopo {
            a_remover.push(a.id);
            continue;
        }
        existentes.push(motor::Existente {
            dia: a.dia_semana,
            horario_id: a.horario_id,
            turma_ids: a.turmas.iter().map(|t| t.turma_id).collect(),
            professor_id: a.professor_id,
            sala_id: a.sala_id,
            materia_id: a.materia_id,
        });
    }

    let entrada = motor::Entrada {
        dias: (1..=if sabado { 6 } else { 5 }).collect(),
        faixas,
        turmas,
        professores,
        salas,
        demandas,
        existentes,
        tentativas: 40,
    };
    Ok((entrada, total, a_remover))
}

/// Gera a grade a partir das demandas. Com `aplicar = false` é só uma prévia (nada é gravado).
/// `modo`: "preencher" (mantém as aulas existentes e completa o que falta) ou "refazer"
/// (apaga as aulas das turmas selecionadas e gera tudo de novo).
#[tauri::command]
pub fn gerar_grade_auto(
    state: State<AppState>,
    token: String,
    escola_id: i64,
    turma_ids: Vec<i64>,
    modo: String,
    incluir_sabado: bool,
    aplicar: bool,
) -> Result<ResultadoGeracao> {
    let conn = state.db.conn();
    let ctx = auth::autenticar(&conn, &token)?;
    ctx.exigir(&conn, "aulas", "criar", Some(escola_id))?;
    let refazer = match modo.as_str() {
        "preencher" => false,
        "refazer" => true,
        _ => return Err(AppError::msg("Modo inválido.")),
    };
    if refazer {
        ctx.exigir(&conn, "aulas", "excluir", Some(escola_id))?;
    }
    let mut stmt = conn.prepare("SELECT id FROM turmas WHERE escola_id = ?1")?;
    let todas: Vec<i64> = stmt.query_map([escola_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let escopo: HashSet<i64> = if turma_ids.is_empty() {
        todas.iter().copied().collect()
    } else {
        turma_ids.into_iter().filter(|t| todas.contains(t)).collect()
    };
    if escopo.is_empty() {
        return Err(AppError::msg("Nenhuma turma selecionada."));
    }

    let (entrada, total, a_remover) = montar_entrada(&conn, escola_id, &escopo, refazer, incluir_sabado)?;
    if entrada.demandas.is_empty() {
        return Err(AppError::msg("Cadastre as aulas por semana (demandas) das turmas antes de gerar."));
    }
    let r = motor::gerar(&entrada);
    let mut res = ResultadoGeracao {
        total_alocado: r.alocacoes.len() as i64,
        total_demandado: total,
        sem_sala: r.sem_sala,
        removidas: 0,
        gravadas: 0,
        aplicado: false,
        alocacoes: r.alocacoes,
        pendencias: r.pendencias,
    };
    if !aplicar {
        return Ok(res);
    }

    // Aplicar: tudo numa transação, revalidando cada aula com as mesmas regras da grade manual.
    let tx = conn.unchecked_transaction()?;
    for id in &a_remover {
        tx.execute("DELETE FROM aulas WHERE id = ?1", [id])?;
    }
    res.removidas = a_remover.len() as i64;
    for a in &res.alocacoes {
        let dados = AulaInput {
            escola_id,
            dia_semana: a.dia,
            horario_id: a.horario_id,
            sala_id: a.sala_id,
            professor_id: a.professor_id,
            materia_id: Some(a.materia_id),
            turmas: vec![TurmaRef { turma_id: a.turma_id, grupo_id: None }],
            observacao: None,
        };
        if validar_referencias(&tx, &dados).is_err() || !conflitos_no_banco(&tx, &dados, &[])?.is_empty() {
            continue; // não deve ocorrer; protege contra qualquer divergência
        }
        inserir_aula(&tx, None, &dados, None).map_err(traduzir)?;
        res.gravadas += 1;
    }
    tx.commit()?;
    res.aplicado = true;
    ctx.auditar(
        &conn,
        "criar",
        "aulas",
        None,
        &format!("geração automática ({modo}): {} aulas gravadas, {} removidas", res.gravadas, res.removidas),
    );
    Ok(res)
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::db;

    #[test]
    fn entrada_do_banco_gera_grade_sem_conflito_e_respeita_disponibilidade() {
        let conn = db::abrir_memoria().unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1,'E');
             INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno) VALUES
               (1,1,1,'1',420,470,'aula','manha'),(2,1,2,'2',470,520,'aula','manha'),(3,1,3,'i',520,535,'intervalo','manha'),
               (4,1,4,'3',535,585,'aula','manha');
             INSERT INTO materias (id, escola_id, nome) VALUES (1,1,'Mat');
             INSERT INTO professores (id, escola_id, nome, disponibilidade) VALUES (1,1,'P', '[{\"dia\":1,\"horario_id\":1},{\"dia\":1,\"horario_id\":2},{\"dia\":1,\"horario_id\":4}]');
             INSERT INTO professor_materias (professor_id, materia_id) VALUES (1,1);
             INSERT INTO salas (id, escola_id, nome) VALUES (1,1,'S1');
             INSERT INTO turmas (id, escola_id, nome) VALUES (1,1,'T1'),(2,1,'T2');
             INSERT INTO demandas (escola_id, turma_id, materia_id, aulas_semana) VALUES (1,1,1,3),(1,2,1,3);",
        )
        .unwrap();
        let escopo: HashSet<i64> = [1, 2].into_iter().collect();
        let (e, total, rem) = montar_entrada(&conn, 1, &escopo, false, false).unwrap();
        assert_eq!(total, 6);
        assert!(rem.is_empty());
        assert_eq!(e.faixas.len(), 3, "intervalo não é faixa de aula");
        let r = motor::gerar(&e);
        assert!(r.pendencias.is_empty(), "{:?}", r.pendencias);
        assert!(r.alocacoes.iter().all(|a| a.dia != 1), "professor indisponível na segunda");
    }
}

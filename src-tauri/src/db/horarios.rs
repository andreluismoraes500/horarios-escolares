//! Regras de horários e de conflitos de aulas.
//!
//! - Geração de faixas de horário a partir de: início, duração da aula,
//!   quantidade de aulas e intervalos (ex.: 15 min após a 3ª aula).
//! - Detecção de conflitos (sala, professor e turma) — funções puras
//!   testáveis, mais a versão que consulta o banco.

use crate::db::models::{Aula, AulaInput, Conflito, TurmaRef};
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Deserialize;

/// Faixa de horário gerada (ainda não gravada no banco).
#[derive(Debug, Clone, PartialEq)]
pub struct Faixa {
    pub rotulo: String,
    pub inicio_min: i64,
    pub fim_min: i64,
    pub tipo: String,
}

/// Intervalo (recreio/lanche) a inserir DEPOIS da aula número `apos_aula`.
#[derive(Debug, Clone, Deserialize)]
pub struct IntervaloCfg {
    pub apos_aula: i64,
    pub duracao_min: i64,
    pub rotulo: Option<String>,
}

/// Converte minutos desde 00:00 em "HH:MM".
pub fn formatar_min(m: i64) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// Duas faixas se sobrepõem quando uma começa antes de a outra terminar
/// (encostar — fim == início — NÃO é sobreposição).
pub fn sobrepoe(a_ini: i64, a_fim: i64, b_ini: i64, b_fim: i64) -> bool {
    a_ini < b_fim && a_fim > b_ini
}

/// Gera a sequência de aulas e intervalos.
///
/// Exemplo: início 07:00, duração 50, 5 aulas, intervalo de 15 min após a 3ª:
/// 1ª 07:00–07:50, 2ª 07:50–08:40, 3ª 08:40–09:30, Intervalo 09:30–09:45,
/// 4ª 09:45–10:35, 5ª 10:35–11:25.
pub fn gerar_faixas(
    inicio_min: i64,
    duracao_min: i64,
    qtd_aulas: i64,
    intervalos: &[IntervaloCfg],
    prefixo: Option<&str>,
) -> Result<Vec<Faixa>> {
    if !(0..1440).contains(&inicio_min) {
        return Err(AppError::msg("Horário de início inválido."));
    }
    if !(1..=480).contains(&duracao_min) {
        return Err(AppError::msg("A duração da aula deve ficar entre 1 e 480 minutos."));
    }
    if !(1..=30).contains(&qtd_aulas) {
        return Err(AppError::msg("A quantidade de aulas deve ficar entre 1 e 30."));
    }
    for i in intervalos {
        if i.apos_aula < 1 || i.apos_aula >= qtd_aulas {
            return Err(AppError::msg(format!(
                "Intervalo após a aula {} é inválido (use de 1 a {}).",
                i.apos_aula,
                qtd_aulas - 1
            )));
        }
        if !(1..=240).contains(&i.duracao_min) {
            return Err(AppError::msg("A duração do intervalo deve ficar entre 1 e 240 minutos."));
        }
    }

    let pre = prefixo
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| format!("{p} · "))
        .unwrap_or_default();

    let mut faixas = Vec::new();
    let mut atual = inicio_min;
    for n in 1..=qtd_aulas {
        faixas.push(Faixa {
            rotulo: format!("{pre}{n}ª aula"),
            inicio_min: atual,
            fim_min: atual + duracao_min,
            tipo: "aula".into(),
        });
        atual += duracao_min;
        for i in intervalos.iter().filter(|i| i.apos_aula == n) {
            let rotulo = i
                .rotulo
                .clone()
                .filter(|r| !r.trim().is_empty())
                .unwrap_or_else(|| "Intervalo".into());
            faixas.push(Faixa {
                rotulo: format!("{pre}{rotulo}"),
                inicio_min: atual,
                fim_min: atual + i.duracao_min,
                tipo: "intervalo".into(),
            });
            atual += i.duracao_min;
        }
    }
    if atual > 1440 {
        return Err(AppError::msg(format!(
            "A sequência ultrapassa a meia-noite (terminaria às {}).",
            formatar_min(atual)
        )));
    }
    Ok(faixas)
}

// ---------------------------------------------------------------------------
// Conflitos de aulas
// ---------------------------------------------------------------------------

/// Duas listas de turmas colidem se alguma turma aparece nas duas e
/// (uma das partes é a turma inteira, ou ambas são o mesmo grupo).
pub fn turmas_colidem(a: &[TurmaRef], b: &[TurmaRef]) -> bool {
    a.iter().any(|x| {
        b.iter().any(|y| {
            x.turma_id == y.turma_id && (x.grupo_id.is_none() || y.grupo_id.is_none() || x.grupo_id == y.grupo_id)
        })
    })
}

/// Preenche `turmas` de cada aula a partir de `aula_turmas`.
pub fn carregar_turmas(conn: &Connection, aulas: &mut [Aula]) -> Result<()> {
    let mut st = conn.prepare("SELECT turma_id, grupo_id FROM aula_turmas WHERE aula_id = ?1 ORDER BY id")?;
    for a in aulas.iter_mut() {
        a.turmas = st
            .query_map([a.id], |r| Ok(TurmaRef { turma_id: r.get(0)?, grupo_id: r.get(1)? }))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(())
}

/// Busca aulas (com turmas) por uma consulta que retorna colunas de `aulas`.
pub fn buscar_aulas(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<Vec<Aula>> {
    let mut st = conn.prepare(sql)?;
    let mut v: Vec<Aula> = st.query_map(p, Aula::from_row)?.collect::<rusqlite::Result<_>>()?;
    carregar_turmas(conn, &mut v)?;
    Ok(v)
}

/// Insere a aula e seus vínculos de turma (com id opcional, usado ao trocar aulas).
pub fn inserir_aula(conn: &Connection, id: Option<i64>, a: &AulaInput, obs: Option<String>) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO aulas (id, escola_id, dia_semana, horario_id, sala_id, professor_id, materia_id, observacao)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, a.escola_id, a.dia_semana, a.horario_id, a.sala_id, a.professor_id, a.materia_id, obs],
    )?;
    let aid = conn.last_insert_rowid();
    gravar_turmas(conn, aid, &a.turmas)?;
    Ok(aid)
}

pub fn gravar_turmas(conn: &Connection, aula_id: i64, turmas: &[TurmaRef]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM aula_turmas WHERE aula_id = ?1", [aula_id])?;
    for t in turmas {
        conn.execute(
            "INSERT INTO aula_turmas (aula_id, turma_id, grupo_id) VALUES (?1,?2,?3)",
            params![aula_id, t.turma_id, t.grupo_id],
        )?;
    }
    Ok(())
}

/// Remove aulas que ficaram sem nenhuma turma (turma ou grupo excluído).
pub fn limpar_aulas_orfas(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM aulas WHERE id NOT IN (SELECT aula_id FROM aula_turmas)", [])?;
    Ok(())
}

/// Compara uma aula nova/editada com as aulas já existentes (que o chamador já filtrou para o
/// mesmo dia e horário sobreposto) e devolve os conflitos encontrados.
/// Aula "livre" (sem professor) ou sem sala não gera conflito nesse recurso.
pub fn detectar_conflitos(
    existentes: &[Aula],
    nova: &AulaInput,
    ignorar: &[i64],
) -> Vec<Conflito> {
    let mut out = Vec::new();
    for e in existentes {
        if ignorar.contains(&e.id)
            || e.escola_id != nova.escola_id
            || e.dia_semana != nova.dia_semana
        {
            continue;
        }
        if nova.sala_id.is_some() && e.sala_id == nova.sala_id {
            out.push(Conflito {
                tipo: "sala".into(),
                aula_id: e.id,
                mensagem: "A sala já está ocupada neste dia e horário.".into(),
            });
        }
        if nova.professor_id.is_some() && e.professor_id == nova.professor_id {
            out.push(Conflito {
                tipo: "professor".into(),
                aula_id: e.id,
                mensagem: "O professor já tem aula em outra turma/sala neste dia e horário.".into(),
            });
        }
        if turmas_colidem(&e.turmas, &nova.turmas) {
            out.push(Conflito {
                tipo: "turma".into(),
                aula_id: e.id,
                mensagem: "A turma já tem outra aula neste dia e horário.".into(),
            });
        }
    }
    out
}

/// Busca no banco as aulas do mesmo dia/horário e detecta conflitos.
pub fn conflitos_no_banco(
    conn: &Connection,
    nova: &AulaInput,
    ignorar: &[i64],
) -> Result<Vec<Conflito>> {
    // Aulas do mesmo dia cuja faixa se sobrepõe no relógio à da nova aula (inclui a própria faixa).
    let existentes = buscar_aulas(
        conn,
        "SELECT a.* FROM aulas a
           JOIN horarios_base h ON h.id = a.horario_id
           JOIN horarios_base n ON n.id = ?3
          WHERE a.escola_id = ?1 AND a.dia_semana = ?2
            AND (a.horario_id = n.id OR (h.inicio_min < n.fim_min AND h.fim_min > n.inicio_min))",
        params![nova.escola_id, nova.dia_semana, nova.horario_id],
    )?;
    Ok(detectar_conflitos(&existentes, nova, ignorar))
}

/// Avisos não bloqueantes sobre o professor: indisponibilidade, sábado, deslocamento,
/// limites de aulas por dia/semana e interstício entre jornadas.
/// `ignorar` lista aulas que serão movidas/regravadas (não contam na carga).
pub fn avisos_disponibilidade(conn: &Connection, nova: &AulaInput, ignorar: &[i64]) -> Result<Vec<String>> {
    let mut avisos = Vec::new();
    let Some(pid) = nova.professor_id else { return Ok(avisos) };
    let (json, max_sem, max_dia, desloc, inter_h, sabado): (String, Option<i64>, Option<i64>, i64, i64, i64) = conn
        .query_row(
            "SELECT disponibilidade, max_aulas_semana, max_aulas_dia, deslocamento_min, intersticio_horas, da_aula_sabado
             FROM professores WHERE id = ?1",
            params![pid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )?;
    let lista: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap_or_default();
    let tempo = |hid: i64| -> Option<(i64, i64)> {
        conn.query_row("SELECT inicio_min, fim_min FROM horarios_base WHERE id = ?1", [hid], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
    };
    if nova.dia_semana == 6 && sabado == 0 {
        avisos.push("O professor não dá aula aos sábados.".into());
    }
    let Some((ini, fim)) = tempo(nova.horario_id) else { return Ok(avisos) };
    // A indisponibilidade vale só para a faixa marcada (cada grade tem as suas).
    let indisponivel = lista
        .iter()
        .any(|v| v["dia"].as_i64() == Some(nova.dia_semana) && v["horario_id"].as_i64() == Some(nova.horario_id));
    if indisponivel {
        avisos.push("O professor está marcado como indisponível neste período.".into());
    }
    // Deslocamento até/de outro local de trabalho (períodos indisponíveis do mesmo dia).
    if desloc > 0 {
        for v in &lista {
            if v["dia"].as_i64() != Some(nova.dia_semana) {
                continue;
            }
            let Some(uh) = v["horario_id"].as_i64() else { continue };
            if uh == nova.horario_id {
                continue;
            }
            if let Some((ui, uf)) = tempo(uh) {
                if sobrepoe(ini, fim, ui, uf) {
                    continue;
                }
                let gap = if fim <= ui { ui - fim } else if uf <= ini { ini - uf } else { 0 };
                if gap < desloc {
                    avisos.push(format!(
                        "O professor precisa de {desloc} min de deslocamento em relação ao outro compromisso ({}).",
                        formatar_min(if fim <= ui { ui } else { uf })
                    ));
                    break;
                }
            }
        }
    }
    // Carga e interstício, considerando as demais aulas do professor.
    let mut st = conn.prepare(
        "SELECT a.id, a.dia_semana, h.inicio_min, h.fim_min FROM aulas a
         JOIN horarios_base h ON h.id = a.horario_id WHERE a.professor_id = ?1",
    )?;
    let outras: Vec<(i64, i64, i64)> = st
        .query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|(id, ..)| !ignorar.contains(id))
        .map(|(_, d, i, f)| (d, i, f))
        .collect();
    if let Some(m) = max_sem {
        if outras.len() as i64 + 1 > m {
            avisos.push(format!("Passa do limite de {m} aulas por semana do professor."));
        }
    }
    if let Some(m) = max_dia {
        let hoje = outras.iter().filter(|x| x.0 == nova.dia_semana).count() as i64;
        if hoje + 1 > m {
            avisos.push(format!("Passa do limite de {m} aulas por dia do professor."));
        }
    }
    if inter_h > 0 {
        let minimo = inter_h * 60;
        let hoje: Vec<&(i64, i64, i64)> = outras.iter().filter(|x| x.0 == nova.dia_semana).collect();
        let primeiro = hoje.iter().map(|x| x.1).chain([ini]).min().unwrap_or(ini);
        let ultimo = hoje.iter().map(|x| x.2).chain([fim]).max().unwrap_or(fim);
        let fim_ontem = outras.iter().filter(|x| x.0 == nova.dia_semana - 1).map(|x| x.2).max();
        let ini_amanha = outras.iter().filter(|x| x.0 == nova.dia_semana + 1).map(|x| x.1).min();
        let viola = fim_ontem.map_or(false, |f| 1440 - f + primeiro < minimo)
            || ini_amanha.map_or(false, |i| 1440 - ultimo + i < minimo);
        if viola {
            avisos.push(format!("Não respeita o interstício mínimo de {inter_h} h entre jornadas do professor."));
        }
    }
    Ok(avisos)
}

/// Garante que todos os vínculos da aula pertencem à mesma escola
/// e que o horário escolhido é uma aula (não um intervalo).
pub fn validar_referencias(conn: &Connection, a: &AulaInput) -> Result<()> {
    if !(1..=7).contains(&a.dia_semana) {
        return Err(AppError::msg("Dia da semana inválido."));
    }
    let horario: Option<(String, String, i64)> = conn
        .query_row(
            "SELECT tipo, turno, grade_id FROM horarios_base WHERE id = ?1 AND escola_id = ?2",
            params![a.horario_id, a.escola_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let (tipo, turno_horario, grade_horario) = match horario {
        None => return Err(AppError::msg("Horário não encontrado nesta escola.")),
        Some(h) => h,
    };
    if tipo == "intervalo" {
        return Err(AppError::msg("Não é possível alocar aulas em um intervalo."));
    }
    // Nomes de tabela fixos (nunca vindos do usuário); os ids são parametrizados.
    let checagens: [(&str, Option<i64>, &str); 3] = [
        ("salas", a.sala_id, "Sala"),
        ("professores", a.professor_id, "Professor"),
        ("materias", a.materia_id, "Matéria"),
    ];
    if a.turmas.is_empty() {
        return Err(AppError::msg("Selecione ao menos uma turma."));
    }
    for (tabela, id, nome) in checagens {
        if let Some(id) = id {
            let sql = format!("SELECT COUNT(*) FROM {tabela} WHERE id = ?1 AND escola_id = ?2");
            let n: i64 = conn.query_row(&sql, params![id, a.escola_id], |r| r.get(0))?;
            if n == 0 {
                return Err(AppError::msg(format!("{nome} não pertence a esta escola.")));
            }
        }
    }
    // Turmas/grupos da escola, sem repetição, e dentro da jornada da turma.
    let (h_ini, h_fim): (i64, i64) = conn.query_row(
        "SELECT inicio_min, fim_min FROM horarios_base WHERE id = ?1",
        params![a.horario_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    for (i, t) in a.turmas.iter().enumerate() {
        if a.turmas[..i].contains(t) {
            return Err(AppError::msg("Turma repetida na aula."));
        }
        let (turno_turma, fim_max, nome_turma, grade_turma): (String, Option<i64>, String, i64) = conn
            .query_row(
                "SELECT turno, fim_max_min, nome, grade_id FROM turmas WHERE id = ?1 AND escola_id = ?2",
                params![t.turma_id, a.escola_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|_| AppError::msg("Turma não pertence a esta escola."))?;
        if grade_turma != grade_horario {
            return Err(AppError::msg(format!(
                "A turma {nome_turma} usa outra grade de horários; este horário não pertence a ela."
            )));
        }
        if let Some(g) = t.grupo_id {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM grupos WHERE id = ?1 AND turma_id = ?2",
                params![g, t.turma_id],
                |r| r.get(0),
            )?;
            if n == 0 {
                return Err(AppError::msg("O grupo não pertence à turma."));
            }
        }
        let (ini_t, fim_t) = limites_do_turno(conn, grade_turma, &turno_turma)?.unwrap_or((0, 1440));
        if !faixa_permitida(&turno_turma, fim_max, ini_t, fim_t, &turno_horario, h_ini, h_fim) {
            return Err(AppError::msg(format!(
                "A turma {nome_turma} (turno {}{}) não tem aula neste horário.",
                nome_turno(&turno_turma).trim_start_matches("da ").trim_start_matches("de "),
                fim_max.map(|f| format!(", termina às {}", formatar_min(f))).unwrap_or_default()
            )));
        }
    }
    Ok(())
}

/// A turma pode ter aula nesta faixa? Regra: a faixa começa depois do início do turno da turma e termina
/// até `fim_max_min` (padrão: fim do turno). Faixas de outro turno só valem se começarem depois do fim do turno
/// da turma (jornada estendida).
pub fn faixa_permitida(
    turno_turma: &str,
    fim_max_min: Option<i64>,
    inicio_turno: i64,
    fim_turno: i64,
    h_turno: &str,
    h_ini: i64,
    h_fim: i64,
) -> bool {
    let limite = fim_max_min.unwrap_or(fim_turno);
    h_ini >= inicio_turno && h_fim <= limite && (h_turno == turno_turma || h_ini >= fim_turno)
}

/// Início e fim (min) do turno da turma, considerando apenas faixas de aula.
pub fn limites_do_turno(conn: &Connection, grade_id: i64, turno: &str) -> Result<Option<(i64, i64)>> {
    let r: (Option<i64>, Option<i64>) = conn.query_row(
        "SELECT MIN(inicio_min), MAX(fim_min) FROM horarios_base WHERE grade_id = ?1 AND turno = ?2 AND tipo = 'aula'",
        params![grade_id, turno],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(match r {
        (Some(a), Some(b)) => Some((a, b)),
        _ => None,
    })
}

/// Nome do turno para mensagens.
pub fn nome_turno(t: &str) -> &'static str {
    match t {
        "manha" => "da manhã",
        "tarde" => "da tarde",
        _ => "da noite",
    }
}

/// Mensagem única com todos os conflitos (para erro de gravação).
pub fn resumir_conflitos(c: &[Conflito]) -> String {
    let mut tipos: Vec<&str> = c.iter().map(|x| x.mensagem.as_str()).collect();
    tipos.dedup();
    tipos.join(" ")
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::db;

    fn aula(id: i64, sala: Option<i64>, prof: Option<i64>, turma: i64) -> Aula {
        Aula {
            id,
            escola_id: 1,
            dia_semana: 1,
            horario_id: 10,
            sala_id: sala,
            professor_id: prof,
            materia_id: None,
            turmas: vec![TurmaRef { turma_id: turma, grupo_id: None }],
            observacao: None,
        }
    }

    fn nova(sala: Option<i64>, prof: Option<i64>, turma: i64) -> AulaInput {
        AulaInput {
            escola_id: 1,
            dia_semana: 1,
            horario_id: 10,
            sala_id: sala,
            professor_id: prof,
            materia_id: None,
            turmas: vec![TurmaRef { turma_id: turma, grupo_id: None }],
            observacao: None,
        }
    }

    #[test]
    fn gera_aulas_de_50_minutos_sem_intervalo() {
        let f = gerar_faixas(7 * 60, 50, 2, &[], None).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!((f[0].inicio_min, f[0].fim_min), (420, 470)); // 07:00–07:50
        assert_eq!((f[1].inicio_min, f[1].fim_min), (470, 520)); // 07:50–08:40
        assert_eq!(formatar_min(f[1].fim_min), "08:40");
    }

    #[test]
    fn gera_com_intervalo_de_15_minutos() {
        let iv = [IntervaloCfg { apos_aula: 3, duracao_min: 15, rotulo: Some("Recreio".into()) }];
        let f = gerar_faixas(7 * 60, 50, 5, &iv, None).unwrap();
        assert_eq!(f.len(), 6);
        assert_eq!(f[3].tipo, "intervalo");
        assert_eq!(f[3].rotulo, "Recreio");
        assert_eq!(formatar_min(f[3].inicio_min), "09:30");
        assert_eq!(formatar_min(f[3].fim_min), "09:45");
        assert_eq!(formatar_min(f[4].inicio_min), "09:45"); // 4ª aula começa após o intervalo
        assert_eq!(formatar_min(f[5].fim_min), "11:25");
    }

    #[test]
    fn aceita_inicios_quebrados_como_0710_e_0915() {
        let f = gerar_faixas(7 * 60 + 10, 40, 2, &[], None).unwrap();
        assert_eq!(formatar_min(f[0].inicio_min), "07:10");
        assert_eq!(formatar_min(f[1].fim_min), "08:30");
        let g = gerar_faixas(9 * 60 + 15, 45, 1, &[], Some("Tarde")).unwrap();
        assert_eq!(formatar_min(g[0].inicio_min), "09:15");
        assert_eq!(g[0].rotulo, "Tarde · 1ª aula");
    }

    #[test]
    fn rejeita_parametros_invalidos() {
        assert!(gerar_faixas(0, 0, 5, &[], None).is_err());
        assert!(gerar_faixas(23 * 60, 50, 3, &[], None).is_err()); // passa da meia-noite
        let iv = [IntervaloCfg { apos_aula: 5, duracao_min: 15, rotulo: None }];
        assert!(gerar_faixas(420, 50, 5, &iv, None).is_err()); // intervalo após a última aula
    }

    #[test]
    fn sobreposicao_de_faixas() {
        assert!(sobrepoe(420, 470, 460, 500));
        assert!(!sobrepoe(420, 470, 470, 520)); // encostar não conta
    }

    #[test]
    fn detecta_conflito_de_sala() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let c = detectar_conflitos(&ex, &nova(Some(5), Some(2), 2), &[]);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].tipo, "sala");
    }

    #[test]
    fn detecta_conflito_de_professor() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let c = detectar_conflitos(&ex, &nova(Some(6), Some(1), 2), &[]);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].tipo, "professor");
    }

    #[test]
    fn detecta_conflito_de_turma() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let c = detectar_conflitos(&ex, &nova(Some(6), Some(2), 1), &[]);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].tipo, "turma");
    }

    #[test]
    fn detecta_varios_conflitos_juntos() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let c = detectar_conflitos(&ex, &nova(Some(5), Some(1), 1), &[]);
        assert_eq!(c.len(), 3);
    }

    #[test]
    fn sem_conflito_quando_tudo_diferente() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        assert!(detectar_conflitos(&ex, &nova(Some(6), Some(2), 2), &[]).is_empty());
    }

    #[test]
    fn aula_livre_sem_professor_nao_conflita_em_professor() {
        let ex = [aula(1, Some(5), None, 1)];
        let c = detectar_conflitos(&ex, &nova(Some(6), None, 2), &[]);
        assert!(c.is_empty());
    }

    #[test]
    fn ignora_a_propria_aula_ao_editar_ou_mover() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let c = detectar_conflitos(&ex, &nova(Some(5), Some(1), 1), &[1]);
        assert!(c.is_empty());
    }

    #[test]
    fn dia_ou_horario_diferente_nao_conflita() {
        let ex = [aula(1, Some(5), Some(1), 1)];
        let mut n = nova(Some(5), Some(1), 1);
        n.dia_semana = 2;
        assert!(detectar_conflitos(&ex, &n, &[]).is_empty());
    }

    /// Cria banco em memória com 1 escola, 1 horário e cadastros mínimos.
    fn banco_de_teste() -> Connection {
        let conn = db::abrir_memoria().unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1, 'Teste');
             INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo)
                VALUES (10, 1, 1, '1ª aula', 420, 470, 'aula'),
                       (11, 1, 2, 'Intervalo', 470, 485, 'intervalo');
             INSERT INTO salas (id, escola_id, nome) VALUES (1,1,'S1'),(2,1,'S2');
             INSERT INTO professores (id, escola_id, nome) VALUES (1,1,'P1'),(2,1,'P2');
             INSERT INTO turmas (id, escola_id, nome) VALUES (1,1,'T1'),(2,1,'T2');",
        )
        .unwrap();
        conn
    }

    fn inserir(conn: &Connection, a: &AulaInput) -> rusqlite::Result<usize> {
        inserir_aula(conn, None, a, None).map(|_| 1)
    }

    #[test]
    fn conflitos_do_banco_barram_sala_e_professor_duplicados() {
        let conn = banco_de_teste();
        inserir(&conn, &nova(Some(1), Some(1), 1)).unwrap();
        let c = conflitos_no_banco(&conn, &nova(Some(1), Some(2), 2), &[]).unwrap();
        assert_eq!(c.iter().map(|x| x.tipo.as_str()).collect::<Vec<_>>(), ["sala"], "sala duplicada");
        let c = conflitos_no_banco(&conn, &nova(Some(2), Some(1), 2), &[]).unwrap();
        assert_eq!(c.iter().map(|x| x.tipo.as_str()).collect::<Vec<_>>(), ["professor"], "professor duplicado");
        assert!(conflitos_no_banco(&conn, &nova(Some(2), Some(2), 2), &[]).unwrap().is_empty());
    }

    #[test]
    fn grades_diferentes_conflitam_pelo_horario_real() {
        let conn = banco_de_teste();
        // Grade "Enfermagem": faixa 07:30–08:20 sobrepõe a 1ª aula (07:00–07:50) da grade padrão.
        conn.execute_batch(
            "INSERT INTO grades (id, escola_id, nome) VALUES (50, 1, 'Enfermagem');
             INSERT INTO horarios_base (id, escola_id, grade_id, ordem, rotulo, inicio_min, fim_min, tipo)
                VALUES (20, 1, 50, 1, '1ª aula', 450, 500, 'aula'),
                       (21, 1, 50, 2, '2ª aula', 500, 550, 'aula');
             INSERT INTO turmas (id, escola_id, nome, grade_id) VALUES (7, 1, 'ENF', 50);",
        )
        .unwrap();
        // Professor 1 ocupado 07:00–07:50 na grade padrão.
        inserir(&conn, &nova(Some(1), Some(1), 1)).unwrap();
        let mut n = nova(Some(2), Some(1), 7);
        n.horario_id = 20; // 07:30–08:20 sobrepõe
        assert_eq!(conflitos_no_banco(&conn, &n, &[]).unwrap().len(), 1);
        n.horario_id = 21; // 08:20–09:10 não sobrepõe
        assert!(conflitos_no_banco(&conn, &n, &[]).unwrap().is_empty());
        // Turma de uma grade não pode usar a faixa de outra.
        let mut errada = nova(None, None, 7);
        errada.horario_id = 10;
        assert!(validar_referencias(&conn, &errada).is_err());
        errada.horario_id = 20;
        assert!(validar_referencias(&conn, &errada).is_ok());
    }

    #[test]
    fn varias_aulas_livres_no_mesmo_horario_sao_permitidas() {
        let conn = banco_de_teste();
        inserir(&conn, &nova(None, None, 1)).unwrap();
        assert!(inserir(&conn, &nova(None, None, 2)).is_ok());
    }

    #[test]
    fn conflitos_no_banco_encontra_aula_existente() {
        let conn = banco_de_teste();
        inserir(&conn, &nova(Some(1), Some(1), 1)).unwrap();
        let c = conflitos_no_banco(&conn, &nova(Some(1), Some(1), 2), &[]).unwrap();
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn nao_permite_aula_em_intervalo() {
        let conn = banco_de_teste();
        let mut a = nova(Some(1), Some(1), 1);
        a.horario_id = 11;
        assert!(validar_referencias(&conn, &a).is_err());
        a.horario_id = 10;
        assert!(validar_referencias(&conn, &a).is_ok());
    }

    #[test]
    fn turma_so_pode_ter_aula_no_horario_do_seu_turno() {
        let conn = banco_de_teste();
        conn.execute_batch(
            "INSERT INTO turmas (id, escola_id, nome, turno) VALUES (3,1,'T3','tarde');
             INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
                VALUES (12, 1, 3, '1ª aula', 800, 850, 'aula', 'tarde');",
        )
        .unwrap();
        // Turma da tarde no horário da manhã: recusado
        let erro = validar_referencias(&conn, &nova(Some(1), Some(1), 3)).unwrap_err().to_string();
        assert!(erro.contains("turno"), "{erro}");
        // Turma da tarde no horário da tarde: ok
        let mut a = nova(Some(1), Some(1), 3);
        a.horario_id = 12;
        assert!(validar_referencias(&conn, &a).is_ok());
        // Turma da manhã no horário da tarde: recusado
        let mut b = nova(Some(1), Some(1), 1);
        b.horario_id = 12;
        assert!(validar_referencias(&conn, &b).is_err());
    }

    #[test]
    fn avisa_quando_professor_esta_indisponivel() {
        let conn = banco_de_teste();
        conn.execute(
            "UPDATE professores SET disponibilidade = ?1 WHERE id = 1",
            params![r#"[{"dia":1,"horario_id":10}]"#],
        )
        .unwrap();
        let avisos = avisos_disponibilidade(&conn, &nova(Some(1), Some(1), 1), &[]).unwrap();
        assert_eq!(avisos.len(), 1);
        assert!(avisos_disponibilidade(&conn, &nova(Some(1), Some(2), 1), &[]).unwrap().is_empty());
    }

    fn com_turmas(mut a: AulaInput, t: &[(i64, Option<i64>)]) -> AulaInput {
        a.turmas = t.iter().map(|(t, g)| TurmaRef { turma_id: *t, grupo_id: *g }).collect();
        a
    }

    #[test]
    fn grupos_diferentes_da_mesma_turma_podem_ter_aulas_simultaneas() {
        let conn = banco_de_teste();
        conn.execute_batch("INSERT INTO grupos (id, escola_id, turma_id, nome) VALUES (1,1,1,'G1'),(2,1,1,'G2');").unwrap();
        // G1 na sala 1 com prof 1; G2 no laboratório (sala 2) com prof 2.
        let a = com_turmas(nova(Some(1), Some(1), 1), &[(1, Some(1))]);
        let b = com_turmas(nova(Some(2), Some(2), 1), &[(1, Some(2))]);
        validar_referencias(&conn, &a).unwrap();
        inserir_aula(&conn, None, &a, None).unwrap();
        assert!(conflitos_no_banco(&conn, &b, &[]).unwrap().is_empty());
        inserir_aula(&conn, None, &b, None).unwrap();
    }

    #[test]
    fn turma_inteira_conflita_com_grupo_e_grupo_com_grupo_igual() {
        let conn = banco_de_teste();
        conn.execute_batch("INSERT INTO grupos (id, escola_id, turma_id, nome) VALUES (1,1,1,'G1'),(2,1,1,'G2');").unwrap();
        inserir_aula(&conn, None, &com_turmas(nova(Some(1), Some(1), 1), &[(1, Some(1))]), None).unwrap();
        let inteira = com_turmas(nova(Some(2), Some(2), 1), &[(1, None)]);
        assert_eq!(conflitos_no_banco(&conn, &inteira, &[]).unwrap()[0].tipo, "turma");
        let mesmo = com_turmas(nova(Some(2), Some(2), 1), &[(1, Some(1))]);
        assert_eq!(conflitos_no_banco(&conn, &mesmo, &[]).unwrap().len(), 1);
    }

    #[test]
    fn aula_conjunta_ocupa_todas_as_turmas() {
        let conn = banco_de_teste();
        let conj = com_turmas(nova(Some(1), Some(1), 1), &[(1, None), (2, None)]);
        validar_referencias(&conn, &conj).unwrap();
        inserir_aula(&conn, None, &conj, None).unwrap();
        // Qualquer uma das duas turmas fica ocupada no horário.
        for t in [1, 2] {
            let c = conflitos_no_banco(&conn, &nova(Some(2), Some(2), t), &[]).unwrap();
            assert_eq!(c[0].tipo, "turma");
        }
        let lidas = buscar_aulas(&conn, "SELECT * FROM aulas", []).unwrap();
        assert_eq!(lidas[0].turmas.len(), 2);
    }

    #[test]
    fn rejeita_grupo_de_outra_turma_e_turma_repetida() {
        let conn = banco_de_teste();
        conn.execute_batch("INSERT INTO grupos (id, escola_id, turma_id, nome) VALUES (1,1,2,'G1');").unwrap();
        assert!(validar_referencias(&conn, &com_turmas(nova(None, None, 1), &[(1, Some(1))])).is_err());
        assert!(validar_referencias(&conn, &com_turmas(nova(None, None, 1), &[(1, None), (1, None)])).is_err());
        assert!(validar_referencias(&conn, &com_turmas(nova(None, None, 1), &[])).is_err());
    }

    #[test]
    fn excluir_turma_ou_grupo_remove_aulas_orfas() {
        let conn = banco_de_teste();
        inserir_aula(&conn, None, &com_turmas(nova(Some(1), Some(1), 1), &[(1, None), (2, None)]), None).unwrap();
        inserir_aula(&conn, None, &nova(Some(2), Some(2), 2), None).unwrap();
        conn.execute("DELETE FROM turmas WHERE id = 2", []).unwrap();
        limpar_aulas_orfas(&conn).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM aulas", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "a conjunta continua (turma 1); a exclusiva da turma 2 some");
    }

    #[test]
    fn avisa_sabado_limites_deslocamento_e_intersticio() {
        let conn = banco_de_teste();
        conn.execute_batch(
            "INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno) VALUES
               (20, 1, 5, 'tarde', 520, 570, 'aula', 'manha'),
               (21, 1, 6, 'noite', 1260, 1310, 'aula', 'manha');
             UPDATE professores SET max_aulas_dia = 1, max_aulas_semana = 1, deslocamento_min = 60,
                 intersticio_horas = 11, da_aula_sabado = 0,
                 disponibilidade = '[{\"dia\":1,\"horario_id\":20}]' WHERE id = 1;",
        )
        .unwrap();
        // Aula existente do professor 1 na terça à noite (21:00–21:50).
        let mut ex = nova(Some(1), Some(1), 1);
        ex.dia_semana = 2;
        ex.horario_id = 21;
        inserir_aula(&conn, None, &ex, None).unwrap();
        // Segunda 07:00: perto do compromisso externo das 08:40 (deslocamento), passa dos limites
        // e a jornada de terça termina 21:50 → intervalo até 07:00 de quarta seria pequeno, mas aqui é segunda.
        let a = avisos_disponibilidade(&conn, &nova(Some(2), Some(1), 2), &[]).unwrap();
        let t = a.join(" | ");
        assert!(t.contains("deslocamento"), "{t}");
        assert!(t.contains("por semana"), "{t}");
        // Quarta 07:00 depois da terça até 21:50: só 9h10 de descanso → interstício
        let mut q = nova(Some(2), Some(1), 2);
        q.dia_semana = 3;
        let t = avisos_disponibilidade(&conn, &q, &[]).unwrap().join(" | ");
        assert!(t.contains("interstício"), "{t}");
        // Sábado
        let mut sab = nova(Some(2), Some(1), 2);
        sab.dia_semana = 6;
        let t = avisos_disponibilidade(&conn, &sab, &[]).unwrap().join(" | ");
        assert!(t.contains("sábados"), "{t}");
        // Ignorando a aula existente, a carga semanal/diária volta ao normal
        let id: i64 = conn.query_row("SELECT id FROM aulas LIMIT 1", [], |r| r.get(0)).unwrap();
        let t = avisos_disponibilidade(&conn, &nova(Some(2), Some(1), 2), &[id]).unwrap().join(" | ");
        assert!(!t.contains("por semana") && !t.contains("por dia"), "{t}");
    }

    #[test]
    fn turma_com_jornada_estendida_aceita_faixas_do_turno_seguinte() {
        let conn = banco_de_teste();
        conn.execute_batch(
            "INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno) VALUES
               (30, 1, 5, 't1', 780, 830, 'aula', 'tarde'),
               (31, 1, 6, 't2', 830, 880, 'aula', 'tarde');
             UPDATE turmas SET fim_max_min = 830 WHERE id = 1;",
        )
        .unwrap();
        let mut a = nova(Some(1), Some(1), 1);
        a.horario_id = 30; // 13:00–13:50, dentro do limite 13:50
        assert!(validar_referencias(&conn, &a).is_ok());
        a.horario_id = 31; // 13:50–14:40, passa do limite
        assert!(validar_referencias(&conn, &a).is_err());
        // Turma sem limite continua restrita ao turno.
        let mut b = nova(Some(1), Some(1), 2);
        b.horario_id = 30;
        assert!(validar_referencias(&conn, &b).is_err());
    }
}

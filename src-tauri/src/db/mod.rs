//! Acesso ao banco SQLite: abertura, migrations automáticas e matriz de permissões.

pub mod autogerar;
pub mod horarios;
pub mod models;
pub mod seed;

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

/// Migrations embutidas no executável (aplicadas em ordem via PRAGMA user_version).
const MIGRACOES: &[&str] = &[
    include_str!("../../migrations/001_inicial.sql"),
    include_str!("../../migrations/002_turnos.sql"),
    include_str!("../../migrations/003_grupos_e_aulas_conjuntas.sql"),
    include_str!("../../migrations/004_demandas.sql"),
    include_str!("../../migrations/005_cor_professor.sql"),
    include_str!("../../migrations/006_limites_professor.sql"),
    include_str!("../../migrations/007_turma_fim_max.sql"),
    include_str!("../../migrations/008_grades_de_horario.sql"),
    include_str!("../../migrations/009_feriados.sql"),
];

/// Paleta usada para dar cor automática aos professores.
pub const PALETA_PROFESSORES: [&str; 12] = [
    "#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2",
    "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#be123c",
];

/// Conexão única compartilhada pelos comandos Tauri.
pub struct Db(Mutex<Connection>);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Db(Mutex::new(conn))
    }

    /// Obtém a conexão (bloqueia até estar livre).
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Abre (ou cria) o banco em disco, aplica migrations e garante os dados iniciais.
pub fn abrir(caminho: &Path) -> Result<Connection> {
    let conn = Connection::open(caminho)?;
    preparar(&conn)?;
    seed::semear_se_vazio(&conn)?;
    Ok(conn)
}

/// Banco em memória (usado nos testes), sem dados de demonstração.
pub fn abrir_memoria() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    preparar(&conn)?;
    Ok(conn)
}

fn preparar(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrar(conn)?;
    semear_permissoes(conn)?;
    Ok(())
}

/// Aplica as migrations pendentes, cada uma dentro de uma transação.
pub fn migrar(conn: &Connection) -> Result<()> {
    let atual: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if atual >= MIGRACOES.len() {
        return Ok(());
    }
    // Migrations que recriam tabelas precisam de chaves estrangeiras desligadas (fora da transação),
    // senão o DROP TABLE apagaria em cascata as linhas dependentes (ex.: aulas).
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let r = aplicar(conn, atual);
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    r
}

fn aplicar(conn: &Connection, atual: usize) -> Result<()> {
    for (i, sql) in MIGRACOES.iter().enumerate().skip(atual) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Recursos controlados pelo RBAC.
const RECURSOS: &[&str] = &[
    "escolas", "usuarios", "professores", "materias", "salas", "turmas", "horarios", "aulas",
    "backup", "relatorios", "auditoria",
];

/// Matriz papel → (recursos, ações).
fn matriz() -> Vec<(&'static str, &'static str, &'static str)> {
    let todas = ["ver", "criar", "editar", "excluir"];
    let cadastros = ["professores", "materias", "salas", "turmas", "horarios", "aulas"];
    let mut m = Vec::new();

    // Super Admin: tudo.
    for r in RECURSOS {
        for a in todas {
            m.push(("super_admin", *r, a));
        }
    }
    // Admin da escola: tudo da sua escola, exceto criar/excluir escolas, backups e (ver) auditoria global.
    for r in RECURSOS.iter().filter(|r| **r != "backup") {
        for a in todas {
            if *r == "escolas" && (a == "criar" || a == "excluir") {
                continue;
            }
            m.push(("admin_escola", *r, a));
        }
    }
    // Coordenador: cadastra e edita; só pode excluir (desalocar) aulas da grade.
    m.push(("coordenador", "escolas", "ver"));
    for r in cadastros {
        for a in ["ver", "criar", "editar"] {
            m.push(("coordenador", r, a));
        }
    }
    m.push(("coordenador", "aulas", "excluir"));
    m.push(("coordenador", "relatorios", "ver"));
    // Professor: vê a própria grade (o filtro por professor é aplicado no comando).
    for r in ["escolas", "horarios", "aulas", "materias", "salas", "turmas", "professores", "relatorios"] {
        m.push(("professor", r, "ver"));
    }
    // Visualizador: somente leitura.
    for r in ["escolas", "professores", "materias", "salas", "turmas", "horarios", "aulas", "relatorios"] {
        m.push(("visualizador", r, "ver"));
    }
    m
}

/// Regrava a tabela `permissoes` a cada abertura (é dado estático do sistema).
pub fn semear_permissoes(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM permissoes", [])?;
    {
        let mut st = tx.prepare("INSERT INTO permissoes (papel, recurso, acao) VALUES (?1, ?2, ?3)")?;
        for (p, r, a) in matriz() {
            st.execute([p, r, a])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Lê uma configuração (tabela `configuracoes`).
pub fn config_get(conn: &Connection, chave: &str) -> Option<String> {
    conn.query_row("SELECT valor FROM configuracoes WHERE chave = ?1", [chave], |r| r.get(0))
        .ok()
}

/// Grava/atualiza uma configuração.
pub fn config_set(conn: &Connection, chave: &str, valor: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO configuracoes (chave, valor) VALUES (?1, ?2)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        [chave, valor],
    )?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn migracao_2_infere_o_turno_dos_horarios_existentes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // Simula um banco criado pela versão 1 do app (sem coluna de turno).
        conn.execute_batch(MIGRACOES[0]).unwrap();
        conn.pragma_update(None, "user_version", 1i64).unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1, 'E');
             INSERT INTO horarios_base (escola_id, ordem, rotulo, inicio_min, fim_min, tipo) VALUES
               (1,1,'a',420,470,'aula'), (1,2,'b',800,850,'aula'), (1,3,'c',1140,1190,'aula');",
        )
        .unwrap();
        migrar(&conn).unwrap();
        let turnos: Vec<String> = conn
            .prepare("SELECT turno FROM horarios_base ORDER BY inicio_min").unwrap()
            .query_map([], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(turnos, vec!["manha", "tarde", "noite"]);
    }

    #[test]
    fn migracao_3_converte_turma_id_em_vinculos() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(MIGRACOES[0]).unwrap();
        conn.execute_batch(MIGRACOES[1]).unwrap();
        conn.pragma_update(None, "user_version", 2i64).unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1,'E');
             INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo) VALUES (1,1,1,'a',420,470,'aula');
             INSERT INTO turmas (id, escola_id, nome) VALUES (1,1,'T1'),(2,1,'T2');
             INSERT INTO aulas (escola_id, dia_semana, horario_id, turma_id) VALUES (1,1,1,1),(1,2,1,2);",
        )
        .unwrap();
        migrar(&conn).unwrap();
        let v: Vec<(i64, i64, Option<i64>)> = conn
            .prepare("SELECT aula_id, turma_id, grupo_id FROM aula_turmas ORDER BY aula_id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(v, vec![(1, 1, None), (2, 2, None)]);
    }

    #[test]
    fn migracao_8_cria_grade_padrao_sem_perder_aulas() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for m in &MIGRACOES[..7] {
            conn.execute_batch(m).unwrap();
        }
        conn.pragma_update(None, "user_version", 7i64).unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1,'E');
             INSERT INTO horarios_base (id, escola_id, ordem, rotulo, inicio_min, fim_min, tipo) VALUES (1,1,1,'a',420,470,'aula');
             INSERT INTO turmas (id, escola_id, nome) VALUES (1,1,'T1');
             INSERT INTO aulas (id, escola_id, dia_semana, horario_id) VALUES (5,1,1,1);
             INSERT INTO aula_turmas (aula_id, turma_id) VALUES (5,1);",
        )
        .unwrap();
        migrar(&conn).unwrap();
        let (aulas, vinculos): (i64, i64) = conn
            .query_row("SELECT (SELECT COUNT(*) FROM aulas), (SELECT COUNT(*) FROM aula_turmas)", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((aulas, vinculos), (1, 1));
        let (g, hg, tg): (i64, i64, i64) = conn
            .query_row(
                "SELECT (SELECT id FROM grades), (SELECT grade_id FROM horarios_base), (SELECT grade_id FROM turmas)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((hg, tg), (g, g));
        // Escolas novas ganham a grade padrão automaticamente.
        conn.execute("INSERT INTO escolas (id, nome) VALUES (2,'F')", []).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM grades WHERE escola_id=2", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }
}

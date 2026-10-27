//! Dados iniciais: usuário admin e escola de demonstração (apenas na primeira execução).

use crate::auth::hash_senha;
use crate::db::horarios::{gerar_faixas, IntervaloCfg};
use crate::error::Result;
use rusqlite::{params, Connection};

/// Se o banco estiver sem usuários, cria o Super Admin e uma escola demo.
pub fn semear_se_vazio(conn: &Connection) -> Result<()> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM usuarios", [], |r| r.get(0))?;
    if n > 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?1, ?2, ?3, 'super_admin')",
        params!["Administrador", "admin@admin.com", hash_senha("admin123")?],
    )?;
    let escolas: i64 = conn.query_row("SELECT COUNT(*) FROM escolas", [], |r| r.get(0))?;
    if escolas == 0 {
        semear_demo(conn)?;
    }
    Ok(())
}

fn semear_demo(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT INTO escolas (nome, endereco, cnpj) VALUES ('Escola Demo', 'Rua das Flores, 100', '00.000.000/0001-00')",
        [],
    )?;
    let esc = conn.last_insert_rowid();

    // Horários: 07:00, aulas de 50 min, 15 min de intervalo após a 3ª aula.
    let faixas = gerar_faixas(
        7 * 60,
        50,
        6,
        &[IntervaloCfg { apos_aula: 3, duracao_min: 15, rotulo: Some("Intervalo".into()) }],
        None,
    )?;
    for (i, f) in faixas.iter().enumerate() {
        conn.execute(
            "INSERT INTO horarios_base (escola_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
             VALUES (?1,?2,?3,?4,?5,?6,'manha')",
            params![esc, i as i64 + 1, f.rotulo, f.inicio_min, f.fim_min, f.tipo],
        )?;
    }

    let materias = [
        ("Matemática", "#3b82f6"),
        ("Português", "#ef4444"),
        ("História", "#f59e0b"),
        ("Ciências", "#10b981"),
        ("Educação Física", "#8b5cf6"),
        ("Inglês", "#ec4899"),
    ];
    let mut mat_ids = Vec::new();
    for (nome, cor) in materias {
        conn.execute(
            "INSERT INTO materias (escola_id, nome, cor) VALUES (?1,?2,?3)",
            params![esc, nome, cor],
        )?;
        mat_ids.push(conn.last_insert_rowid());
    }

    let salas = [
        ("Sala 101", "sala_aula", 35),
        ("Sala 102", "sala_aula", 35),
        ("Laboratório de Ciências", "laboratorio", 25),
        ("Quadra Poliesportiva", "quadra", 60),
    ];
    for (nome, tipo, cap) in salas {
        conn.execute(
            "INSERT INTO salas (escola_id, nome, tipo, capacidade) VALUES (?1,?2,?3,?4)",
            params![esc, nome, tipo, cap],
        )?;
    }

    for (nome, serie, alunos) in [("6º A", "6º ano", 30), ("7º A", "7º ano", 28)] {
        conn.execute(
            "INSERT INTO turmas (escola_id, nome, serie, turno, num_alunos) VALUES (?1,?2,?3,'manha',?4)",
            params![esc, nome, serie, alunos],
        )?;
    }

    let profs = [
        ("Ana Souza", "ana@demo.com", 0usize),
        ("Bruno Lima", "bruno@demo.com", 1),
        ("Carla Mendes", "carla@demo.com", 2),
    ];
    for (i, (nome, email, m)) in profs.into_iter().enumerate() {
        conn.execute(
            "INSERT INTO professores (escola_id, nome, email, cor) VALUES (?1,?2,?3,?4)",
            params![esc, nome, email, crate::db::PALETA_PROFESSORES[i]],
        )?;
        let pid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO professor_materias (professor_id, materia_id) VALUES (?1,?2)",
            params![pid, mat_ids[m]],
        )?;
    }
    Ok(())
}

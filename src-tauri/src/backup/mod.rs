//! Backup e restauração criptografados (AES-256-GCM).
//!
//! Formato do arquivo `.bak`:
//!   "HBAK1" (5 bytes) | salt (16) | nonce (12) | texto cifrado (AES-256-GCM)
//! O texto claro é um JSON de metadados seguido do banco SQLite:
//!   [u32 BE: tamanho do JSON] [JSON] [bytes do SQLite]
//! A chave de 256 bits é derivada da senha com Argon2id + salt aleatório.

use crate::db::{config_get, config_set, Db};
use crate::error::{AppError, Result};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use rand::RngCore;
use rusqlite::{backup::Backup, params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAGIA: &[u8; 5] = b"HBAK1";

#[derive(Debug, Serialize, Deserialize)]
struct Metadados {
    versao_app: String,
    versao_schema: i64,
    criado_em: String,
    criado_por: String,
}

/// Deriva a chave AES-256 a partir da senha.
fn derivar_chave(senha: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let mut chave = [0u8; 32];
    Argon2::default()
        .hash_password_into(senha.as_bytes(), salt, &mut chave)
        .map_err(|e| AppError::msg(format!("Falha ao derivar a chave: {e}")))?;
    Ok(chave)
}

/// Cifra o conteúdo claro com a senha informada.
pub fn cifrar(claro: &[u8], senha: &str) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let chave = derivar_chave(senha, &salt)?;
    let cifra = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&chave));
    let texto = cifra
        .encrypt(Nonce::from_slice(&nonce), claro)
        .map_err(|_| AppError::msg("Falha ao criptografar o backup."))?;
    let mut out = Vec::with_capacity(5 + 16 + 12 + texto.len());
    out.extend_from_slice(MAGIA);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&texto);
    Ok(out)
}

/// Decifra; falha se a senha estiver errada ou o arquivo foi alterado.
pub fn decifrar(dados: &[u8], senha: &str) -> Result<Vec<u8>> {
    if dados.len() < 5 + 16 + 12 + 16 || &dados[..5] != MAGIA {
        return Err(AppError::msg("Arquivo de backup inválido."));
    }
    let salt = &dados[5..21];
    let nonce = &dados[21..33];
    let chave = derivar_chave(senha, salt)?;
    let cifra = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&chave));
    cifra
        .decrypt(Nonce::from_slice(nonce), &dados[33..])
        .map_err(|_| AppError::msg("Senha incorreta ou arquivo de backup corrompido."))
}

/// Gera uma cópia consistente do banco em um arquivo temporário e devolve seus bytes.
fn bytes_do_banco(conn: &Connection, tmp_dir: &Path) -> Result<Vec<u8>> {
    fs::create_dir_all(tmp_dir)?;
    let tmp = tmp_dir.join(format!("snapshot-{}.db", rand::random::<u64>()));
    let _ = fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()])?;
    let bytes = fs::read(&tmp)?;
    let _ = fs::remove_file(&tmp);
    Ok(bytes)
}

fn montar_claro(conn: &Connection, tmp_dir: &Path, usuario: &str) -> Result<Vec<u8>> {
    let versao_schema: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let meta = Metadados {
        versao_app: env!("CARGO_PKG_VERSION").to_string(),
        versao_schema,
        criado_em: chrono::Local::now().to_rfc3339(),
        criado_por: usuario.to_string(),
    };
    let json = serde_json::to_vec(&meta)?;
    let banco = bytes_do_banco(conn, tmp_dir)?;
    let mut claro = Vec::with_capacity(4 + json.len() + banco.len());
    claro.extend_from_slice(&(json.len() as u32).to_be_bytes());
    claro.extend_from_slice(&json);
    claro.extend_from_slice(&banco);
    Ok(claro)
}

fn registrar_log(conn: &Connection, tipo: &str, arquivo: &str, tamanho: u64, usuario: &str, sucesso: bool, detalhe: &str) {
    let _ = conn.execute(
        "INSERT INTO backup_log (tipo, arquivo, tamanho, usuario, sucesso, detalhe)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![tipo, arquivo, tamanho as i64, usuario, sucesso as i64, detalhe],
    );
}

/// Exporta o banco criptografado para `destino`. Retorna o tamanho gravado.
pub fn exportar(
    conn: &Connection,
    tmp_dir: &Path,
    destino: &Path,
    senha: &str,
    usuario: &str,
    tipo: &str,
) -> Result<u64> {
    if senha.chars().count() < 6 {
        return Err(AppError::msg("A senha do backup deve ter pelo menos 6 caracteres."));
    }
    let resultado = (|| -> Result<u64> {
        let claro = montar_claro(conn, tmp_dir, usuario)?;
        let cifrado = cifrar(&claro, senha)?;
        if let Some(pai) = destino.parent() {
            fs::create_dir_all(pai)?;
        }
        fs::write(destino, &cifrado)?;
        Ok(cifrado.len() as u64)
    })();
    match &resultado {
        Ok(t) => registrar_log(conn, tipo, &destino.to_string_lossy(), *t, usuario, true, ""),
        Err(e) => registrar_log(conn, tipo, &destino.to_string_lossy(), 0, usuario, false, &e.to_string()),
    }
    resultado
}

/// Restaura o banco a partir de um arquivo `.bak`.
/// Se `snapshot_dir` for informado, grava antes um backup de segurança do estado atual.
pub fn importar(
    conn: &mut Connection,
    tmp_dir: &Path,
    origem: &Path,
    senha: &str,
    usuario: &str,
    snapshot_dir: Option<&Path>,
) -> Result<Option<PathBuf>> {
    let dados = fs::read(origem)?;
    let claro = decifrar(&dados, senha)?;
    if claro.len() < 4 {
        return Err(AppError::msg("Backup vazio ou corrompido."));
    }
    let tam_json = u32::from_be_bytes(claro[..4].try_into().unwrap()) as usize;
    if claro.len() < 4 + tam_json {
        return Err(AppError::msg("Backup corrompido (metadados incompletos)."));
    }
    let meta: Metadados = serde_json::from_slice(&claro[4..4 + tam_json])?;
    let versao_atual: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if meta.versao_schema > versao_atual {
        return Err(AppError::msg(
            "Este backup foi gerado por uma versão mais nova do aplicativo. Atualize o app antes de restaurar.",
        ));
    }
    let banco = &claro[4 + tam_json..];

    // Grava o banco do backup em arquivo temporário e valida antes de tocar no banco atual.
    fs::create_dir_all(tmp_dir)?;
    let tmp = tmp_dir.join(format!("restauro-{}.db", rand::random::<u64>()));
    fs::write(&tmp, banco)?;
    let validar = || -> Result<()> {
        let origem_db = Connection::open(&tmp)?;
        let ok: String = origem_db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        let tem_escolas: i64 = origem_db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('escolas','usuarios','aulas')",
            [],
            |r| r.get(0),
        )?;
        if ok != "ok" || tem_escolas != 3 {
            return Err(AppError::msg("O arquivo não contém um banco de horários válido."));
        }
        Ok(())
    };
    if let Err(e) = validar() {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    // Snapshot de segurança do estado atual (opcional).
    let mut snapshot = None;
    if let Some(dir) = snapshot_dir {
        let nome = format!("pre-restauracao-{}.bak", chrono::Local::now().format("%Y%m%d-%H%M%S"));
        let caminho = dir.join(nome);
        exportar(conn, tmp_dir, &caminho, senha, usuario, "pre_restauracao")?;
        snapshot = Some(caminho);
    }

    // Os logs (backup e auditoria) pertencem a ESTA instalação: guardamos antes
    // de restaurar para reinseri-los depois, preservando o histórico.
    let logs_backup = ler_logs_backup(conn)?;
    let logs_audit = ler_logs_audit(conn)?;

    // Copia o banco do backup para dentro da conexão ativa (API de backup do SQLite).
    let resultado = (|| -> Result<()> {
        let origem_db = Connection::open(&tmp)?;
        let backup = Backup::new(&origem_db, conn)?;
        backup.run_to_completion(256, Duration::from_millis(5), None)?;
        Ok(())
    })();
    let _ = fs::remove_file(&tmp);
    resultado?;

    // Aplica migrations que o backup antigo ainda não tinha e reaplica as permissões.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    crate::db::migrar(conn)?;
    crate::db::semear_permissoes(conn)?;
    restaurar_logs(conn, &logs_backup, &logs_audit)?;
    registrar_log(conn, "restauracao", &origem.to_string_lossy(), dados.len() as u64, usuario, true, &format!("Backup de {}", meta.criado_em));
    Ok(snapshot)
}

type LinhaBackup = (String, String, String, i64, String, i64, Option<String>);
type LinhaAudit = (String, Option<i64>, String, String, String, Option<i64>, Option<String>);

fn ler_logs_backup(conn: &Connection) -> Result<Vec<LinhaBackup>> {
    let mut st = conn.prepare(
        "SELECT data, tipo, arquivo, tamanho, usuario, sucesso, detalhe FROM backup_log ORDER BY id",
    )?;
    let v = st
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

fn ler_logs_audit(conn: &Connection) -> Result<Vec<LinhaAudit>> {
    let mut st = conn.prepare(
        "SELECT data, usuario_id, usuario, acao, entidade, entidade_id, detalhe FROM audit_log ORDER BY id",
    )?;
    let v = st
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

fn restaurar_logs(conn: &Connection, b: &[LinhaBackup], a: &[LinhaAudit]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM backup_log", [])?;
    tx.execute("DELETE FROM audit_log", [])?;
    for l in b {
        tx.execute(
            "INSERT INTO backup_log (data, tipo, arquivo, tamanho, usuario, sucesso, detalhe)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![l.0, l.1, l.2, l.3, l.4, l.5, l.6],
        )?;
    }
    for l in a {
        // usuario_id é gravado nulo: o usuário pode não existir mais no banco restaurado.
        tx.execute(
            "INSERT INTO audit_log (data, usuario_id, usuario, acao, entidade, entidade_id, detalhe)
             VALUES (?1,NULL,?2,?3,?4,?5,?6)",
            params![l.0, l.2, l.3, l.4, l.5, l.6],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Pasta padrão dos backups automáticos.
pub fn pasta_padrao(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

/// Executa o backup automático se estiver ativado e vencido. Retorna true se rodou.
pub fn executar_agendado(db: &Db, data_dir: &Path) -> bool {
    let conn = db.conn();
    let modo = config_get(&conn, "backup_auto").unwrap_or_else(|| "off".into());
    let dias = match modo.as_str() {
        "diario" => 1,
        "semanal" => 7,
        _ => return false,
    };
    let senha = match config_get(&conn, "backup_senha") {
        Some(s) if s.chars().count() >= 6 => s,
        _ => return false,
    };
    let ultimo = config_get(&conn, "backup_ultimo").and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok());
    let vencido = match ultimo {
        None => true,
        Some(t) => chrono::Local::now().signed_duration_since(t) >= chrono::Duration::days(dias),
    };
    if !vencido {
        return false;
    }
    let pasta = config_get(&conn, "backup_pasta")
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| pasta_padrao(data_dir));
    let arquivo = pasta.join(format!("auto-{}.bak", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    let tmp_dir = data_dir.join("tmp");
    let ok = exportar(&conn, &tmp_dir, &arquivo, &senha, "sistema", "automatico").is_ok();
    if ok {
        let _ = config_set(&conn, "backup_ultimo", &chrono::Local::now().to_rfc3339());
        manter_ultimos(&pasta, 15);
    }
    ok
}

/// Mantém só os N backups automáticos mais recentes na pasta.
fn manter_ultimos(pasta: &Path, n: usize) {
    if let Ok(rd) = fs::read_dir(pasta) {
        let mut arqs: Vec<PathBuf> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|f| f.to_str())
                    .map(|f| f.starts_with("auto-") && f.ends_with(".bak"))
                    .unwrap_or(false)
            })
            .collect();
        arqs.sort();
        if arqs.len() > n {
            for p in &arqs[..arqs.len() - n] {
                let _ = fs::remove_file(p);
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::db;

    fn dir_tmp(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("horarios-test-{nome}-{}", rand::random::<u32>()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn cifra_e_decifra_ida_e_volta() {
        let c = cifrar(b"dados secretos", "senha123").unwrap();
        assert!(!c.windows(6).any(|w| w == b"secret"));
        assert_eq!(decifrar(&c, "senha123").unwrap(), b"dados secretos");
        assert!(decifrar(&c, "outra-senha").is_err());
        let mut adulterado = c.clone();
        let ultimo = adulterado.len() - 1;
        adulterado[ultimo] ^= 1;
        assert!(decifrar(&adulterado, "senha123").is_err());
    }

    #[test]
    fn exporta_e_restaura_o_banco() {
        let dir = dir_tmp("bkp");
        let mut conn = db::abrir_memoria().unwrap();
        conn.execute("INSERT INTO escolas (nome) VALUES ('Escola A')", []).unwrap();
        let arq = dir.join("teste.bak");
        exportar(&conn, &dir, &arq, "senha123", "tester", "manual").unwrap();

        // Altera o banco depois do backup...
        conn.execute("INSERT INTO escolas (nome) VALUES ('Escola B')", []).unwrap();
        conn.execute("DELETE FROM escolas WHERE nome='Escola A'", []).unwrap();

        // ...e restaura, com snapshot de segurança.
        assert!(importar(&mut conn, &dir, &arq, "errada", "tester", None).is_err());
        let snap = importar(&mut conn, &dir, &arq, "senha123", "tester", Some(&dir)).unwrap();
        assert!(snap.unwrap().exists());
        let nomes: Vec<String> = conn
            .prepare("SELECT nome FROM escolas ORDER BY nome").unwrap()
            .query_map([], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(nomes, vec!["Escola A"]);
        // O histórico de logs da instalação é preservado: manual + (falha: não grava) + pré-restauração + restauração
        let tipos: Vec<String> = conn
            .prepare("SELECT tipo FROM backup_log ORDER BY id").unwrap()
            .query_map([], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(tipos, vec!["manual", "pre_restauracao", "restauracao"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejeita_arquivo_que_nao_e_backup() {
        let dir = dir_tmp("invalido");
        let mut conn = db::abrir_memoria().unwrap();
        let arq = dir.join("lixo.bak");
        fs::write(&arq, b"isto nao e um backup").unwrap();
        assert!(importar(&mut conn, &dir, &arq, "senha123", "t", None).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}

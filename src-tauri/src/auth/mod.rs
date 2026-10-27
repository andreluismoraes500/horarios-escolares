//! Autenticação (argon2 + token de sessão) e verificação de permissões (RBAC).

use crate::db::models::Usuario;
use crate::error::{AppError, Result};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

/// Duração da sessão persistente (dias).
const DIAS_SESSAO: i64 = 30;

/// Gera o hash argon2id (com salt aleatório) de uma senha.
pub fn hash_senha(senha: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(senha.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::msg(format!("Falha ao gerar hash da senha: {e}")))
}

/// Confere a senha digitada contra o hash armazenado.
pub fn verificar_senha(senha: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(h) => Argon2::default().verify_password(senha.as_bytes(), &h).is_ok(),
        Err(_) => false,
    }
}

/// Exige senha com um mínimo de qualidade.
pub fn validar_senha(senha: &str) -> Result<()> {
    if senha.chars().count() < 6 {
        return Err(AppError::msg("A senha deve ter pelo menos 6 caracteres."));
    }
    Ok(())
}

fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Contexto do usuário autenticado que executa o comando.
pub struct Ctx {
    pub usuario: Usuario,
}

impl Ctx {
    pub fn eh_super(&self) -> bool {
        self.usuario.papel == "super_admin"
    }

    /// Usuários que não são super admin só enxergam a própria escola.
    pub fn escola_permitida(&self, escola_id: i64) -> bool {
        match self.usuario.escola_id {
            None => self.eh_super(),
            Some(e) => e == escola_id,
        }
    }

    /// Verifica a permissão (recurso + ação) na tabela `permissoes` e,
    /// quando informado, se a escola é acessível por este usuário.
    pub fn exigir(
        &self,
        conn: &Connection,
        recurso: &str,
        acao: &str,
        escola_id: Option<i64>,
    ) -> Result<()> {
        let ok: i64 = conn.query_row(
            "SELECT COUNT(*) FROM permissoes WHERE papel = ?1 AND recurso = ?2 AND acao = ?3",
            params![self.usuario.papel, recurso, acao],
            |r| r.get(0),
        )?;
        if ok == 0 {
            return Err(AppError::SemPermissao);
        }
        if let Some(e) = escola_id {
            if !self.escola_permitida(e) {
                return Err(AppError::SemPermissao);
            }
        }
        Ok(())
    }

    /// Registra uma ação sensível no log de auditoria.
    pub fn auditar(
        &self,
        conn: &Connection,
        acao: &str,
        entidade: &str,
        entidade_id: Option<i64>,
        detalhe: &str,
    ) {
        let _ = conn.execute(
            "INSERT INTO audit_log (usuario_id, usuario, acao, entidade, entidade_id, detalhe)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![self.usuario.id, self.usuario.email, acao, entidade, entidade_id, detalhe],
        );
    }
}

/// Resolve o token de sessão em um usuário ativo.
pub fn autenticar(conn: &Connection, token: &str) -> Result<Ctx> {
    let usuario = conn
        .query_row(
            "SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
             WHERE s.token_hash = ?1 AND s.expira_em > datetime('now') AND u.ativo = 1",
            params![hash_token(token)],
            Usuario::from_row,
        )
        .optional()?;
    usuario.map(|usuario| Ctx { usuario }).ok_or(AppError::NaoAutenticado)
}

/// Valida e-mail/senha e cria uma sessão. Retorna o token em texto
/// (só o hash SHA-256 dele fica no banco).
pub fn login(conn: &Connection, email: &str, senha: &str) -> Result<(String, Usuario)> {
    let linha = conn
        .query_row(
            "SELECT * FROM usuarios WHERE email = ?1 AND ativo = 1",
            params![email.trim()],
            |r| Ok((Usuario::from_row(r)?, r.get::<_, String>("senha_hash")?)),
        )
        .optional()?;
    // Mensagem genérica: não revela se o e-mail existe.
    let (usuario, hash) = linha.ok_or_else(|| AppError::msg("E-mail ou senha incorretos."))?;
    if !verificar_senha(senha, &hash) {
        return Err(AppError::msg("E-mail ou senha incorretos."));
    }
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    conn.execute(
        "DELETE FROM sessoes WHERE expira_em <= datetime('now')",
        [],
    )?;
    conn.execute(
        "INSERT INTO sessoes (token_hash, usuario_id, expira_em)
         VALUES (?1, ?2, datetime('now', ?3))",
        params![hash_token(&token), usuario.id, format!("+{DIAS_SESSAO} days")],
    )?;
    Ok((token, usuario))
}

pub fn logout(conn: &Connection, token: &str) -> Result<()> {
    conn.execute("DELETE FROM sessoes WHERE token_hash = ?1", params![hash_token(token)])?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::db;

    #[test]
    fn hash_nao_guarda_senha_em_texto_e_verifica() {
        let h = hash_senha("segredo123").unwrap();
        assert!(!h.contains("segredo123"));
        assert!(h.starts_with("$argon2"));
        assert!(verificar_senha("segredo123", &h));
        assert!(!verificar_senha("errada", &h));
    }

    #[test]
    fn login_e_sessao_funcionam() {
        let conn = db::abrir_memoria().unwrap();
        conn.execute(
            "INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('A','a@a.com',?1,'super_admin')",
            params![hash_senha("abc123").unwrap()],
        )
        .unwrap();
        assert!(login(&conn, "a@a.com", "errada").is_err());
        let (token, u) = login(&conn, "A@A.com", "abc123").unwrap(); // e-mail não diferencia maiúsculas
        assert_eq!(u.papel, "super_admin");
        let ctx = autenticar(&conn, &token).unwrap();
        assert!(ctx.eh_super());
        logout(&conn, &token).unwrap();
        assert!(autenticar(&conn, &token).is_err());
    }

    #[test]
    fn permissoes_respeitam_papel_e_escola() {
        let conn = db::abrir_memoria().unwrap();
        conn.execute_batch(
            "INSERT INTO escolas (id, nome) VALUES (1,'E1'),(2,'E2');",
        )
        .unwrap();
        let coord = Ctx {
            usuario: Usuario {
                id: 9, nome: "C".into(), email: "c@c.com".into(), papel: "coordenador".into(),
                escola_id: Some(1), professor_id: None, ativo: true,
            },
        };
        assert!(coord.exigir(&conn, "aulas", "criar", Some(1)).is_ok());
        assert!(coord.exigir(&conn, "aulas", "excluir", Some(1)).is_ok()); // pode desalocar aula
        assert!(coord.exigir(&conn, "professores", "excluir", Some(1)).is_err()); // sem excluir cadastros
        assert!(coord.exigir(&conn, "aulas", "criar", Some(2)).is_err()); // outra escola
        assert!(coord.exigir(&conn, "backup", "ver", None).is_err());
        let vis = Ctx { usuario: Usuario { papel: "visualizador".into(), ..coord.usuario.clone() } };
        assert!(vis.exigir(&conn, "aulas", "ver", Some(1)).is_ok());
        assert!(vis.exigir(&conn, "aulas", "criar", Some(1)).is_err());
    }
}

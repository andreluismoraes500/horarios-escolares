//! Modelos de dados trocados com o frontend (serde) e leitura de linhas do SQLite.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Escola {
    pub id: i64,
    pub nome: String,
    pub endereco: Option<String>,
    pub cnpj: Option<String>,
    pub logo: Option<String>,
}

impl Escola {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get("id")?,
            nome: r.get("nome")?,
            endereco: r.get("endereco")?,
            cnpj: r.get("cnpj")?,
            logo: r.get("logo")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscolaInput {
    pub nome: String,
    pub endereco: Option<String>,
    pub cnpj: Option<String>,
    pub logo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usuario {
    pub id: i64,
    pub nome: String,
    pub email: String,
    pub papel: String,
    pub escola_id: Option<i64>,
    pub professor_id: Option<i64>,
    pub ativo: bool,
}

impl Usuario {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get("id")?,
            nome: r.get("nome")?,
            email: r.get("email")?,
            papel: r.get("papel")?,
            escola_id: r.get("escola_id")?,
            professor_id: r.get("professor_id")?,
            ativo: r.get::<_, i64>("ativo")? != 0,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsuarioInput {
    pub nome: String,
    pub email: String,
    /// Obrigatória ao criar; ao editar, só é alterada se informada.
    pub senha: Option<String>,
    pub papel: String,
    pub escola_id: Option<i64>,
    pub professor_id: Option<i64>,
    pub ativo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Professor {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
    pub email: Option<String>,
    pub telefone: Option<String>,
    /// JSON com os períodos INDISPONÍVEIS: [{"dia":1,"horario_id":3}]
    pub disponibilidade: String,
    pub cor: String,
    pub max_aulas_semana: Option<i64>,
    pub max_aulas_dia: Option<i64>,
    pub deslocamento_min: i64,
    pub intersticio_horas: i64,
    pub da_aula_sabado: bool,
    pub materia_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProfessorInput {
    pub escola_id: i64,
    pub nome: String,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub disponibilidade: String,
    /// #RRGGBB; vazio = cor automática.
    #[serde(default)]
    pub cor: Option<String>,
    #[serde(default)]
    pub max_aulas_semana: Option<i64>,
    #[serde(default)]
    pub max_aulas_dia: Option<i64>,
    #[serde(default)]
    pub deslocamento_min: i64,
    #[serde(default)]
    pub intersticio_horas: i64,
    #[serde(default = "padrao_true")]
    pub da_aula_sabado: bool,
    pub materia_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Materia {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
    pub cor: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MateriaInput {
    pub escola_id: i64,
    pub nome: String,
    pub cor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sala {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
    pub tipo: String,
    pub capacidade: i64,
    pub observacoes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SalaInput {
    pub escola_id: i64,
    pub nome: String,
    pub tipo: String,
    pub capacidade: i64,
    pub observacoes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turma {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
    pub serie: Option<String>,
    pub turno: String,
    pub num_alunos: i64,
    /// Horário de término da turma (minutos desde 00:00); None = termina com o turno.
    pub fim_max_min: Option<i64>,
    /// Grade de horários usada pela turma.
    pub grade_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TurmaInput {
    pub escola_id: i64,
    pub nome: String,
    pub serie: Option<String>,
    pub turno: String,
    pub num_alunos: i64,
    #[serde(default)]
    pub fim_max_min: Option<i64>,
    /// None = primeira grade da escola.
    #[serde(default)]
    pub grade_id: Option<i64>,
}

/// Faixa de horário: aula ou intervalo. Tempos em minutos desde 00:00.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Horario {
    pub id: i64,
    pub escola_id: i64,
    pub grade_id: i64,
    pub ordem: i64,
    pub rotulo: String,
    pub inicio_min: i64,
    pub fim_min: i64,
    pub tipo: String,  // "aula" | "intervalo"
    pub turno: String, // "manha" | "tarde" | "noite"
}

#[derive(Debug, Clone, Deserialize)]
pub struct HorarioInput {
    pub escola_id: i64,
    /// None = primeira grade da escola.
    #[serde(default)]
    pub grade_id: Option<i64>,
    pub rotulo: String,
    pub inicio_min: i64,
    pub fim_min: i64,
    pub tipo: String,
    pub turno: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Aula {
    pub id: i64,
    pub escola_id: i64,
    pub dia_semana: i64,
    pub horario_id: i64,
    pub sala_id: Option<i64>,
    pub professor_id: Option<i64>,
    pub materia_id: Option<i64>,
    pub turmas: Vec<TurmaRef>,
    pub observacao: Option<String>,
}

/// Turma participante de uma aula; `grupo_id` None = turma inteira.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurmaRef {
    pub turma_id: i64,
    pub grupo_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grupo {
    pub id: i64,
    pub escola_id: i64,
    pub turma_id: i64,
    pub nome: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GrupoInput {
    pub escola_id: i64,
    pub turma_id: i64,
    pub nome: String,
}

impl Aula {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get("id")?,
            escola_id: r.get("escola_id")?,
            dia_semana: r.get("dia_semana")?,
            horario_id: r.get("horario_id")?,
            sala_id: r.get("sala_id")?,
            professor_id: r.get("professor_id")?,
            materia_id: r.get("materia_id")?,
            turmas: Vec::new(),
            observacao: r.get("observacao")?,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AulaInput {
    pub escola_id: i64,
    pub dia_semana: i64,
    pub horario_id: i64,
    pub sala_id: Option<i64>,
    pub professor_id: Option<i64>,
    pub materia_id: Option<i64>,
    pub turmas: Vec<TurmaRef>,
    pub observacao: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Conflito {
    /// "sala" | "professor" | "turma"
    pub tipo: String,
    pub aula_id: i64,
    pub mensagem: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Verificacao {
    pub conflitos: Vec<Conflito>,
    /// Avisos não bloqueantes (ex.: professor marcado como indisponível)
    pub avisos: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Demanda {
    pub id: i64,
    pub escola_id: i64,
    pub turma_id: i64,
    pub materia_id: i64,
    pub aulas_semana: i64,
    pub professor_id: Option<i64>,
    pub sala_id: Option<i64>,
    pub max_por_dia: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DemandaInput {
    pub escola_id: i64,
    pub turma_id: i64,
    pub materia_id: i64,
    pub aulas_semana: i64,
    pub professor_id: Option<i64>,
    pub sala_id: Option<i64>,
    pub max_por_dia: i64,
}

fn padrao_true() -> bool {
    true
}

/// Conjunto de faixas de horário (ex.: "Integrado", "Enfermagem").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grade {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
}

/// Feriado, recesso ou data especial da escola (intervalo de datas AAAA-MM-DD).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feriado {
    pub id: i64,
    pub escola_id: i64,
    pub data_ini: String,
    pub data_fim: String,
    pub nome: String,
    pub tipo: String,
    pub bloqueia_assinatura: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FeriadoInput {
    pub escola_id: i64,
    pub data_ini: String,
    pub data_fim: String,
    pub nome: String,
    pub tipo: String,
    pub bloqueia_assinatura: bool,
}

/// Coordenador: responsável por turmas, com expediente (horários de trabalho) variável.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coordenador {
    pub id: i64,
    pub escola_id: i64,
    pub nome: String,
    pub email: Option<String>,
    pub telefone: Option<String>,
    /// JSON [{"dia":1,"ini":420,"fim":720}]
    pub expediente: String,
    pub turma_ids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoordenadorInput {
    pub escola_id: i64,
    pub nome: String,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub expediente: String,
    pub turma_ids: Vec<i64>,
}

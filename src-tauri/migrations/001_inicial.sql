-- Schema inicial do sistema de horários escolares.
-- Horários são armazenados em MINUTOS desde 00:00 (ex.: 07:10 = 430),
-- o que permite qualquer início (7:10, 7:30, 9:15...) e qualquer duração.

CREATE TABLE escolas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT NOT NULL,
    endereco      TEXT,
    cnpj          TEXT,
    logo          TEXT,            -- data URL (base64) opcional
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE professores (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome          TEXT NOT NULL,
    email         TEXT,
    telefone      TEXT,
    disponibilidade TEXT NOT NULL DEFAULT '[]', -- JSON: [{"dia":1,"horario_id":3}, ...] indisponíveis
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash    TEXT NOT NULL,
    papel         TEXT NOT NULL CHECK (papel IN
                    ('super_admin','admin_escola','coordenador','professor','visualizador')),
    escola_id     INTEGER REFERENCES escolas(id) ON DELETE CASCADE, -- NULL = todas (super admin)
    professor_id  INTEGER REFERENCES professores(id) ON DELETE SET NULL,
    ativo         INTEGER NOT NULL DEFAULT 1,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessoes (
    token_hash    TEXT PRIMARY KEY,   -- SHA-256 do token entregue ao cliente
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    expira_em     TEXT NOT NULL
);

CREATE TABLE permissoes (
    papel   TEXT NOT NULL,
    recurso TEXT NOT NULL,
    acao    TEXT NOT NULL CHECK (acao IN ('ver','criar','editar','excluir')),
    PRIMARY KEY (papel, recurso, acao)
);

CREATE TABLE materias (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome          TEXT NOT NULL,
    cor           TEXT NOT NULL DEFAULT '#3b82f6',
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (escola_id, nome)
);

-- Disciplinas que cada professor leciona
CREATE TABLE professor_materias (
    professor_id INTEGER NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    materia_id   INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    PRIMARY KEY (professor_id, materia_id)
);

CREATE TABLE salas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome          TEXT NOT NULL,
    tipo          TEXT NOT NULL DEFAULT 'sala_aula' CHECK (tipo IN
                    ('sala_aula','laboratorio','quadra','biblioteca','auditorio','outro')),
    capacidade    INTEGER NOT NULL DEFAULT 0,
    observacoes   TEXT,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (escola_id, nome)
);

CREATE TABLE turmas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome          TEXT NOT NULL,
    serie         TEXT,
    turno         TEXT NOT NULL DEFAULT 'manha' CHECK (turno IN ('manha','tarde','noite')),
    num_alunos    INTEGER NOT NULL DEFAULT 0,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (escola_id, nome)
);

-- Faixas de horário da escola. 'aula' recebe aulas; 'intervalo' (recreio, lanche) não.
CREATE TABLE horarios_base (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    ordem         INTEGER NOT NULL,
    rotulo        TEXT NOT NULL,                       -- "1ª aula", "Intervalo"
    inicio_min    INTEGER NOT NULL CHECK (inicio_min BETWEEN 0 AND 1439),
    fim_min       INTEGER NOT NULL CHECK (fim_min BETWEEN 1 AND 1440),
    tipo          TEXT NOT NULL DEFAULT 'aula' CHECK (tipo IN ('aula','intervalo')),
    CHECK (fim_min > inicio_min),
    UNIQUE (escola_id, inicio_min)
);

CREATE TABLE aulas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    dia_semana    INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 7), -- 1=segunda ... 7=domingo
    horario_id    INTEGER NOT NULL REFERENCES horarios_base(id) ON DELETE CASCADE,
    sala_id       INTEGER REFERENCES salas(id) ON DELETE CASCADE,
    professor_id  INTEGER REFERENCES professores(id) ON DELETE SET NULL, -- NULL = aula livre
    materia_id    INTEGER REFERENCES materias(id) ON DELETE SET NULL,    -- NULL = aula livre
    turma_id      INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    observacao    TEXT,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Restrições de conflito (índices únicos parciais: NULL não conflita)
CREATE UNIQUE INDEX ux_aula_turma     ON aulas (escola_id, dia_semana, horario_id, turma_id);
CREATE UNIQUE INDEX ux_aula_sala      ON aulas (escola_id, dia_semana, horario_id, sala_id)
    WHERE sala_id IS NOT NULL;
CREATE UNIQUE INDEX ux_aula_professor ON aulas (escola_id, dia_semana, horario_id, professor_id)
    WHERE professor_id IS NOT NULL;

CREATE TABLE configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

CREATE TABLE backup_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    data        TEXT NOT NULL DEFAULT (datetime('now')),
    tipo        TEXT NOT NULL,         -- manual | automatico | pre_restauracao | restauracao
    arquivo     TEXT NOT NULL,
    tamanho     INTEGER NOT NULL DEFAULT 0,
    usuario     TEXT NOT NULL,
    sucesso     INTEGER NOT NULL DEFAULT 1,
    detalhe     TEXT
);

CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    data        TEXT NOT NULL DEFAULT (datetime('now')),
    usuario_id  INTEGER,
    usuario     TEXT NOT NULL,
    acao        TEXT NOT NULL,
    entidade    TEXT NOT NULL,
    entidade_id INTEGER,
    detalhe     TEXT
);

CREATE INDEX ix_aulas_prof   ON aulas (professor_id);
CREATE INDEX ix_aulas_sala   ON aulas (sala_id);
CREATE INDEX ix_aulas_turma  ON aulas (turma_id);
CREATE INDEX ix_horarios_esc ON horarios_base (escola_id, inicio_min);

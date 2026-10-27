-- Divisão de turmas em grupos e aulas conjuntas (várias turmas na mesma aula).
-- A aula deixa de ter turma_id; as turmas (e grupos) participantes ficam em aula_turmas.

CREATE TABLE grupos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id  INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    turma_id   INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    nome       TEXT NOT NULL,
    UNIQUE (turma_id, nome)
);

-- Guarda os vínculos atuais antes de recriar a tabela de aulas.
CREATE TEMP TABLE _vinculos AS SELECT id AS aula_id, turma_id FROM aulas;

CREATE TABLE aulas_nova (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    dia_semana    INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    horario_id    INTEGER NOT NULL REFERENCES horarios_base(id) ON DELETE CASCADE,
    sala_id       INTEGER REFERENCES salas(id) ON DELETE CASCADE,
    professor_id  INTEGER REFERENCES professores(id) ON DELETE SET NULL,
    materia_id    INTEGER REFERENCES materias(id) ON DELETE SET NULL,
    observacao    TEXT,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO aulas_nova (id, escola_id, dia_semana, horario_id, sala_id, professor_id, materia_id, observacao, criado_em, atualizado_em)
    SELECT id, escola_id, dia_semana, horario_id, sala_id, professor_id, materia_id, observacao, criado_em, atualizado_em FROM aulas;

DROP TABLE aulas;
ALTER TABLE aulas_nova RENAME TO aulas;

CREATE UNIQUE INDEX ux_aula_sala      ON aulas (escola_id, dia_semana, horario_id, sala_id)
    WHERE sala_id IS NOT NULL;
CREATE UNIQUE INDEX ux_aula_professor ON aulas (escola_id, dia_semana, horario_id, professor_id)
    WHERE professor_id IS NOT NULL;
CREATE INDEX ix_aulas_prof ON aulas (professor_id);
CREATE INDEX ix_aulas_sala ON aulas (sala_id);
CREATE INDEX ix_aulas_slot ON aulas (escola_id, dia_semana, horario_id);

-- grupo_id NULL = turma inteira.
CREATE TABLE aula_turmas (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    aula_id   INTEGER NOT NULL REFERENCES aulas(id) ON DELETE CASCADE,
    turma_id  INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    grupo_id  INTEGER REFERENCES grupos(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_aula_turmas ON aula_turmas (aula_id, turma_id, COALESCE(grupo_id, 0));
CREATE INDEX ix_at_turma ON aula_turmas (turma_id);

INSERT INTO aula_turmas (aula_id, turma_id) SELECT aula_id, turma_id FROM _vinculos;
DROP TABLE _vinculos;

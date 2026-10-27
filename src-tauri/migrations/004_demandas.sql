-- Demanda semanal por turma e matéria: base do gerador automático da grade.
CREATE TABLE demandas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    turma_id      INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    materia_id    INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    aulas_semana  INTEGER NOT NULL CHECK (aulas_semana BETWEEN 1 AND 30),
    professor_id  INTEGER REFERENCES professores(id) ON DELETE SET NULL, -- NULL = o sistema escolhe
    sala_id       INTEGER REFERENCES salas(id) ON DELETE SET NULL,       -- NULL = qualquer sala livre
    max_por_dia   INTEGER NOT NULL DEFAULT 2 CHECK (max_por_dia BETWEEN 1 AND 6),
    UNIQUE (turma_id, materia_id)
);
CREATE INDEX ix_demandas_escola ON demandas (escola_id);

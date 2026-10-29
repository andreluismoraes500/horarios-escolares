-- Coordenadores: cuidam de turmas (e das matérias delas) e têm expediente próprio, com horários variados
-- por dia da semana: JSON [{"dia":1,"ini":420,"fim":720}, ...] (minutos desde 00:00; dia 1=segunda ... 6=sábado).
CREATE TABLE coordenadores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id  INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome       TEXT NOT NULL,
    email      TEXT,
    telefone   TEXT,
    expediente TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE coordenador_turmas (
    coordenador_id INTEGER NOT NULL REFERENCES coordenadores(id) ON DELETE CASCADE,
    turma_id       INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    PRIMARY KEY (coordenador_id, turma_id)
);

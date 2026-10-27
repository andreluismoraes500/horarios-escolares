-- Grades de horário: conjuntos independentes de faixas (ex.: "Integrado" 07:00–14:30 e "Enfermagem" 13:00–17:30),
-- que podem se sobrepor no relógio. Cada turma usa uma grade. Conflitos de professor/sala passam a ser
-- verificados pelo horário real (sobreposição), não mais pelo id da faixa.

CREATE TABLE grades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id  INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome       TEXT NOT NULL,
    UNIQUE (escola_id, nome)
);
INSERT INTO grades (escola_id, nome) SELECT id, 'Padrão' FROM escolas;

-- Recria horarios_base com grade_id (a restrição única passa a ser por grade).
CREATE TABLE horarios_nova (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id     INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    grade_id      INTEGER REFERENCES grades(id) ON DELETE CASCADE,
    ordem         INTEGER NOT NULL,
    rotulo        TEXT NOT NULL,
    inicio_min    INTEGER NOT NULL CHECK (inicio_min BETWEEN 0 AND 1439),
    fim_min       INTEGER NOT NULL CHECK (fim_min BETWEEN 1 AND 1440),
    tipo          TEXT NOT NULL DEFAULT 'aula' CHECK (tipo IN ('aula','intervalo')),
    turno         TEXT NOT NULL DEFAULT 'manha' CHECK (turno IN ('manha','tarde','noite')),
    CHECK (fim_min > inicio_min),
    UNIQUE (grade_id, inicio_min)
);
INSERT INTO horarios_nova (id, escola_id, grade_id, ordem, rotulo, inicio_min, fim_min, tipo, turno)
    SELECT h.id, h.escola_id, (SELECT g.id FROM grades g WHERE g.escola_id = h.escola_id),
           h.ordem, h.rotulo, h.inicio_min, h.fim_min, h.tipo, h.turno
    FROM horarios_base h;
DROP TABLE horarios_base;
ALTER TABLE horarios_nova RENAME TO horarios_base;
CREATE INDEX ix_horarios_esc   ON horarios_base (escola_id, inicio_min);
CREATE INDEX ix_horarios_turno ON horarios_base (escola_id, turno, inicio_min);
CREATE INDEX ix_horarios_grade ON horarios_base (grade_id, inicio_min);

ALTER TABLE turmas ADD COLUMN grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL;
UPDATE turmas SET grade_id = (SELECT g.id FROM grades g WHERE g.escola_id = turmas.escola_id);

-- Professor e sala deixam de ter índice único por faixa (a checagem é por sobreposição de horário, no código).
DROP INDEX IF EXISTS ux_aula_sala;
DROP INDEX IF EXISTS ux_aula_professor;

-- Toda escola tem ao menos uma grade; faixas e turmas sem grade caem na primeira da escola.
CREATE TRIGGER trg_escola_grade AFTER INSERT ON escolas
BEGIN
    INSERT INTO grades (escola_id, nome) VALUES (NEW.id, 'Padrão');
END;
CREATE TRIGGER trg_horario_grade AFTER INSERT ON horarios_base WHEN NEW.grade_id IS NULL
BEGIN
    UPDATE horarios_base SET grade_id = (SELECT MIN(id) FROM grades WHERE escola_id = NEW.escola_id) WHERE id = NEW.id;
END;
CREATE TRIGGER trg_turma_grade AFTER INSERT ON turmas WHEN NEW.grade_id IS NULL
BEGIN
    UPDATE turmas SET grade_id = (SELECT MIN(id) FROM grades WHERE escola_id = NEW.escola_id) WHERE id = NEW.id;
END;

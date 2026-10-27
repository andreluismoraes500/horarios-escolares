-- Horários passam a pertencer a um turno (manhã, tarde ou noite).
-- Uma escola pode ter os três; cada turma só usa os horários do seu turno.

ALTER TABLE horarios_base ADD COLUMN turno TEXT NOT NULL DEFAULT 'manha'
    CHECK (turno IN ('manha','tarde','noite'));

-- Bancos já existentes: infere o turno pelo horário de início
-- (antes das 12:00 = manhã, até 18:00 = tarde, depois = noite).
UPDATE horarios_base SET turno = CASE
    WHEN inicio_min < 720  THEN 'manha'
    WHEN inicio_min < 1080 THEN 'tarde'
    ELSE 'noite'
END;

CREATE INDEX ix_horarios_turno ON horarios_base (escola_id, turno, inicio_min);

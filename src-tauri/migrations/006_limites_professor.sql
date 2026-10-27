-- Limites e regras de trabalho do professor (usados pelo gerador e nos avisos da grade).
ALTER TABLE professores ADD COLUMN max_aulas_semana INTEGER;                       -- NULL = sem limite
ALTER TABLE professores ADD COLUMN max_aulas_dia    INTEGER;                       -- NULL = sem limite
ALTER TABLE professores ADD COLUMN deslocamento_min INTEGER NOT NULL DEFAULT 0;    -- tempo de deslocamento até/de outro local de trabalho
ALTER TABLE professores ADD COLUMN intersticio_horas INTEGER NOT NULL DEFAULT 0;   -- descanso mínimo entre o fim de um dia e o início do seguinte
ALTER TABLE professores ADD COLUMN da_aula_sabado INTEGER NOT NULL DEFAULT 1;      -- 1 = pode dar aula aos sábados

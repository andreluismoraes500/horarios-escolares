-- Turmas com jornada diferente da do turno (ex.: Integrado das 07:00 às 14:30 num turno da manhã que vai até 12:40).
-- fim_max_min: horário (em minutos) em que a turma termina. NULL = só os horários do próprio turno.
-- Se for maior que o fim do turno, a turma também usa os horários seguintes (de outros turnos) até esse limite;
-- se for menor, a turma encerra mais cedo.
ALTER TABLE turmas ADD COLUMN fim_max_min INTEGER;

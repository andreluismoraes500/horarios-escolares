-- Um coordenador pode ser também um professor cadastrado.
ALTER TABLE coordenadores ADD COLUMN professor_id INTEGER REFERENCES professores(id) ON DELETE SET NULL;

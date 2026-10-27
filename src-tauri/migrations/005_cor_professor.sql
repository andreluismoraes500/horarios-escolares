-- Cada professor ganha uma cor (usada na grade e nas listas).
ALTER TABLE professores ADD COLUMN cor TEXT NOT NULL DEFAULT '#64748b';

-- Professores já cadastrados recebem cores distintas de uma paleta de 12.
UPDATE professores SET cor = CASE (id - 1) % 12
    WHEN 0 THEN '#2563eb' WHEN 1 THEN '#dc2626' WHEN 2 THEN '#16a34a' WHEN 3 THEN '#d97706'
    WHEN 4 THEN '#9333ea' WHEN 5 THEN '#0891b2' WHEN 6 THEN '#db2777' WHEN 7 THEN '#65a30d'
    WHEN 8 THEN '#ea580c' WHEN 9 THEN '#4f46e5' WHEN 10 THEN '#0d9488' ELSE '#be123c'
END;

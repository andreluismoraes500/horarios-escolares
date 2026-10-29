-- Feriados, recessos e datas especiais da escola (usados na lista de presença dos professores).
-- Os feriados nacionais são calculados pelo sistema; aqui ficam os locais/ajustes, em intervalos de datas.
-- bloqueia_assinatura = 1: o professor não assina nesses dias. 0: libera (ex.: sábado letivo, que anula um feriado).
CREATE TABLE feriados (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    escola_id           INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    data_ini            TEXT NOT NULL,            -- AAAA-MM-DD
    data_fim            TEXT NOT NULL,            -- AAAA-MM-DD (igual à inicial para um dia só)
    nome                TEXT NOT NULL,
    tipo                TEXT NOT NULL DEFAULT 'feriado',
    bloqueia_assinatura INTEGER NOT NULL DEFAULT 1,
    CHECK (data_fim >= data_ini)
);
CREATE INDEX ix_feriados_escola ON feriados (escola_id, data_ini);

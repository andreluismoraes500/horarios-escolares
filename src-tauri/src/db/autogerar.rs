//! Motor de geração automática da grade.
//!
//! Função pura (sem banco): recebe horários, turmas, professores (matérias e
//! indisponibilidades), salas, demandas semanais e as aulas já existentes, e devolve
//! as alocações que cabem sem conflito de professor, sala ou turma, respeitando a
//! indisponibilidade dos professores. O que não couber vira "pendência" com o motivo.
//!
//! Estratégia: guloso por dificuldade (professor fixo / poucos professores primeiro),
//! pontuando cada posição (espalhar a matéria na semana, aulas geminadas quando houver
//! mais de uma no dia, grade compacta, carga equilibrada), com uma etapa de reparo que
//! tenta mover uma aula já colocada para liberar o professor, e várias tentativas
//! com variações determinísticas — vence a que deixar menos aulas pendentes.

use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct Faixa {
    pub id: i64,
    /// Grade de horários a que a faixa pertence.
    pub grade_id: i64,
    pub turno: String,
    /// Posição da faixa dentro do turno (ordenada pelo início).
    pub ordem: usize,
    /// Início e fim em minutos desde 00:00.
    pub ini: i64,
    pub fim: i64,
}

#[derive(Debug, Clone, Default)]
pub struct Prof {
    pub id: i64,
    pub materias: Vec<i64>,
    /// Períodos indisponíveis: (dia, horario_id).
    pub indisp: HashSet<(i64, i64)>,
    /// Limites de carga (None = sem limite).
    pub max_semana: Option<i64>,
    pub max_dia: Option<i64>,
    /// Minutos de deslocamento exigidos antes/depois de um período indisponível (outro local de trabalho).
    pub desloc_min: i64,
    /// Descanso mínimo (minutos) entre o fim de um dia de trabalho e o início do seguinte.
    pub intersticio_min: i64,
    /// true = NÃO dá aula aos sábados.
    pub sem_sabado: bool,
}

#[derive(Debug, Clone)]
pub struct SalaE {
    pub id: i64,
    pub tipo: String,
    pub capacidade: i64,
}

#[derive(Debug, Clone)]
pub struct TurmaE {
    pub id: i64,
    pub grade_id: i64,
    pub turno: String,
    pub alunos: i64,
    /// Horário de término da turma (min); None = termina com o turno.
    pub fim_max: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct DemandaE {
    pub turma_id: i64,
    pub materia_id: i64,
    pub aulas: i64,
    pub professor_id: Option<i64>,
    pub sala_id: Option<i64>,
    pub max_dia: i64,
}

#[derive(Debug, Clone)]
pub struct Existente {
    pub dia: i64,
    pub horario_id: i64,
    pub turma_ids: Vec<i64>,
    pub professor_id: Option<i64>,
    pub sala_id: Option<i64>,
    pub materia_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct Entrada {
    pub dias: Vec<i64>,
    pub faixas: Vec<Faixa>,
    pub turmas: Vec<TurmaE>,
    pub professores: Vec<Prof>,
    pub salas: Vec<SalaE>,
    pub demandas: Vec<DemandaE>,
    pub existentes: Vec<Existente>,
    pub tentativas: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Alocacao {
    pub turma_id: i64,
    pub materia_id: i64,
    pub professor_id: Option<i64>,
    pub sala_id: Option<i64>,
    pub dia: i64,
    pub horario_id: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Pendencia {
    pub turma_id: i64,
    pub materia_id: i64,
    pub faltam: i64,
    pub motivo: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Resultado {
    pub alocacoes: Vec<Alocacao>,
    pub pendencias: Vec<Pendencia>,
    /// Aulas alocadas sem sala (não havia sala livre).
    pub sem_sala: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Motivo {
    Turma,
    Limite,
    ProfIndisp,
    ProfOcupado,
    Sala,
    SemProf,
    SemFaixas,
    ProfLimite,
    ProfDesloc,
    ProfIntersticio,
    ProfSabado,
}

fn texto_motivo(m: Motivo) -> &'static str {
    match m {
        Motivo::Turma => "a turma não tem mais horários livres no turno",
        Motivo::Limite => "o limite de aulas da matéria por dia foi atingido em todos os dias",
        Motivo::ProfIndisp => "o professor está indisponível nos horários livres da turma",
        Motivo::ProfOcupado => "o professor já está ocupado nos horários livres da turma",
        Motivo::Sala => "a sala exigida está ocupada nos horários livres da turma",
        Motivo::SemProf => "nenhum professor cadastrado para esta matéria",
        Motivo::SemFaixas => "não há horários de aula configurados para o turno da turma",
        Motivo::ProfLimite => "o professor atingiu o limite de aulas (por dia ou por semana)",
        Motivo::ProfDesloc => "o tempo de deslocamento do professor impede os horários livres da turma",
        Motivo::ProfIntersticio => "o intervalo mínimo (interstício) entre jornadas do professor não é respeitado nos horários livres",
        Motivo::ProfSabado => "o professor não dá aula aos sábados",
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
}

type Chave3 = (i64, i64, i64);

struct Estado<'a> {
    e: &'a Entrada,
    ordem_faixa: HashMap<i64, usize>,
    /// Faixas permitidas para cada turma (jornada do turno, encurtada ou estendida), em ordem de horário.
    faixas_turma: HashMap<i64, Vec<i64>>,
    turma_por_id: HashMap<i64, &'a TurmaE>,
    prof_por_id: HashMap<i64, &'a Prof>,
    profs_da_materia: HashMap<i64, Vec<i64>>,
    /// Para cada faixa, as faixas (de qualquer grade) que se sobrepõem a ela no relógio, incluindo ela mesma.
    sobrep: HashMap<i64, Vec<i64>>,
    prof_ocup: HashSet<Chave3>,
    sala_ocup: HashSet<Chave3>,
    turma_ocup: HashSet<Chave3>,
    dia_mat: HashMap<Chave3, i64>,
    carga_turma_dia: HashMap<(i64, i64), i64>,
    carga_prof: HashMap<i64, i64>,
    /// Aulas do professor por dia e horários (ini, fim) ocupados por dia.
    carga_prof_dia: HashMap<(i64, i64), i64>,
    horas_prof: HashMap<(i64, i64), Vec<(i64, i64)>>,
    tempo_faixa: HashMap<i64, (i64, i64)>,
    /// Horários bloqueados por deslocamento (perto de um período indisponível).
    desloc_bloq: HashSet<(i64, i64, i64)>,
    ligado: HashMap<(i64, i64), i64>,
    casa: HashMap<i64, HashMap<i64, i64>>,
    pos_mat: HashSet<(i64, i64, i64, usize)>,
    aloc: Vec<Alocacao>,
    ja: HashMap<(i64, i64), i64>,
}

#[derive(Default)]
struct Placar(HashMap<Motivo, i64>);
impl Placar {
    fn add(&mut self, m: Motivo) {
        *self.0.entry(m).or_insert(0) += 1;
    }
}

impl<'a> Estado<'a> {
    fn novo(e: &'a Entrada) -> Self {
        // Posição global (por horário de início) de cada faixa de aula: usada para saber se duas aulas são seguidas.
        let mut ordenadas: Vec<&Faixa> = e.faixas.iter().collect();
        ordenadas.sort_by_key(|f| (f.ini, f.id));
        // Posição dentro da própria grade (grades diferentes podem se intercalar no relógio).
        let mut contador: HashMap<i64, usize> = HashMap::new();
        let mut ordem_faixa: HashMap<i64, usize> = HashMap::new();
        for f in &ordenadas {
            let c = contador.entry(f.grade_id).or_insert(0);
            ordem_faixa.insert(f.id, *c);
            *c += 1;
        }
        let mut limites: HashMap<(i64, &str), (i64, i64)> = HashMap::new();
        for f in &e.faixas {
            let l = limites.entry((f.grade_id, f.turno.as_str())).or_insert((f.ini, f.fim));
            l.0 = l.0.min(f.ini);
            l.1 = l.1.max(f.fim);
        }
        let faixas_turma: HashMap<i64, Vec<i64>> = e
            .turmas
            .iter()
            .map(|t| {
                let (ini_t, fim_t) = limites.get(&(t.grade_id, t.turno.as_str())).copied().unwrap_or((0, 0));
                let v = ordenadas
                    .iter()
                    .filter(|f| {
                        f.grade_id == t.grade_id
                            && crate::db::horarios::faixa_permitida(&t.turno, t.fim_max, ini_t, fim_t, &f.turno, f.ini, f.fim)
                    })
                    .map(|f| f.id)
                    .collect();
                (t.id, v)
            })
            .collect();
        let sobrep: HashMap<i64, Vec<i64>> = e
            .faixas
            .iter()
            .map(|f| {
                let v = e
                    .faixas
                    .iter()
                    .filter(|g| g.id == f.id || crate::db::horarios::sobrepoe(f.ini, f.fim, g.ini, g.fim))
                    .map(|g| g.id)
                    .collect();
                (f.id, v)
            })
            .collect();
        let mut profs_da_materia: HashMap<i64, Vec<i64>> = HashMap::new();
        for p in &e.professores {
            for m in &p.materias {
                profs_da_materia.entry(*m).or_default().push(p.id);
            }
        }
        let mut st = Estado {
            e,
            ordem_faixa,
            faixas_turma,
            turma_por_id: e.turmas.iter().map(|t| (t.id, t)).collect(),
            prof_por_id: e.professores.iter().map(|p| (p.id, p)).collect(),
            profs_da_materia,
            sobrep,
            prof_ocup: HashSet::new(),
            sala_ocup: HashSet::new(),
            turma_ocup: HashSet::new(),
            dia_mat: HashMap::new(),
            carga_turma_dia: HashMap::new(),
            carga_prof: HashMap::new(),
            carga_prof_dia: HashMap::new(),
            horas_prof: HashMap::new(),
            tempo_faixa: e.faixas.iter().map(|f| (f.id, (f.ini, f.fim))).collect(),
            desloc_bloq: HashSet::new(),
            ligado: HashMap::new(),
            casa: HashMap::new(),
            pos_mat: HashSet::new(),
            aloc: Vec::new(),
            ja: HashMap::new(),
        };
        // Deslocamento: horários cuja distância até um período indisponível é menor que o deslocamento.
        for p in &e.professores {
            if p.desloc_min <= 0 {
                continue;
            }
            for &(d, uh) in &p.indisp {
                let Some(&(ui, uf)) = st.tempo_faixa.get(&uh) else { continue };
                for f in &e.faixas {
                    if f.id == uh {
                        continue;
                    }
                    let gap = if f.fim <= ui { ui - f.fim } else if uf <= f.ini { f.ini - uf } else { 0 };
                    if gap < p.desloc_min {
                        st.desloc_bloq.insert((d, f.id, p.id));
                    }
                }
            }
        }
        for x in &e.existentes {
            if let Some(p) = x.professor_id {
                st.prof_ocup.insert((x.dia, x.horario_id, p));
                *st.carga_prof.entry(p).or_insert(0) += 1;
                *st.carga_prof_dia.entry((p, x.dia)).or_insert(0) += 1;
                if let Some(&t) = st.tempo_faixa.get(&x.horario_id) {
                    st.horas_prof.entry((p, x.dia)).or_default().push(t);
                }
            }
            if let Some(s) = x.sala_id {
                st.sala_ocup.insert((x.dia, x.horario_id, s));
            }
            for &t in &x.turma_ids {
                st.turma_ocup.insert((x.dia, x.horario_id, t));
                *st.carga_turma_dia.entry((t, x.dia)).or_insert(0) += 1;
                if let Some(m) = x.materia_id {
                    *st.dia_mat.entry((t, m, x.dia)).or_insert(0) += 1;
                    *st.ja.entry((t, m)).or_insert(0) += 1;
                    if let Some(&o) = st.ordem_faixa.get(&x.horario_id) {
                        st.pos_mat.insert((t, m, x.dia, o));
                    }
                    if let Some(p) = x.professor_id {
                        st.ligado.entry((t, m)).or_insert(p);
                    }
                }
                if let Some(s) = x.sala_id {
                    *st.casa.entry(t).or_default().entry(s).or_insert(0) += 1;
                }
            }
        }
        st
    }

    /// O recurso (professor/sala) está ocupado em alguma faixa que se sobreponha a esta (mesmo dia)?
    fn ocupado(&self, set: &HashSet<Chave3>, dia: i64, hid: i64, x: i64) -> bool {
        match self.sobrep.get(&hid) {
            Some(v) => v.iter().any(|o| set.contains(&(dia, *o, x))),
            None => set.contains(&(dia, hid, x)),
        }
    }

    /// Regras do professor que independem de ocupação: indisponibilidade, sábado, deslocamento,
    /// limites de carga e interstício entre jornadas.
    fn prof_restricao(&self, pid: i64, dia: i64, hid: i64) -> Result<(), Motivo> {
        let Some(p) = self.prof_por_id.get(&pid) else { return Err(Motivo::SemProf) };
        if dia == 6 && p.sem_sabado {
            return Err(Motivo::ProfSabado);
        }
        if p.indisp.contains(&(dia, hid)) {
            return Err(Motivo::ProfIndisp);
        }
        if self.desloc_bloq.contains(&(dia, hid, pid)) {
            return Err(Motivo::ProfDesloc);
        }
        if let Some(m) = p.max_semana {
            if *self.carga_prof.get(&pid).unwrap_or(&0) >= m {
                return Err(Motivo::ProfLimite);
            }
        }
        if let Some(m) = p.max_dia {
            if *self.carga_prof_dia.get(&(pid, dia)).unwrap_or(&0) >= m {
                return Err(Motivo::ProfLimite);
            }
        }
        if p.intersticio_min > 0 {
            if let Some(&(ini, fim)) = self.tempo_faixa.get(&hid) {
                let hoje = self.horas_prof.get(&(pid, dia));
                let primeiro = hoje.and_then(|l| l.iter().map(|x| x.0).min()).map_or(ini, |m| m.min(ini));
                let ultimo = hoje.and_then(|l| l.iter().map(|x| x.1).max()).map_or(fim, |m| m.max(fim));
                if let Some(l) = self.horas_prof.get(&(pid, dia - 1)) {
                    if let Some(fim_ontem) = l.iter().map(|x| x.1).max() {
                        if 1440 - fim_ontem + primeiro < p.intersticio_min {
                            return Err(Motivo::ProfIntersticio);
                        }
                    }
                }
                if let Some(l) = self.horas_prof.get(&(pid, dia + 1)) {
                    if let Some(ini_amanha) = l.iter().map(|x| x.0).min() {
                        if 1440 - ultimo + ini_amanha < p.intersticio_min {
                            return Err(Motivo::ProfIntersticio);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn escolher_sala(&self, d: &DemandaE, dia: i64, hid: i64) -> Result<Option<i64>, Motivo> {
        if let Some(s) = d.sala_id {
            return if self.ocupado(&self.sala_ocup, dia, hid, s) { Err(Motivo::Sala) } else { Ok(Some(s)) };
        }
        let alunos = self.turma_por_id.get(&d.turma_id).map(|t| t.alunos).unwrap_or(0);
        let livres: Vec<&SalaE> = self
            .e
            .salas
            .iter()
            .filter(|s| s.tipo == "sala_aula" && !self.ocupado(&self.sala_ocup, dia, hid, s.id))
            .collect();
        if livres.is_empty() {
            return Ok(None);
        }
        if let Some(uso) = self.casa.get(&d.turma_id) {
            if let Some(s) = livres.iter().filter(|s| uso.contains_key(&s.id)).max_by_key(|s| (uso[&s.id], -s.id)) {
                return Ok(Some(s.id));
            }
        }
        let melhor = livres
            .iter()
            .filter(|s| s.capacidade >= alunos)
            .min_by_key(|s| (s.capacidade, s.id))
            .or_else(|| livres.iter().max_by_key(|s| (s.capacidade, -s.id)));
        Ok(melhor.map(|s| s.id))
    }

    /// Melhor posição para uma aula da demanda `d` (ou o motivo mais comum de não caber).
    fn melhor_posicao(
        &self,
        d: &DemandaE,
        excluir: Option<(i64, i64)>,
        jitter: u64,
        rng: &mut Rng,
        placar: &mut Placar,
    ) -> Option<(i64, i64, i64, Option<i64>, Option<i64>)> {
        self.turma_por_id.get(&d.turma_id)?;
        let faixas = match self.faixas_turma.get(&d.turma_id) {
            Some(f) if !f.is_empty() => f,
            _ => {
                placar.add(Motivo::SemFaixas);
                return None;
            }
        };
        // Professores candidatos, em ordem de preferência (o já vinculado à turma/matéria primeiro).
        let mut candidatos: Vec<i64> = match d.professor_id {
            Some(p) => vec![p],
            None => self.profs_da_materia.get(&d.materia_id).cloned().unwrap_or_default(),
        };
        if candidatos.is_empty() {
            placar.add(Motivo::SemProf);
            return None;
        }
        let ligado = self.ligado.get(&(d.turma_id, d.materia_id)).copied();
        candidatos.sort_by_key(|p| (Some(*p) != ligado, *self.carga_prof.get(p).unwrap_or(&0), *p));

        let mut melhor: Option<(i64, i64, i64, Option<i64>, Option<i64>)> = None;
        for &dia in &self.e.dias {
            let c = *self.dia_mat.get(&(d.turma_id, d.materia_id, dia)).unwrap_or(&0);
            for (idx, &hid) in faixas.iter().enumerate() {
                if excluir == Some((dia, hid)) {
                    continue;
                }
                if self.turma_ocup.contains(&(dia, hid, d.turma_id)) {
                    placar.add(Motivo::Turma);
                    continue;
                }
                if c >= d.max_dia {
                    placar.add(Motivo::Limite);
                    continue;
                }
                let mut escolhido = None;
                let mut falhas: Vec<Motivo> = Vec::new();
                for &p in &candidatos {
                    if let Err(m) = self.prof_restricao(p, dia, hid) {
                        falhas.push(m);
                        continue;
                    }
                    if self.ocupado(&self.prof_ocup, dia, hid, p) {
                        falhas.push(Motivo::ProfOcupado);
                        continue;
                    }
                    escolhido = Some(p);
                    break;
                }
                let prof = match escolhido {
                    Some(p) => p,
                    None => {
                        let m = if falhas.contains(&Motivo::ProfOcupado) { Motivo::ProfOcupado } else { falhas[0] };
                        placar.add(m);
                        continue;
                    }
                };
                let sala = match self.escolher_sala(d, dia, hid) {
                    Ok(s) => s,
                    Err(m) => {
                        placar.add(m);
                        continue;
                    }
                };
                // Pontuação (menor é melhor).
                let mut s = 100 * c;
                if c >= 1 {
                    let rank = self.ordem_faixa.get(&hid).copied().unwrap_or(0);
                    let vizinho = (rank > 0 && self.pos_mat.contains(&(d.turma_id, d.materia_id, dia, rank - 1)))
                        || self.pos_mat.contains(&(d.turma_id, d.materia_id, dia, rank + 1));
                    s += if vizinho { -60 } else { 20 };
                }
                s += 4 * *self.carga_turma_dia.get(&(d.turma_id, dia)).unwrap_or(&0);
                s += 2 * idx as i64;
                if idx > 0 && !self.turma_ocup.contains(&(dia, faixas[idx - 1], d.turma_id)) {
                    s += 15; // evita "buracos" na grade da turma
                }
                if jitter > 0 {
                    s += rng.below(jitter) as i64;
                }
                if melhor.map(|m| s < m.0).unwrap_or(true) {
                    melhor = Some((s, dia, hid, Some(prof), sala));
                }
            }
        }
        melhor
    }

    fn colocar(&mut self, a: Alocacao) {
        if let Some(p) = a.professor_id {
            self.prof_ocup.insert((a.dia, a.horario_id, p));
            *self.carga_prof.entry(p).or_insert(0) += 1;
            *self.carga_prof_dia.entry((p, a.dia)).or_insert(0) += 1;
            if let Some(&t) = self.tempo_faixa.get(&a.horario_id) {
                self.horas_prof.entry((p, a.dia)).or_default().push(t);
            }
            self.ligado.entry((a.turma_id, a.materia_id)).or_insert(p);
        }
        if let Some(s) = a.sala_id {
            self.sala_ocup.insert((a.dia, a.horario_id, s));
            *self.casa.entry(a.turma_id).or_default().entry(s).or_insert(0) += 1;
        }
        self.turma_ocup.insert((a.dia, a.horario_id, a.turma_id));
        *self.dia_mat.entry((a.turma_id, a.materia_id, a.dia)).or_insert(0) += 1;
        *self.carga_turma_dia.entry((a.turma_id, a.dia)).or_insert(0) += 1;
        if let Some(&o) = self.ordem_faixa.get(&a.horario_id) {
            self.pos_mat.insert((a.turma_id, a.materia_id, a.dia, o));
        }
        self.aloc.push(a);
    }

    /// Remove a alocação de índice `i` (devolvendo-a).
    fn retirar(&mut self, i: usize) -> Alocacao {
        let a = self.aloc.remove(i);
        if let Some(p) = a.professor_id {
            self.prof_ocup.remove(&(a.dia, a.horario_id, p));
            if let Some(c) = self.carga_prof.get_mut(&p) {
                *c -= 1;
            }
            if let Some(c) = self.carga_prof_dia.get_mut(&(p, a.dia)) {
                *c -= 1;
            }
            if let (Some(t), Some(l)) = (self.tempo_faixa.get(&a.horario_id), self.horas_prof.get_mut(&(p, a.dia))) {
                if let Some(i) = l.iter().position(|x| x == t) {
                    l.remove(i);
                }
            }
        }
        if let Some(s) = a.sala_id {
            self.sala_ocup.remove(&(a.dia, a.horario_id, s));
            if let Some(c) = self.casa.get_mut(&a.turma_id).and_then(|m| m.get_mut(&s)) {
                *c -= 1;
            }
        }
        self.turma_ocup.remove(&(a.dia, a.horario_id, a.turma_id));
        if let Some(c) = self.dia_mat.get_mut(&(a.turma_id, a.materia_id, a.dia)) {
            *c -= 1;
        }
        if let Some(c) = self.carga_turma_dia.get_mut(&(a.turma_id, a.dia)) {
            *c -= 1;
        }
        if let Some(&o) = self.ordem_faixa.get(&a.horario_id) {
            self.pos_mat.remove(&(a.turma_id, a.materia_id, a.dia, o));
        }
        a
    }

    /// Tenta alocar uma aula da demanda `d` direto numa posição livre.
    fn tentar_direto(&mut self, d: &DemandaE, jitter: u64, rng: &mut Rng, placar: &mut Placar) -> bool {
        match self.melhor_posicao(d, None, jitter, rng, placar) {
            Some((_, dia, hid, prof, sala)) => {
                self.colocar(Alocacao { turma_id: d.turma_id, materia_id: d.materia_id, professor_id: prof, sala_id: sala, dia, horario_id: hid });
                true
            }
            None => false,
        }
    }

    /// Reparo: libera um horário movendo, para outro lugar, uma aula (gerada agora) cujo
    /// professor/sala impede a aula `d` de entrar.
    fn tentar_com_reparo(&mut self, d: &DemandaE, demandas: &[DemandaE], rng: &mut Rng) -> bool {
        if !self.turma_por_id.contains_key(&d.turma_id) {
            return false;
        }
        let faixas = match self.faixas_turma.get(&d.turma_id) {
            Some(f) => f.clone(),
            None => return false,
        };
        let c_dia = |s: &Self, dia: i64| *s.dia_mat.get(&(d.turma_id, d.materia_id, dia)).unwrap_or(&0);
        for dia in self.e.dias.clone() {
            if c_dia(self, dia) >= d.max_dia {
                continue;
            }
            for &hid in &faixas {
                if self.turma_ocup.contains(&(dia, hid, d.turma_id)) {
                    continue;
                }
                // Quem bloqueia neste horário? Procura aulas geradas agora com o professor/sala necessário.
                let profs: Vec<i64> = match d.professor_id {
                    Some(p) => vec![p],
                    None => self.profs_da_materia.get(&d.materia_id).cloned().unwrap_or_default(),
                };
                for p in profs {
                    if self.prof_restricao(p, dia, hid).is_err() || !self.ocupado(&self.prof_ocup, dia, hid, p) {
                        continue;
                    }
                    let Some(i) = self.aloc.iter().position(|a| a.dia == dia && self.sobrep.get(&hid).map_or(a.horario_id == hid, |v| v.contains(&a.horario_id)) && a.professor_id == Some(p)) else {
                        continue; // bloqueio por aula já existente: não mexemos
                    };
                    let bloqueadora = self.aloc[i].clone();
                    let Some(db) = demandas.iter().find(|x| x.turma_id == bloqueadora.turma_id && x.materia_id == bloqueadora.materia_id) else {
                        continue;
                    };
                    let retirada = self.retirar(i);
                    let mut ignora = Placar::default();
                    let nova_pos = self.melhor_posicao(db, Some((dia, hid)), 0, rng, &mut ignora);
                    if let Some((_, nd, nh, np, ns)) = nova_pos {
                        self.colocar(Alocacao { turma_id: db.turma_id, materia_id: db.materia_id, professor_id: np, sala_id: ns, dia: nd, horario_id: nh });
                        // Agora o horário deve estar livre para a nova aula.
                        let mut p2 = Placar::default();
                        if let Some((_, d2, h2, pr, sa)) = self.melhor_posicao(d, None, 0, rng, &mut p2) {
                            self.colocar(Alocacao { turma_id: d.turma_id, materia_id: d.materia_id, professor_id: pr, sala_id: sa, dia: d2, horario_id: h2 });
                            return true;
                        }
                        // Desfaz: tira a recém-colocada e devolve a original.
                        let n = self.aloc.len() - 1;
                        self.retirar(n);
                    }
                    self.colocar(retirada);
                }
            }
        }
        false
    }
}

fn tentativa(e: &Entrada, semente: u64) -> (Resultado, i64) {
    let mut rng = Rng(semente.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let jitter: u64 = if semente == 0 { 0 } else { 6 };
    let mut st = Estado::novo(e);

    // Ordem: demandas mais difíceis primeiro (professor fixo, poucos professores, mais aulas).
    let mut ordem: Vec<(i64, usize)> = e
        .demandas
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let ncand = match d.professor_id {
                Some(_) => 1,
                None => st.profs_da_materia.get(&d.materia_id).map(|v| v.len()).unwrap_or(0) as i64,
            };
            let chave = ncand * 10 - d.aulas + if semente == 0 { 0 } else { rng.below(12) as i64 - 6 };
            (chave, i)
        })
        .collect();
    ordem.sort();

    let mut pendencias = Vec::new();
    for (_, i) in ordem {
        let d = &e.demandas[i];
        let ja = *st.ja.get(&(d.turma_id, d.materia_id)).unwrap_or(&0);
        let mut faltam = (d.aulas - ja).max(0);
        let mut placar = Placar::default();
        while faltam > 0 {
            if st.tentar_direto(d, jitter, &mut rng, &mut placar) || st.tentar_com_reparo(d, &e.demandas, &mut rng) {
                faltam -= 1;
            } else {
                break;
            }
        }
        if faltam > 0 {
            let motivo = placar
                .0
                .iter()
                .max_by_key(|(m, n)| (**n, std::cmp::Reverse(**m as u8 as i64)))
                .map(|(m, _)| texto_motivo(*m))
                .unwrap_or("sem posição disponível");
            pendencias.push(Pendencia { turma_id: d.turma_id, materia_id: d.materia_id, faltam, motivo: motivo.to_string() });
        }
    }
    let faltantes: i64 = pendencias.iter().map(|p| p.faltam).sum();
    let sem_sala = st.aloc.iter().filter(|a| a.sala_id.is_none()).count() as i64;
    (Resultado { alocacoes: st.aloc, pendencias, sem_sala }, faltantes)
}

/// Gera a grade: várias tentativas determinísticas, fica com a que deixa menos aulas pendentes.
pub fn gerar(e: &Entrada) -> Resultado {
    let mut melhor: Option<(Resultado, i64)> = None;
    for s in 0..e.tentativas.max(1) as u64 {
        let (r, f) = tentativa(e, s);
        let vence = melhor.as_ref().map(|(_, bf)| f < *bf).unwrap_or(true);
        if vence {
            let zero = f == 0;
            melhor = Some((r, f));
            if zero {
                break;
            }
        }
    }
    melhor.map(|(r, _)| r).unwrap()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn faixas(n: usize) -> Vec<Faixa> {
        (0..n).map(|i| Faixa { grade_id: 1, id: 100 + i as i64, turno: "manha".into(), ordem: i, ini: 420 + 50 * i as i64, fim: 470 + 50 * i as i64 }).collect()
    }

    fn base(n_faixas: usize) -> Entrada {
        Entrada {
            dias: vec![1, 2, 3, 4, 5],
            faixas: faixas(n_faixas),
            turmas: vec![TurmaE { grade_id: 1, id: 1, turno: "manha".into(), alunos: 30, fim_max: None }],
            professores: vec![Prof { id: 1, materias: vec![1], ..Default::default() }],
            salas: vec![SalaE { id: 1, tipo: "sala_aula".into(), capacidade: 40 }],
            demandas: vec![DemandaE { turma_id: 1, materia_id: 1, aulas: 5, professor_id: None, sala_id: None, max_dia: 2 }],
            existentes: vec![],
            tentativas: 20,
        }
    }

    /// Nenhuma alocação pode repetir (dia, horário) para o mesmo professor, sala ou turma.
    fn sem_conflitos(r: &Resultado) {
        let mut p = HashSet::new();
        let mut s = HashSet::new();
        let mut t = HashSet::new();
        for a in &r.alocacoes {
            if let Some(x) = a.professor_id {
                assert!(p.insert((a.dia, a.horario_id, x)), "professor duplicado {a:?}");
            }
            if let Some(x) = a.sala_id {
                assert!(s.insert((a.dia, a.horario_id, x)), "sala duplicada {a:?}");
            }
            assert!(t.insert((a.dia, a.horario_id, a.turma_id)), "turma duplicada {a:?}");
        }
    }

    #[test]
    fn aloca_toda_a_demanda_espalhando_nos_dias() {
        let r = gerar(&base(5));
        assert!(r.pendencias.is_empty());
        assert_eq!(r.alocacoes.len(), 5);
        sem_conflitos(&r);
        let dias: HashSet<i64> = r.alocacoes.iter().map(|a| a.dia).collect();
        assert_eq!(dias.len(), 5, "5 aulas semanais devem cair em 5 dias diferentes");
    }

    #[test]
    fn respeita_a_indisponibilidade_do_professor() {
        let mut e = base(5);
        e.professores[0].indisp = (100..105).map(|h| (1, h)).chain((100..105).map(|h| (2, h))).collect(); // seg e ter inteiros
        e.demandas[0].aulas = 3;
        let r = gerar(&e);
        assert!(r.pendencias.is_empty());
        assert!(r.alocacoes.iter().all(|a| a.dia >= 3), "{:?}", r.alocacoes);
    }

    #[test]
    fn reporta_pendencia_com_motivo_quando_nao_cabe() {
        let mut e = base(5);
        // Professor só livre na segunda; máx. 2 por dia → só 2 de 5 aulas cabem.
        e.professores[0].indisp = (2..=5).flat_map(|d| (100..105).map(move |h| (d, h))).collect();
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 2);
        assert_eq!(r.pendencias.len(), 1);
        assert_eq!(r.pendencias[0].faltam, 3);
        assert!(r.pendencias[0].motivo.contains("indisponível") || r.pendencias[0].motivo.contains("limite"), "{}", r.pendencias[0].motivo);
        sem_conflitos(&r);
    }

    #[test]
    fn sem_professor_para_a_materia_vira_pendencia() {
        let mut e = base(5);
        e.professores[0].materias = vec![9];
        let r = gerar(&e);
        assert_eq!(r.pendencias[0].motivo, "nenhum professor cadastrado para esta matéria");
    }

    #[test]
    fn varias_turmas_com_o_mesmo_professor_nao_conflitam() {
        let mut e = base(6);
        e.turmas.push(TurmaE { grade_id: 1, id: 2, turno: "manha".into(), alunos: 30, fim_max: None });
        e.turmas.push(TurmaE { grade_id: 1, id: 3, turno: "manha".into(), alunos: 30, fim_max: None });
        e.salas.push(SalaE { id: 2, tipo: "sala_aula".into(), capacidade: 40 });
        e.salas.push(SalaE { id: 3, tipo: "sala_aula".into(), capacidade: 40 });
        e.demandas = (1..=3)
            .map(|t| DemandaE { turma_id: t, materia_id: 1, aulas: 5, professor_id: None, sala_id: None, max_dia: 2 })
            .collect();
        let r = gerar(&e);
        assert!(r.pendencias.is_empty(), "{:?}", r.pendencias);
        assert_eq!(r.alocacoes.len(), 15);
        sem_conflitos(&r);
    }

    #[test]
    fn preencher_respeita_aulas_existentes_e_so_completa_o_que_falta() {
        let mut e = base(5);
        e.existentes.push(Existente { dia: 1, horario_id: 100, turma_ids: vec![1], professor_id: Some(1), sala_id: Some(1), materia_id: Some(1) });
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 4, "1 de 5 já existia");
        assert!(!r.alocacoes.iter().any(|a| a.dia == 1 && a.horario_id == 100));
        sem_conflitos(&r);
    }

    #[test]
    fn professor_fixo_e_sala_fixa_sao_respeitados() {
        let mut e = base(5);
        e.professores.push(Prof { id: 2, materias: vec![1], ..Default::default() });
        e.salas.push(SalaE { id: 2, tipo: "laboratorio".into(), capacidade: 20 });
        e.demandas[0].professor_id = Some(2);
        e.demandas[0].sala_id = Some(2);
        let r = gerar(&e);
        assert!(r.alocacoes.iter().all(|a| a.professor_id == Some(2) && a.sala_id == Some(2)));
    }

    #[test]
    fn instancia_grande_aleatoria_nunca_gera_conflito_e_fecha_a_conta() {
        let mut rng = Rng(12345);
        let mut e = base(6);
        e.faixas = faixas(6);
        e.turmas = (1..=8).map(|i| TurmaE { grade_id: 1, id: i, turno: "manha".into(), alunos: 30, fim_max: None }).collect();
        e.salas = (1..=8).map(|i| SalaE { id: i, tipo: "sala_aula".into(), capacidade: 40 }).collect();
        e.professores = (1..=6)
            .map(|i| Prof {
                id: i,
                materias: vec![1 + (i % 4), 1 + ((i + 1) % 4)],
                indisp: (0..8).map(|_| (1 + rng.below(5) as i64, 100 + rng.below(6) as i64)).collect(),
                ..Default::default()
            })
            .collect();
        e.demandas = (1..=8)
            .flat_map(|t| (1..=4).map(move |m| (t, m)))
            .map(|(t, m)| DemandaE { turma_id: t, materia_id: m, aulas: 3, professor_id: None, sala_id: None, max_dia: 2 })
            .collect();
        e.tentativas = 30;
        let r = gerar(&e);
        sem_conflitos(&r);
        let faltam: i64 = r.pendencias.iter().map(|p| p.faltam).sum();
        assert_eq!(r.alocacoes.len() as i64 + faltam, 8 * 4 * 3);
        assert!(r.alocacoes.iter().all(|a| {
            let p = e.professores.iter().find(|p| Some(p.id) == a.professor_id).unwrap();
            !p.indisp.contains(&(a.dia, a.horario_id)) && p.materias.contains(&a.materia_id)
        }));
    }

    #[test]
    fn aulas_geminadas_quando_ha_mais_de_uma_no_dia() {
        let mut e = base(6);
        e.dias = vec![1, 2];
        e.demandas[0].aulas = 4; // 2 por dia
        let r = gerar(&e);
        assert!(r.pendencias.is_empty());
        for dia in [1, 2] {
            let mut h: Vec<i64> = r.alocacoes.iter().filter(|a| a.dia == dia).map(|a| a.horario_id).collect();
            h.sort();
            assert_eq!(h.len(), 2);
            assert_eq!(h[1] - h[0], 1, "as duas aulas do dia devem ser consecutivas: {h:?}");
        }
    }

    #[test]
    fn resultado_e_deterministico() {
        let e = base(5);
        assert_eq!(gerar(&e).alocacoes, gerar(&e).alocacoes);
    }

    #[test]
    fn respeita_maximo_de_aulas_por_dia_e_por_semana() {
        let mut e = base(5);
        e.professores[0].max_dia = Some(1);
        e.dias = vec![1, 2];
        e.demandas[0].aulas = 4;
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 2, "1 por dia em 2 dias");
        assert!(r.pendencias[0].motivo.contains("limite"), "{}", r.pendencias[0].motivo);

        let mut e = base(5);
        e.professores[0].max_semana = Some(3);
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 3);
        assert_eq!(r.pendencias[0].faltam, 2);
    }

    #[test]
    fn professor_que_nao_da_aula_no_sabado_nao_recebe_sabado() {
        let mut e = base(5);
        e.dias = vec![1, 2, 3, 4, 5, 6];
        e.professores[0].sem_sabado = true;
        e.professores[0].max_dia = Some(1);
        e.demandas[0].aulas = 6;
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 5);
        assert!(r.alocacoes.iter().all(|a| a.dia != 6));
        assert_eq!(r.pendencias[0].faltam, 1);
        // Com sábado liberado, a 6ª aula cabe.
        e.professores[0].sem_sabado = false;
        assert_eq!(gerar(&e).alocacoes.len(), 6);
    }

    #[test]
    fn deslocamento_bloqueia_horarios_proximos_a_compromisso_externo() {
        let mut e = base(5); // faixas de 50 min contínuas
        e.dias = vec![1];
        e.professores[0].indisp = [(1, 102)].into_iter().collect(); // compromisso externo no horário do meio
        e.professores[0].desloc_min = 60;
        e.demandas[0].aulas = 1;
        let r = gerar(&e);
        assert!(r.alocacoes.is_empty(), "todas as faixas ficam a menos de 60 min do compromisso: {:?}", r.alocacoes);
        assert!(r.pendencias[0].motivo.contains("deslocamento"), "{}", r.pendencias[0].motivo);
        // Sem deslocamento exigido, as faixas distantes servem.
        e.professores[0].desloc_min = 0;
        assert_eq!(gerar(&e).alocacoes.len(), 1);
    }

    #[test]
    fn intersticio_impede_aula_cedo_depois_de_jornada_que_termina_tarde() {
        let mut e = base(2);
        e.faixas = vec![
            Faixa { grade_id: 1, id: 100, turno: "manha".into(), ordem: 0, ini: 420, fim: 470 },
            Faixa { grade_id: 1, id: 101, turno: "manha".into(), ordem: 1, ini: 1260, fim: 1310 },
        ];
        e.dias = vec![1, 2];
        e.professores[0].intersticio_min = 11 * 60;
        e.professores[0].indisp = [(1, 100)].into_iter().collect();
        e.existentes.push(Existente { dia: 1, horario_id: 101, turma_ids: vec![9], professor_id: Some(1), sala_id: None, materia_id: None });
        e.demandas[0].aulas = 1;
        let r = gerar(&e);
        // Terça cedo (07:00) teria só 9h10 de descanso depois das 21:50; a opção válida é terça à noite.
        assert_eq!(r.alocacoes.len(), 1);
        assert_eq!((r.alocacoes[0].dia, r.alocacoes[0].horario_id), (2, 101));
    }

    #[test]
    fn turma_integral_usa_faixas_de_outro_turno_ate_o_fim_da_jornada() {
        let mut e = base(2);
        // Manhã: 07:00–07:50 e 07:50–08:40. Tarde: 13:00–13:50 e 13:50–14:40.
        e.faixas = vec![
            Faixa { grade_id: 1, id: 100, turno: "manha".into(), ordem: 0, ini: 420, fim: 470 },
            Faixa { grade_id: 1, id: 101, turno: "manha".into(), ordem: 1, ini: 470, fim: 520 },
            Faixa { grade_id: 1, id: 102, turno: "tarde".into(), ordem: 0, ini: 780, fim: 830 },
            Faixa { grade_id: 1, id: 103, turno: "tarde".into(), ordem: 1, ini: 830, fim: 880 },
        ];
        e.dias = vec![1];
        e.professores[0].max_dia = None;
        e.demandas[0].aulas = 3;
        e.demandas[0].max_dia = 3;
        // Turma normal da manhã: só 2 faixas → 1 pendente.
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 2);
        // Integrado: termina às 14:40 → usa as 2 da manhã + 13:00–13:50 e 13:50–14:40.
        e.turmas[0].fim_max = Some(880);
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 3, "{:?}", r.pendencias);
        // Limite 13:50 → só a primeira da tarde entra.
        e.turmas[0].fim_max = Some(830);
        e.demandas[0].aulas = 4;
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 3);
        assert!(!r.alocacoes.iter().any(|a| a.horario_id == 103));
        // Termina cedo (07:50): só a primeira faixa da manhã.
        e.turmas[0].fim_max = Some(470);
        assert_eq!(gerar(&e).alocacoes.len(), 1);
    }

    #[test]
    fn grades_sobrepostas_nao_duplicam_professor_nem_sala() {
        let mut e = base(1);
        // Grade 1: 07:00–07:50. Grade 2: 07:30–08:20 (sobrepõe) e 08:20–09:10 (livre).
        e.faixas = vec![
            Faixa { grade_id: 1, id: 100, turno: "manha".into(), ordem: 0, ini: 420, fim: 470 },
            Faixa { grade_id: 2, id: 200, turno: "manha".into(), ordem: 0, ini: 450, fim: 500 },
            Faixa { grade_id: 2, id: 201, turno: "manha".into(), ordem: 1, ini: 500, fim: 550 },
        ];
        e.dias = vec![1];
        e.turmas = vec![
            TurmaE { grade_id: 1, id: 1, turno: "manha".into(), alunos: 30, fim_max: None },
            TurmaE { grade_id: 2, id: 2, turno: "manha".into(), alunos: 30, fim_max: None },
        ];
        e.salas[0].id = 1;
        e.demandas = vec![
            DemandaE { turma_id: 1, materia_id: 1, aulas: 1, professor_id: Some(1), sala_id: Some(1), max_dia: 1 },
            DemandaE { turma_id: 2, materia_id: 1, aulas: 1, professor_id: Some(1), sala_id: Some(1), max_dia: 1 },
        ];
        let r = gerar(&e);
        assert_eq!(r.alocacoes.len(), 2, "{:?}", r.pendencias);
        let t2 = r.alocacoes.iter().find(|a| a.turma_id == 2).unwrap();
        let t1 = r.alocacoes.iter().find(|a| a.turma_id == 1).unwrap();
        assert_eq!(t1.horario_id, 100);
        // A turma da grade 2 não pode usar 07:30–08:20 (o professor e a sala estão ocupados às 07:00–07:50).
        assert_eq!(t2.horario_id, 201);
    }
}

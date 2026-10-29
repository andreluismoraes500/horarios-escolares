# Horários Escolares

Aplicativo desktop (Tauri v2 + React + TypeScript + Rust + SQLite) para gerenciar horários de várias escolas, com controle de acesso, backup criptografado e relatórios.

## Principais recursos

- **Multi-escola**: seletor de escola ativa no topo; todos os dados têm `escola_id`.
- **Horários flexíveis**: a 1ª aula pode começar em qualquer horário (07:10, 07:30, 09:15…), com **duração configurável** (ex.: 50 min) e **intervalos** (ex.: 15 min após a 3ª aula). Exemplo: `1ª 07:00–07:50`, `2ª 07:50–08:40`… Tela **Horários e intervalos** com gerador e prévia; também é possível editar faixas manualmente (horários guardados em minutos).
- **Turnos (manhã, tarde, noite)**: cada turno tem seus próprios horários e intervalos; uma escola pode ter os três. Cada turma pertence a um turno e só enxerga/usa os horários dele (o sistema impede aulas de uma turma da manhã num horário da tarde). Professores e salas podem atuar em vários turnos.
- **Grade semanal** por turma, professor ou sala, com arrastar e soltar (soltar sobre outra aula troca as duas), cores por matéria e feedback imediato de conflito.
- **Jornada própria da turma**: em *Turmas*, o campo **Termina às** permite que uma turma use mais (ou menos) tempo que o turno. Ex.: o turno da manhã vai das 07:00 às 12:30, mas o Integrado de Informática vai até 14:30 — informe `14:30` nessa turma e ela passa a usar também as faixas seguintes (da tarde). Vale na grade, na validação, no gerador e na capacidade.
- **Grades de horário (várias jornadas na mesma escola)**: em *Horários e intervalos*, crie grades (ex.: "Integrado" 07:00–14:30 e "Enfermagem" a partir das 13:00), cada uma com suas faixas — faixas de grades diferentes **podem se sobrepor** no relógio. Escolha a grade de cada turma em *Turmas*. Professor e sala nunca ficam em dois lugares ao mesmo tempo: os conflitos e o gerador automático comparam o horário real (sobreposição), mesmo entre grades. Na disponibilidade do professor, cada grade é marcada separadamente (ex.: indisponível na grade Padrão, mas disponível na Integral), com um botão "Marcar toda a grade". Bancos antigos recebem a grade "Padrão" automaticamente.
- **Exclusão em lote de faixas**: em *Horários e intervalos*, marque as faixas (por linha, por turno ou todas) e use *Excluir selecionadas*.
- **Disponibilidade do professor com sábado**: a grade de disponibilidade inclui a coluna *Sáb*; marque só os horários em que ele pode (ou não) naquele dia.
- **Logo da escola**: em *Escolas*, clique no ícone da coluna Logo (ou em Editar → *Adicionar logo*). A logo aparece no menu lateral e no cabeçalho do PDF dos relatórios.
- **Regras de trabalho do professor** (em *Professores*): máximo de aulas por semana e por dia, **deslocamento** (minutos necessários antes/depois de um período marcado como indisponível, ex.: quando ele dá aula em outro lugar), **interstício** (descanso mínimo em horas entre o fim de um dia e o início do seguinte, ex.: 11 h) e se **dá aula aos sábados**. O gerador automático respeita todas essas regras; na grade manual elas aparecem como aviso (não bloqueiam).
- **Cadastro do professor**: disciplinas são adicionadas por um campo de busca (com etiquetas removíveis) e a disponibilidade é uma grade clicável (dia × horário, com todas as grades de horário); clicar no dia ou no horário marca tudo de uma vez. No PDF, turmas divididas em grupos saem com um bloco colorido por grupo.
- **Cor do professor**: cada professor tem uma cor (paleta automática, editável em *Professores*). Na grade, o botão *Cor: matéria / professor* alterna o que colore os cartões; a cor aparece também nas listas e seletores.
- **Seletores com pesquisa**: escola, turma, professor, sala, matéria e grupo têm busca (digite para filtrar, sem diferenciar acentos/maiúsculas; setas + Enter escolhem).
- **Gerador automático da grade** (menu *Gerador automático*): por turma, informe quantas aulas por semana tem de cada matéria (o professor pode ser fixo ou escolhido pelo sistema entre os que dão a matéria; a sala pode ser fixa, ex.: laboratório). O gerador respeita a **disponibilidade dos professores**, evita conflitos de sala/professor/turma, espalha a matéria pela semana (aulas geminadas quando há mais de uma no dia), mantém a grade compacta e tenta reorganizar aulas já colocadas para encaixar as que sobram. Mostra uma **prévia** com o que não coube e o motivo; *Preencher o que falta* mantém as aulas já montadas, *Refazer do zero* substitui as das turmas escolhidas. Depois é só ajustar arrastando na grade.
- **Turma dividida em grupos**: em *Turmas* → editar, crie grupos (ex.: Grupo 1 e Grupo 2). Na grade, cada grupo pode ter uma aula diferente no mesmo horário (um na sala, outro no laboratório, e vice-versa). Grupos diferentes não conflitam; turma inteira conflita com qualquer grupo.
- **Aulas conjuntas**: no formulário da aula, *Juntar outra turma* coloca várias turmas (ou grupos) numa mesma aula/professor/sala. A aula aparece na grade de todas as turmas envolvidas e ocupa o horário delas.
- **Conflitos bloqueados** (sala, professor e turma/grupo no mesmo dia/horário) no frontend e no backend; sala e professor também por índices únicos no SQLite. Aula livre (sem professor/matéria/sala) é permitida. Professor indisponível gera aviso.
- **RBAC**: Super Admin, Admin da escola, Coordenador (cadastra/edita, só exclui aulas da grade), Professor (só a própria grade) e Visualizador. Toda ação é validada no backend.
- **Segurança**: senhas com Argon2id, sessão persistente por token (só o hash SHA-256 fica no banco), queries parametrizadas, log de auditoria.
- **Backup**: exportar/importar `.bak` criptografado (AES-256-GCM, chave via Argon2id), snapshot pré-restauração, backup automático diário/semanal e log de backups.
- **Relatórios**: PDF, CSV (abre no Excel) e impressão direta. Tema claro/escuro, interface em português.

## Requisitos

- Node 20+ e pnpm
- Rust estável (rustup)
- Dependências do Tauri v2 para o seu sistema: <https://v2.tauri.app/start/prerequisites/>
  (Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev`)

## Instalação e uso

```bash
pnpm install   # ou: npm install
pnpm tauri dev        # ou: npm run tauri dev
pnpm tauri build      # ou: npm run tauri build — gera o instalador em src-tauri/target/release/bundle
```

Na primeira execução as migrations são aplicadas automaticamente e é criado o seed:

- Usuário: **admin@admin.com** / **admin123** (Super Admin — troque a senha!)
- Escola demo com horários 07:00, aulas de 50 min e intervalo de 15 min após a 3ª aula.

O banco fica na pasta de dados do app (`horarios.db`).

## Como usar (resumo)

1. **Escolas** → crie a escola. 2. **Horários e intervalos** → escolha o turno, informe início, duração, quantidade de aulas e intervalos → *Gerar*.
3. Cadastre **Matérias, Professores, Salas, Turmas**. 4. Monte a **Grade semanal**: clique numa célula vazia para criar, arraste para mover/trocar.
5. **Relatórios** para PDF/CSV/impressão. 6. **Usuários** para criar contas (Admin da escola só gerencia a própria escola).

## Backup e restauração

- **Exportar**: Backups → *Exportar backup* → defina uma senha → escolha o local. **Guarde a senha**: sem ela o arquivo não abre.
- **Importar**: Backups → *Importar backup* → escolha o `.bak`, informe a senha e mantenha marcado o *snapshot de segurança* (salvo na pasta de backups). Os dados atuais são substituídos e é preciso entrar novamente.
- **Automático**: defina frequência, pasta e senha. O app verifica a cada 5 minutos se há backup vencido; mantém os 15 mais recentes.
- O histórico de backups e a auditoria desta instalação são preservados ao restaurar.

## Testes

```bash
cd src-tauri && cargo test
```

Cobrem o gerador automático (disponibilidade, conflitos, pendências), grupos e aulas conjuntas, migrações, geração de horários (duração, intervalos, inícios como 07:10/09:15), conflitos de sala/professor/turma, índices únicos do banco, login/permissões e backup (cifra, restauração, senha errada, arquivo inválido).

## Estrutura

```
src-tauri/src/{db,commands,auth,backup}   backend Rust
src-tauri/migrations/                      SQL
src/{pages,components,stores,lib,types}    frontend
```

## Gerador e Grade semanal — atalhos para escolas grandes

- **Gerador automático**: pesquise a matéria no campo "Adicionar matéria" para incluí-la na turma; marque uma, várias ou "Selecionar todas" e use *Excluir selecionadas* (ou a lixeira da linha). "Copiar para outras turmas" continua disponível. Clique em *Salvar* para gravar.
- **Grade semanal – arrastar**: em turma dividida em grupos, o arrasto leva *todas* as aulas do bloco juntas. Em *Copiar*, o bloco é duplicado no novo horário; com **Alternar grupos** marcado, matéria/professor/sala giram entre os grupos (A:mat 1 / B:mat 2 → A:mat 2 / B:mat 1) e a cada nova cópia a ordem inverte de novo.
- **Limpar turma/professor/sala** (aulas da seleção) e **Limpar grade** (todas as aulas da escola), ambos com confirmação.

## Atualizações pelo GitHub (aviso dentro do app)

O app consulta o GitHub ao abrir (e pelo botão **Verificar atualizações** no rodapé do menu). Se houver versão nova, aparece um aviso com as novidades e o botão **Atualizar agora**; o usuário decide. **Os dados são mantidos**: o banco fica na pasta de dados do usuário (fora da pasta de instalação), as migrações de banco rodam sozinhas ao abrir a versão nova e, antes de instalar, o app salva uma cópia (`backups/pre-atualizacao-*.db`, últimas 5).

### Configuração (uma única vez)
1. Crie o repositório no GitHub e envie o projeto (`git init`, `git add .`, `git commit`, `git remote add origin …`, `git push`).
2. Gere o par de chaves de assinatura: `npx tauri signer generate -w ~/.tauri/horarios.key` (guarde a chave privada e a senha; **não perca**, senão os usuários não conseguem mais atualizar).
3. Em `src-tauri/tauri.conf.json`, em `plugins.updater`, troque `pubkey` pelo conteúdo do arquivo `~/.tauri/horarios.key.pub` e `endpoints` por `https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/latest/download/latest.json`.
4. No GitHub: *Settings → Secrets and variables → Actions* → crie `TAURI_SIGNING_PRIVATE_KEY` (conteúdo da chave privada) e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (a senha). Em *Settings → Actions → General → Workflow permissions* marque **Read and write**.
5. Se o repositório for **privado**, o app não consegue baixar sem login; use repositório público (ou hospede os arquivos em outro lugar público).

### Publicar uma nova versão
1. Aumente o número da versão nos 3 lugares: `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` (ex.: 1.0.0 → 1.1.0).
2. `git commit -am "Versão 1.1.0"`, `git tag v1.1.0`, `git push --tags`.
3. O workflow `.github/workflows/release.yml` gera os instaladores e o `latest.json` na aba *Releases*. Quem estiver com a versão anterior recebe o aviso na próxima abertura. O texto da release vira as "novidades" do aviso.

> Regra de ouro para não perder dados: nunca altere migrações antigas (`src-tauri/migrations/00X_*.sql`); mudanças de banco entram sempre como uma migração nova.

## Seleção em lote e Auditoria
- **Matérias, Salas, Professores e Turmas**: caixa em cada linha, caixa "selecionar todos" no cabeçalho (vale para o que está filtrado) e botão *Excluir selecionados*; a lixeira da linha continua excluindo um a um.
- **Auditoria**: atalhos Hoje/Ontem/7/30 dias, intervalo de datas, filtros por usuário, ação e tela, pesquisa no detalhe, registros agrupados por dia e exportação em CSV.

## Relatórios: imprimir tudo
Marque **Todas as turmas/professores/salas** para gerar, em um único PDF/CSV ou na impressão (**Imprimir tudo**), uma grade por página.

## Lista de presença e feriados
Menu **Lista de presença**: folha de assinatura **mensal** (uma por professor, com horários/turmas de cada dia) ou **semanal** (todos os professores), com PDF e impressão. Feriados nacionais são calculados automaticamente (inclusive Carnaval, Sexta-feira Santa e Corpus Christi); na aba **Feriados e recessos** você cadastra feriados locais, recessos e datas especiais por **intervalo de datas**, com tipo (Dia do Professor, recesso, ponto facultativo, evento, dia letivo extra) e a opção de **bloquear a assinatura**. Nos dias bloqueados a folha sai sombreada e sem campo de assinatura; cadastros da escola têm prioridade sobre os nacionais (ex.: “Dia letivo extra” libera um feriado ou sábado).

## Lista de presença por período e coordenadores

- A assinatura é **por período** (Manhã / Tarde / Noite): quem veio de manhã e faltou à noite fica só com a linha da noite em branco.
- **Coordenadores** (menu *Coordenadores*): cadastre as turmas que coordenam (as matérias aparecem automaticamente) e o **expediente** por dia, com vários períodos e atalhos (Manhã, Tarde, Noite).
- Na lista de presença, o botão *Professores/Coordenadores* alterna o tipo de folha; nas folhas dos professores a coluna **Visto do coordenador** mostra o nome de quem coordena as turmas do período.
- Prévia, Imprimir e PDF usam a mesma folha (mesmas larguras e cores). Se o navegador ainda mostrar cabeçalho/rodapé, desmarque "Cabeçalhos e rodapés" na janela de impressão.

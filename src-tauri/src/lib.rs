//! Aplicativo desktop de gerenciamento de horários escolares (Tauri v2).

pub mod auth;
pub mod backup;
pub mod commands;
pub mod db;
pub mod error;

use commands::{arquivos, autogerar, auth as cmd_auth, backup as cmd_backup, cadastros, escolas, horarios, usuarios, AppState};
use std::time::Duration;
use tauri::Manager;

/// Cópia de segurança simples do banco, feita automaticamente antes de instalar uma atualização.
/// Fica em <pasta de dados>/backups/pre-atualizacao-AAAAMMDD-HHMMSS.db (mantém as 5 mais recentes).
#[tauri::command]
fn copia_pre_atualizacao(state: tauri::State<AppState>) -> Result<String, String> {
    let dir = backup::pasta_padrao(&state.data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let destino = dir.join(format!("pre-atualizacao-{}.db", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    state
        .db
        .conn()
        .execute("VACUUM INTO ?1", [destino.to_string_lossy().to_string()])
        .map_err(|e| e.to_string())?;
    let mut antigas: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("pre-atualizacao-"))
        .collect();
    antigas.sort_by_key(|e| e.file_name());
    while antigas.len() > 5 {
        let _ = std::fs::remove_file(antigas.remove(0).path());
    }
    Ok(destino.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Pasta de dados do app (banco, backups automáticos, temporários).
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // Abre o banco; migrations e seed rodam automaticamente na primeira execução.
            let conn = db::abrir(&data_dir.join("horarios.db"))
                .map_err(|e| format!("Falha ao abrir o banco de dados: {e}"))?;
            app.manage(AppState { db: db::Db::new(conn), data_dir: data_dir.clone() });

            // Agendador de backup automático: verifica a cada 5 minutos se há backup vencido.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(20));
                let estado = handle.state::<AppState>();
                backup::executar_agendado(&estado.db, &estado.data_dir);
                std::thread::sleep(Duration::from_secs(280));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            copia_pre_atualizacao,
            cmd_auth::login,
            cmd_auth::logout,
            cmd_auth::sessao_atual,
            cmd_auth::alterar_minha_senha,
            cmd_auth::minhas_permissoes,
            escolas::listar_escolas,
            escolas::criar_escola,
            escolas::atualizar_escola,
            escolas::excluir_escola,
            usuarios::listar_usuarios,
            usuarios::criar_usuario,
            usuarios::atualizar_usuario,
            usuarios::excluir_usuario,
            usuarios::listar_auditoria,
            cadastros::listar_professores,
            cadastros::criar_professor,
            cadastros::atualizar_professor,
            cadastros::excluir_professor,
            cadastros::listar_materias,
            cadastros::criar_materia,
            cadastros::atualizar_materia,
            cadastros::excluir_materia,
            cadastros::listar_salas,
            cadastros::criar_sala,
            cadastros::atualizar_sala,
            cadastros::excluir_sala,
            cadastros::listar_turmas,
            cadastros::criar_turma,
            cadastros::atualizar_turma,
            cadastros::excluir_turma,
            cadastros::listar_grupos,
            cadastros::criar_grupo,
            cadastros::atualizar_grupo,
            cadastros::excluir_grupo,
            autogerar::listar_demandas,
            autogerar::salvar_demanda,
            autogerar::excluir_demanda,
            autogerar::copiar_demandas,
            autogerar::gerar_grade_auto,
            horarios::listar_horarios,
            horarios::gerar_horarios,
            horarios::criar_horario,
            horarios::atualizar_horario,
            horarios::excluir_horario,
            horarios::excluir_horarios,
            horarios::listar_grades,
            horarios::criar_grade,
            horarios::renomear_grade,
            horarios::excluir_grade,
            horarios::listar_aulas,
            horarios::verificar_aula,
            horarios::criar_aula,
            horarios::atualizar_aula,
            horarios::mover_aula,
            horarios::trocar_aulas,
            horarios::excluir_aula,
            horarios::mover_aulas,
            horarios::copiar_aulas,
            horarios::excluir_aulas,
            horarios::limpar_grade,
            horarios::obter_resumo,
            cmd_backup::exportar_backup,
            cmd_backup::importar_backup,
            cmd_backup::listar_backups,
            cmd_backup::obter_config_backup,
            cmd_backup::salvar_config_backup,
            arquivos::salvar_arquivo,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o aplicativo Tauri");
}

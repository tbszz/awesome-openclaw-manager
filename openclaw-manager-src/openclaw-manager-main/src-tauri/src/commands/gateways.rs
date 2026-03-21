use crate::models::{
    BridgeStatus, ControlCenterStatus, CreateManagedGatewayRequest, CreateManagedGatewayResponse,
    GatewayConfigDigest, GatewayHealthDigest, GatewayLogResponse, GatewayServiceRuntime,
    GatewaySummary, ManagedGatewayChannelDraft, ManagerState, NativeWorkbenchData,
    WorkbenchFileContent, WorkbenchFileEntry,
};
use chrono::{DateTime, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_WSL_DISTRO: &str = "Ubuntu";
const MANIFEST_WSL_PATH: &str = "/root/.openclaw-manager/gateways.json";
const HEALTH_WSL_PATH: &str = "/root/.openclaw-manager/gateway-health.json";
const CONTROL_CENTER_DYNAMIC_PORT_START: u16 = 4320;
const GATEWAY_PORT_START: u16 = 18790;
const DEFAULT_PRIMARY_MODEL: &str = "kimi-coding/k2p5";
const DEFAULT_FALLBACK_MODELS: [&str; 2] = ["moonshot/kimi-k2.5", "moonshot/kimi-k2-thinking"];
const OPENCLAW_VERSION_TAG: &str = "2026.3.13";
const OPENCLAW_ENTRYPOINT: &str = "/usr/lib/node_modules/openclaw/dist/index.js";
const DEFAULT_PATH: &str = "/root/.nvm/versions/node/v22.22.0/bin:/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.volta/bin:/root/.asdf/shims:/root/.bun/bin:/root/.nvm/current/bin:/root/.fnm/current/bin:/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayManifest {
    generated_at: Option<String>,
    gateways: Vec<ManifestGateway>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestGateway {
    id: String,
    label: String,
    profile: Option<String>,
    service_name: String,
    state_dir: String,
    workspace_dir: String,
    port: u16,
    browser_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HealthEntry {
    id: String,
    service_active: Option<String>,
    service_exit_code: Option<i32>,
    listener_exit_code: Option<i32>,
}

#[command]
pub async fn bootstrap_manager_runtime() -> Result<ManagerState, String> {
    let manifest = load_gateway_manifest()?;
    let required_ports: Vec<u16> = manifest
        .gateways
        .iter()
        .map(|gateway| gateway.port)
        .collect();
    let _ = ensure_bridge_ports(&required_ports);
    build_manager_state(&manifest)
}

#[command]
pub async fn get_manager_state() -> Result<ManagerState, String> {
    let manifest = load_gateway_manifest()?;
    build_manager_state(&manifest)
}

#[command]
pub async fn create_managed_gateway(
    request: CreateManagedGatewayRequest,
) -> Result<CreateManagedGatewayResponse, String> {
    let mut manifest = load_gateway_manifest_or_default()?;
    let gateway_id = resolve_gateway_id(request.gateway_id.as_deref(), &request.label)?;
    if manifest
        .gateways
        .iter()
        .any(|gateway| gateway.id == gateway_id)
    {
        return Err(format!("Gateway id '{}' already exists.", gateway_id));
    }

    let profile = resolve_profile_name(request.profile.as_deref(), &gateway_id)?;
    if manifest
        .gateways
        .iter()
        .filter_map(|gateway| gateway.profile.as_ref())
        .any(|existing| existing == &profile)
    {
        return Err(format!("Profile '{}' already exists.", profile));
    }

    let port = resolve_gateway_port(&manifest, request.port)?;
    let service_name = build_service_name(&gateway_id);
    let state_dir = format!("/root/.openclaw-{}", gateway_id);
    let workspace_dir = format!("{}/workspace", state_dir);
    let inherit_source =
        select_env_source_gateway(&manifest, request.inherit_env_from.as_deref())?.cloned();
    let provisioned_channels = materialize_channel_configs(&request.channels)?;
    let primary_model = normalize_model_id(request.primary_model.as_deref())
        .unwrap_or_else(|| DEFAULT_PRIMARY_MODEL.to_string());
    let fallback_models = normalize_model_list(&request.fallback_models);
    let browser_profile = normalize_optional_string(request.browser_profile.as_deref());
    let auth_token = generate_hex_token(24);

    let new_gateway = ManifestGateway {
        id: gateway_id.clone(),
        label: request.label.trim().to_string(),
        profile: Some(profile.clone()),
        service_name: service_name.clone(),
        state_dir: state_dir.clone(),
        workspace_dir: workspace_dir.clone(),
        port,
        browser_profile: browser_profile.clone(),
    };

    ensure_gateway_state_dir(&state_dir)?;
    ensure_gateway_workspace(&workspace_dir, &request.label)?;
    copy_gateway_env_files(inherit_source.as_ref(), &state_dir)?;
    write_gateway_config(
        &state_dir,
        &workspace_dir,
        &primary_model,
        &fallback_models,
        &provisioned_channels,
        request.memory_search_enabled,
        port,
        &auth_token,
    )?;
    write_gateway_service_unit(&new_gateway, &auth_token)?;
    copy_gateway_service_drop_in(inherit_source.as_ref(), &service_name)?;
    validate_gateway_profile(&state_dir, &profile)?;

    manifest.generated_at = Some(current_offset_timestamp());
    manifest.gateways.push(new_gateway.clone());
    save_gateway_manifest(&manifest)?;

    run_wsl_command(&["systemctl", "--user", "daemon-reload"])?;
    run_wsl_command(&[
        "systemctl",
        "--user",
        "enable",
        "--now",
        new_gateway.service_name.as_str(),
    ])?;
    wait_for_gateway_state(port, "start")?;

    upsert_health_entry_json(
        &new_gateway.id,
        new_gateway.port,
        &new_gateway.service_name,
        "active",
        Some(0),
        Some(0),
        Some("LISTEN".to_string()),
    )?;

    let required_ports = manifest
        .gateways
        .iter()
        .map(|gateway| gateway.port)
        .collect::<Vec<_>>();
    let _ = ensure_bridge_ports(&required_ports);

    let notes = vec![
        format!(
            "Inherited runtime env from {}.",
            inherit_source
                .as_ref()
                .map(|gateway| gateway.label.as_str())
                .unwrap_or("an empty env file")
        ),
        "Launcher wiring now follows the managed gateway manifest dynamically.".to_string(),
    ];

    Ok(CreateManagedGatewayResponse {
        gateway_id: gateway_id.clone(),
        label: request.label.trim().to_string(),
        profile,
        service_name,
        state_dir,
        workspace_dir,
        port,
        control_center_port: preferred_control_center_port(&manifest, &gateway_id),
        notes,
    })
}

#[command]
pub async fn perform_gateway_action(gateway_id: String, action: String) -> Result<String, String> {
    let manifest = load_gateway_manifest()?;
    let gateway = find_gateway(&manifest, &gateway_id)?;
    let normalized_action = action.trim().to_lowercase();

    match normalized_action.as_str() {
        "start" | "stop" | "restart" => {
            info!(
                "[Gateways] action={} gateway={} service={}",
                normalized_action, gateway.id, gateway.service_name
            );
            run_wsl_command(&[
                "systemctl",
                "--user",
                &normalized_action,
                gateway.service_name.as_str(),
            ])?;

            wait_for_gateway_state(gateway.port, normalized_action.as_str())?;
            Ok(format!("{} {}", normalized_action, gateway.label))
        }
        _ => Err(format!(
            "Unsupported gateway action '{}'. Expected one of: start, stop, restart.",
            action
        )),
    }
}

#[command]
pub async fn get_gateway_logs(
    gateway_id: String,
    lines: Option<u32>,
) -> Result<GatewayLogResponse, String> {
    let manifest = load_gateway_manifest()?;
    let gateway = find_gateway(&manifest, &gateway_id)?;
    let requested = lines.unwrap_or(120).clamp(20, 500) as usize;
    let mut merged = read_gateway_log_files(gateway, requested);
    let journal_lines = read_gateway_journal(gateway, requested);

    if !journal_lines.is_empty() {
        merged.extend(journal_lines);
    }

    merged = normalize_log_lines(merged, requested);

    Ok(GatewayLogResponse {
        gateway_id: gateway.id.clone(),
        lines: merged,
    })
}

#[command]
pub async fn ensure_control_center(gateway_id: String) -> Result<ControlCenterStatus, String> {
    let manifest = load_gateway_manifest()?;
    let gateway = find_gateway(&manifest, &gateway_id)?;
    let ui_port = preferred_control_center_port(&manifest, &gateway.id);
    let _ = ensure_bridge_ports(&[gateway.port]);

    let repo_path = find_control_center_repo();
    let runtime_dir = control_center_runtime_dir(&gateway.id);
    let runtime_dir_string = runtime_dir.display().to_string();
    let (stdout_log_path, stderr_log_path) = control_center_log_paths(&gateway.id);
    let diagnostics = control_center_diagnostics(
        &gateway,
        ui_port,
        &runtime_dir,
        &stdout_log_path,
        &stderr_log_path,
    );
    let status = build_control_center_status(
        ui_port,
        repo_path.as_ref(),
        Some(runtime_dir_string.clone()),
    );
    if status.ready {
        return Ok(status);
    }

    let repo_path = repo_path.ok_or_else(|| {
        format!(
            "OpenClaw Control Center repo was not found. Expected OPENCLAW_CONTROL_CENTER_PATH or a local openclaw-control-center checkout. {}",
            diagnostics
        )
    })?;

    if is_local_port_open(status.ui_port) && !status.ready {
        return Err(format!(
            "Control Center port {} is occupied by another process and is not responding as a control center. {}",
            status.ui_port, diagnostics
        ));
    }

    spawn_control_center_process(&gateway, &repo_path, &runtime_dir, status.ui_port)?;

    wait_for_control_center(
        &gateway,
        status.ui_port,
        &runtime_dir,
        &stdout_log_path,
        &stderr_log_path,
        Duration::from_secs(25),
    )?;

    Ok(build_control_center_status(
        ui_port,
        Some(&repo_path),
        Some(runtime_dir_string),
    ))
}

#[command]
pub async fn get_native_workbench_data(gateway_id: String) -> Result<NativeWorkbenchData, String> {
    let manifest = load_gateway_manifest()?;
    let gateway = find_gateway(&manifest, &gateway_id)?;
    let ui_port = preferred_control_center_port(&manifest, &gateway.id);
    let repo_path = find_control_center_repo();
    let runtime_dir = control_center_runtime_dir(&gateway.id)
        .display()
        .to_string();
    let status = build_control_center_status(ui_port, repo_path.as_ref(), Some(runtime_dir));
    let docs = collect_workbench_files(gateway, "docs");
    let memory = collect_workbench_files(gateway, "memory");
    let mut warnings = Vec::new();

    if !status.ready {
        warnings.push(
            "Control Center runtime is not ready yet. Start it once to unlock live workbench data."
                .to_string(),
        );
        return Ok(NativeWorkbenchData {
            gateway_id: gateway.id.clone(),
            fetched_at: Utc::now().to_rfc3339(),
            ready: false,
            launchable: status.launchable,
            ui_port: status.ui_port,
            base_url: status.base_url,
            warnings,
            snapshot: None,
            usage: None,
            queue: None,
            projects: None,
            tasks: None,
            sessions: None,
            health: None,
            docs,
            memory,
        });
    }

    let snapshot = fetch_control_center_json(ui_port, "/snapshot", &mut warnings);
    let usage = fetch_control_center_json(ui_port, "/api/usage-cost", &mut warnings);
    let queue = fetch_control_center_json(ui_port, "/api/action-queue", &mut warnings);
    let projects = fetch_control_center_json(ui_port, "/api/projects", &mut warnings);
    let tasks = fetch_control_center_json(ui_port, "/api/tasks", &mut warnings);
    let sessions =
        fetch_control_center_json(ui_port, "/api/sessions?historyLimit=20", &mut warnings);
    let health = fetch_control_center_json(ui_port, "/healthz", &mut warnings);

    Ok(NativeWorkbenchData {
        gateway_id: gateway.id.clone(),
        fetched_at: Utc::now().to_rfc3339(),
        ready: true,
        launchable: status.launchable,
        ui_port: status.ui_port,
        base_url: status.base_url,
        warnings,
        snapshot,
        usage,
        queue,
        projects,
        tasks,
        sessions,
        health,
        docs,
        memory,
    })
}

#[command]
pub async fn get_workbench_file_content(
    gateway_id: String,
    scope: String,
    path: String,
) -> Result<WorkbenchFileContent, String> {
    let manifest = load_gateway_manifest()?;
    let gateway = find_gateway(&manifest, &gateway_id)?;
    let normalized_scope = normalize_workbench_scope(&scope)
        .ok_or_else(|| format!("Unsupported workbench scope '{}'.", scope))?;
    let files = collect_workbench_files(gateway, normalized_scope);
    let entry = files
        .into_iter()
        .find(|item| item.path == path)
        .ok_or_else(|| format!("Unknown {} file '{}'.", normalized_scope, path))?;
    let file_path = resolve_workbench_file_path(gateway, normalized_scope, &entry.path)
        .ok_or_else(|| {
            format!(
                "Could not resolve {} file '{}'.",
                normalized_scope, entry.path
            )
        })?;
    let content = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read {} file '{}': {}",
            normalized_scope, entry.path, error
        )
    })?;

    Ok(WorkbenchFileContent {
        gateway_id: gateway.id.clone(),
        scope: normalized_scope.to_string(),
        path: entry.path,
        content,
        updated_at: entry.updated_at,
    })
}

fn build_manager_state(manifest: &GatewayManifest) -> Result<ManagerState, String> {
    let health_map = load_health_map();
    let repo_path = find_control_center_repo();
    let repo_display = repo_path.as_ref().map(|path| path.display().to_string());
    let distro = wsl_distro();
    let ports: Vec<u16> = manifest
        .gateways
        .iter()
        .map(|gateway| gateway.port)
        .collect();
    let control_center_ports = build_control_center_port_map(manifest);

    let gateways = manifest
        .gateways
        .iter()
        .map(|gateway| {
            let ui_port = control_center_ports
                .get(&gateway.id)
                .copied()
                .unwrap_or_else(|| preferred_control_center_port(manifest, &gateway.id));
            let service = read_gateway_service_runtime(gateway);
            let config = read_gateway_config(gateway);
            let health = health_map.get(&gateway.id).cloned().unwrap_or_default();
            let runtime_dir = control_center_runtime_dir(&gateway.id)
                .display()
                .to_string();
            let control_center =
                build_control_center_status(ui_port, repo_path.as_ref(), Some(runtime_dir.clone()));

            let mut issues = Vec::new();
            if service.active_state != "active" {
                issues.push("Gateway service is not active.".to_string());
            }
            if !service.port_listening {
                issues.push("Gateway port is not listening.".to_string());
            }
            if !control_center.launchable {
                issues.push("Control Center repo was not found locally.".to_string());
            }
            if config.channels.is_empty() {
                issues.push("No message channels are configured.".to_string());
            }
            issues.extend(config.notes.clone());

            GatewaySummary {
                id: gateway.id.clone(),
                label: gateway.label.clone(),
                profile: gateway.profile.clone(),
                service_name: gateway.service_name.clone(),
                state_dir: gateway.state_dir.clone(),
                workspace_dir: gateway.workspace_dir.clone(),
                port: gateway.port,
                browser_profile: gateway.browser_profile.clone(),
                service,
                config,
                health: GatewayHealthDigest {
                    service_active: health.service_active,
                    service_exit_code: health.service_exit_code,
                    listener_exit_code: health.listener_exit_code,
                },
                control_center,
                issues,
            }
        })
        .collect();

    Ok(ManagerState {
        generated_at: manifest.generated_at.clone(),
        distro,
        bridge: bridge_status(&ports),
        control_center_repo: repo_display,
        openclaw_version: read_openclaw_version(),
        gateways,
    })
}

fn load_gateway_manifest() -> Result<GatewayManifest, String> {
    let raw = fs::read_to_string(wsl_path_to_unc(MANIFEST_WSL_PATH))
        .map_err(|error| format!("Failed to read managed gateway manifest: {}", error))?;
    serde_json::from_str(sanitize_json_text(&raw))
        .map_err(|error| format!("Failed to parse gateway manifest: {}", error))
}

fn load_gateway_manifest_or_default() -> Result<GatewayManifest, String> {
    let path = wsl_path_to_unc(MANIFEST_WSL_PATH);
    if !path.exists() {
        return Ok(GatewayManifest {
            generated_at: None,
            gateways: Vec::new(),
        });
    }
    load_gateway_manifest()
}

fn save_gateway_manifest(manifest: &GatewayManifest) -> Result<(), String> {
    let path = wsl_path_to_unc(MANIFEST_WSL_PATH);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create manifest directory: {}", error))?;
    }

    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Failed to serialize gateway manifest: {}", error))?;
    fs::write(path, format!("{}\n", content))
        .map_err(|error| format!("Failed to write gateway manifest: {}", error))
}

fn resolve_gateway_id(explicit_id: Option<&str>, label: &str) -> Result<String, String> {
    if let Some(value) = normalize_identifier(explicit_id) {
        return Ok(value);
    }

    normalize_identifier(Some(label)).ok_or_else(|| {
        "Gateway name must contain at least one letter or number so an id can be generated."
            .to_string()
    })
}

fn resolve_profile_name(
    explicit_profile: Option<&str>,
    gateway_id: &str,
) -> Result<String, String> {
    if let Some(value) = normalize_identifier(explicit_profile) {
        return Ok(value);
    }
    Ok(gateway_id.to_string())
}

fn resolve_gateway_port(manifest: &GatewayManifest, requested: Option<u16>) -> Result<u16, String> {
    if let Some(port) = requested {
        validate_gateway_port(manifest, port)?;
        return Ok(port);
    }

    let mut candidate = GATEWAY_PORT_START;
    let used = manifest
        .gateways
        .iter()
        .map(|gateway| gateway.port)
        .collect::<HashSet<_>>();
    while used.contains(&candidate)
        || check_wsl_port_listening(candidate)
        || is_local_port_open(candidate)
    {
        candidate += 1;
    }
    Ok(candidate)
}

fn validate_gateway_port(manifest: &GatewayManifest, port: u16) -> Result<(), String> {
    if manifest.gateways.iter().any(|gateway| gateway.port == port) {
        return Err(format!("Gateway port {} is already managed.", port));
    }
    if check_wsl_port_listening(port) {
        return Err(format!(
            "Gateway port {} is already in use inside WSL.",
            port
        ));
    }
    if is_local_port_open(port) {
        return Err(format!(
            "Gateway port {} is already occupied on Windows and would block the local bridge.",
            port
        ));
    }
    Ok(())
}

fn build_service_name(gateway_id: &str) -> String {
    format!("openclaw-gateway-{}.service", gateway_id)
}

fn select_env_source_gateway<'a>(
    manifest: &'a GatewayManifest,
    requested_gateway_id: Option<&str>,
) -> Result<Option<&'a ManifestGateway>, String> {
    if let Some(requested) = normalize_optional_string(requested_gateway_id) {
        return find_gateway(manifest, &requested).map(Some);
    }

    if let Some(main_gateway) = manifest
        .gateways
        .iter()
        .find(|gateway| gateway.id == "main")
    {
        return Ok(Some(main_gateway));
    }

    Ok(manifest.gateways.first())
}

fn ensure_gateway_state_dir(state_dir: &str) -> Result<(), String> {
    let state_path = wsl_path_to_unc(state_dir);
    fs::create_dir_all(&state_path)
        .map_err(|error| format!("Failed to create gateway state dir: {}", error))
}

fn ensure_gateway_workspace(workspace_dir: &str, label: &str) -> Result<(), String> {
    let workspace_path = wsl_path_to_unc(workspace_dir);
    fs::create_dir_all(workspace_path.join("memory").join(".archive"))
        .map_err(|error| format!("Failed to create workspace scaffold: {}", error))?;
    fs::create_dir_all(workspace_path.join("memory").join("reviews"))
        .map_err(|error| format!("Failed to create workspace scaffold: {}", error))?;

    let files = vec![
        (
            "AGENTS.md".to_string(),
            "# AGENTS.md\n\nRead SOUL.md, USER.md, and the last two daily notes before you start working.\nLoad MEMORY.md only in the main session.\nKeep notes in files before relying on memory.\nDo not expose private data.\n".to_string(),
        ),
        (
            "SOUL.md".to_string(),
            "# SOUL.md\n\nBe direct, useful, and calm.\nPrefer action over filler.\nProtect private data.\nAsk before taking irreversible external actions.\n".to_string(),
        ),
        (
            "IDENTITY.md".to_string(),
            format!(
                "# IDENTITY.md\n\n- Name: {}\n- Role: Managed gateway\n- Emoji: :satellite:\n",
                label.trim()
            ),
        ),
        (
            "USER.md".to_string(),
            "# USER.md\n\n- Name: Zihan\n- What to call them: Zihan\n- Timezone: Asia/Shanghai\n".to_string(),
        ),
        (
            "TOOLS.md".to_string(),
            "# TOOLS.md\n\nLocal notes for this gateway live here.\nAdd environment-specific tool details as they become relevant.\n".to_string(),
        ),
        (
            "HEARTBEAT.md".to_string(),
            "# HEARTBEAT.md\n\nKeep this file empty unless you want explicit periodic checks.\n".to_string(),
        ),
        (
            "NOW.md".to_string(),
            "# NOW.md\n\n## P0\n- Keep this gateway healthy and ready for the next task.\n".to_string(),
        ),
        (
            "MEMORY.md".to_string(),
            "# MEMORY.md\n\nLong-term notes for this gateway.\n".to_string(),
        ),
        (
            "memory/INDEX.md".to_string(),
            "# Memory Index\n\n- Add important notes here as they accumulate.\n".to_string(),
        ),
    ];

    for (relative_path, content) in files {
        let target = workspace_path.join(relative_path.replace('/', "\\"));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create workspace parent dir: {}", error))?;
        }
        if !target.exists() {
            fs::write(&target, content)
                .map_err(|error| format!("Failed to write workspace scaffold file: {}", error))?;
        }
    }

    Ok(())
}

fn copy_gateway_env_files(
    source_gateway: Option<&ManifestGateway>,
    state_dir: &str,
) -> Result<(), String> {
    let target_dir = wsl_path_to_unc(state_dir);
    let env_content = source_gateway
        .and_then(read_gateway_env_content)
        .unwrap_or_default();

    for file_name in ["env", ".env"] {
        fs::write(target_dir.join(file_name), &env_content)
            .map_err(|error| format!("Failed to write {}: {}", file_name, error))?;
    }

    Ok(())
}

fn read_gateway_env_content(gateway: &ManifestGateway) -> Option<String> {
    for relative in ["env", ".env"] {
        let path = wsl_path_to_unc(&wsl_join(&gateway.state_dir, relative));
        if let Ok(content) = fs::read_to_string(path) {
            return Some(content);
        }
    }
    None
}

fn write_gateway_config(
    state_dir: &str,
    workspace_dir: &str,
    primary_model: &str,
    fallback_models: &[String],
    channels: &[(String, Value)],
    memory_search_enabled: bool,
    port: u16,
    auth_token: &str,
) -> Result<(), String> {
    let channel_entries = channels
        .iter()
        .map(|(channel_type, config)| (channel_type.clone(), config.clone()))
        .collect::<serde_json::Map<_, _>>();
    let plugin_entries = channels
        .iter()
        .filter(|(_, config)| {
            config
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .map(|(channel_type, _)| (channel_type.clone(), json!({ "enabled": true })))
        .collect::<serde_json::Map<_, _>>();
    let models = std::iter::once(primary_model.to_string())
        .chain(fallback_models.iter().cloned())
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|model| (model, json!({})))
        .collect::<serde_json::Map<_, _>>();

    let mut config = json!({
        "tools": { "profile": "coding" },
        "meta": {
            "lastTouchedVersion": OPENCLAW_VERSION_TAG,
            "lastTouchedAt": Utc::now().to_rfc3339(),
        },
        "browser": {
            "headless": true,
            "noSandbox": true,
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": primary_model,
                    "fallbacks": fallback_models,
                },
                "models": models,
                "workspace": workspace_dir,
            }
        },
        "session": {
            "dmScope": "per-channel-peer",
        },
        "commands": {
            "native": "auto",
            "nativeSkills": "auto",
            "restart": true,
            "ownerDisplay": "raw",
        },
        "channels": channel_entries,
        "gateway": {
            "port": port,
            "mode": "local",
            "bind": "loopback",
            "auth": {
                "mode": "token",
                "token": auth_token,
            }
        },
        "plugins": {
            "entries": plugin_entries,
        }
    });

    if memory_search_enabled {
        config["agents"]["defaults"]["memorySearch"] = json!({
            "enabled": true,
            "provider": "gemini",
        });
    }

    let path = wsl_path_to_unc(&wsl_join(state_dir, "openclaw.json"));
    let content = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize gateway config: {}", error))?;
    fs::write(path, format!("{}\n", content))
        .map_err(|error| format!("Failed to write gateway config: {}", error))
}

fn write_gateway_service_unit(gateway: &ManifestGateway, auth_token: &str) -> Result<(), String> {
    let service_path = wsl_path_to_unc(&format!(
        "/root/.config/systemd/user/{}",
        gateway.service_name
    ));
    if let Some(parent) = service_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create systemd user dir: {}", error))?;
    }

    let profile_segment = gateway
        .profile
        .as_ref()
        .map(|profile| format!(" --profile {}", profile))
        .unwrap_or_default();
    let content = format!(
        "[Unit]\nDescription={} (OpenClaw {})\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nExecStart=/usr/bin/node {}{} gateway --port {} --bind loopback --token {}\nRestart=always\nRestartSec=5\nTimeoutStopSec=30\nTimeoutStartSec=30\nSuccessExitStatus=0 143\nKillMode=control-group\nEnvironment=HOME=/root\nEnvironment=TMPDIR=/tmp\nEnvironment=PATH={}\nEnvironment=OPENCLAW_STATE_DIR={}\nEnvironment=OPENCLAW_CONFIG_PATH={}/openclaw.json\nEnvironment=OPENCLAW_GATEWAY_PORT={}\nEnvironment=OPENCLAW_SYSTEMD_UNIT={}\nEnvironment=OPENCLAW_SERVICE_MARKER={}\nEnvironment=OPENCLAW_SERVICE_KIND=gateway\nEnvironment=OPENCLAW_SERVICE_VERSION={}\n\n[Install]\nWantedBy=default.target\n",
        gateway.label,
        OPENCLAW_VERSION_TAG,
        OPENCLAW_ENTRYPOINT,
        profile_segment,
        gateway.port,
        auth_token,
        DEFAULT_PATH,
        gateway.state_dir,
        gateway.state_dir,
        gateway.port,
        gateway.service_name,
        gateway.id,
        OPENCLAW_VERSION_TAG,
    );

    fs::write(service_path, content)
        .map_err(|error| format!("Failed to write systemd unit: {}", error))
}

fn copy_gateway_service_drop_in(
    source_gateway: Option<&ManifestGateway>,
    target_service_name: &str,
) -> Result<(), String> {
    let Some(source_gateway) = source_gateway else {
        return Ok(());
    };

    let source_path = wsl_path_to_unc(&format!(
        "/root/.config/systemd/user/{}.d/proxy.conf",
        source_gateway.service_name
    ));
    if !source_path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(source_path)
        .map_err(|error| format!("Failed to read source service drop-in: {}", error))?;
    let filtered = raw
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.starts_with("Environment=OPENCLAW_STATE_DIR=")
                && !trimmed.starts_with("Environment=OPENCLAW_CONFIG_PATH=")
        })
        .collect::<Vec<_>>()
        .join("\n");

    let meaningful = filtered
        .lines()
        .any(|line| !line.trim().is_empty() && line.trim() != "[Service]");
    if !meaningful {
        return Ok(());
    }

    let drop_in_dir = wsl_path_to_unc(&format!(
        "/root/.config/systemd/user/{}.d",
        target_service_name
    ));
    fs::create_dir_all(&drop_in_dir)
        .map_err(|error| format!("Failed to create service drop-in dir: {}", error))?;
    fs::write(drop_in_dir.join("proxy.conf"), format!("{}\n", filtered))
        .map_err(|error| format!("Failed to write service drop-in: {}", error))
}

fn validate_gateway_profile(state_dir: &str, profile: &str) -> Result<(), String> {
    let state_dir_q = shell_single_quote(state_dir);
    let config_path_q = shell_single_quote(&format!("{}/openclaw.json", state_dir));
    let profile_q = shell_single_quote(profile);
    let script = format!(
        "OPENCLAW_STATE_DIR={} OPENCLAW_CONFIG_PATH={} openclaw --profile {} config validate",
        state_dir_q, config_path_q, profile_q
    );
    run_wsl_command(&["bash", "-lc", script.as_str()]).map(|_| ())
}

fn materialize_channel_configs(
    drafts: &[ManagedGatewayChannelDraft],
) -> Result<Vec<(String, Value)>, String> {
    if drafts.is_empty() {
        return Err("At least one enabled message channel is required.".to_string());
    }

    let mut seen_types = HashSet::new();
    let mut results = Vec::new();

    for draft in drafts {
        let channel_type = normalize_identifier(Some(&draft.channel_type))
            .ok_or_else(|| format!("Channel type '{}' is invalid.", draft.channel_type))?;
        if !seen_types.insert(channel_type.clone()) {
            return Err(format!(
                "Channel type '{}' can only be configured once per gateway.",
                channel_type
            ));
        }

        let object = draft
            .config
            .as_object()
            .ok_or_else(|| format!("Channel '{}' must use an object config.", channel_type))?;
        let mut config = object
            .iter()
            .filter_map(|(key, value)| {
                normalize_config_value(value).map(|value| (key.clone(), value))
            })
            .collect::<serde_json::Map<_, _>>();
        config.insert("enabled".to_string(), Value::Bool(draft.enabled));

        match channel_type.as_str() {
            "telegram" => {
                require_nonempty_channel_field(&config, "botToken", "Telegram bot token")?;
                config
                    .entry("dmPolicy".to_string())
                    .or_insert_with(|| json!("pairing"));
                config
                    .entry("groupPolicy".to_string())
                    .or_insert_with(|| json!("allowlist"));
                config
                    .entry("streaming".to_string())
                    .or_insert_with(|| json!("partial"));
            }
            "discord" => {
                require_nonempty_channel_field(&config, "token", "Discord bot token")?;
                config
                    .entry("groupPolicy".to_string())
                    .or_insert_with(|| json!("allowlist"));
                config
                    .entry("streaming".to_string())
                    .or_insert_with(|| json!("off"));
            }
            _ => {
                if config.len() <= 1 {
                    return Err(format!(
                        "Channel '{}' needs at least one non-empty config field.",
                        channel_type
                    ));
                }
            }
        }

        results.push((channel_type, Value::Object(config)));
    }

    if !results.iter().any(|(_, config)| {
        config
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }) {
        return Err("At least one enabled message channel is required.".to_string());
    }

    Ok(results)
}

fn require_nonempty_channel_field(
    config: &serde_json::Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<(), String> {
    let value = config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if value.is_none() {
        return Err(format!("{} is required.", label));
    }
    Ok(())
}

fn normalize_config_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(Value::String(trimmed.to_string()))
            }
        }
        _ => Some(value.clone()),
    }
}

fn normalize_identifier(input: Option<&str>) -> Option<String> {
    let raw = input?.trim().to_lowercase();
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

fn normalize_optional_string(input: Option<&str>) -> Option<String> {
    input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_model_id(input: Option<&str>) -> Option<String> {
    normalize_optional_string(input)
}

fn normalize_model_list(input: &[String]) -> Vec<String> {
    let items = input
        .iter()
        .filter_map(|value| normalize_optional_string(Some(value.as_str())))
        .collect::<Vec<_>>();
    if items.is_empty() {
        DEFAULT_FALLBACK_MODELS
            .iter()
            .map(|value| value.to_string())
            .collect()
    } else {
        items
    }
}

fn generate_hex_token(bytes_len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut state = seed as u64 ^ 0x9e3779b97f4a7c15;
    let mut output = String::with_capacity(bytes_len * 2);
    for _ in 0..bytes_len {
        state ^= state << 7;
        state ^= state >> 9;
        state ^= state << 8;
        let byte = (state & 0xff) as u8;
        output.push_str(&format!("{:02x}", byte));
    }
    output
}

fn current_offset_timestamp() -> String {
    chrono::Local::now().to_rfc3339()
}

fn upsert_health_entry_json(
    gateway_id: &str,
    port: u16,
    service_name: &str,
    service_active: &str,
    service_exit_code: Option<i32>,
    listener_exit_code: Option<i32>,
    listener_output: Option<String>,
) -> Result<(), String> {
    let path = wsl_path_to_unc(HEALTH_WSL_PATH);
    let mut entries = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read gateway health file: {}", error))?;
        serde_json::from_str::<Vec<Value>>(&raw)
            .map_err(|error| format!("Failed to parse gateway health file: {}", error))?
    } else {
        Vec::new()
    };

    let mut replacement = serde_json::Map::new();
    replacement.insert("id".to_string(), json!(gateway_id));
    replacement.insert("port".to_string(), json!(port));
    replacement.insert("serviceName".to_string(), json!(service_name));
    replacement.insert("serviceActive".to_string(), json!(service_active));
    replacement.insert("serviceExitCode".to_string(), json!(service_exit_code));
    replacement.insert("listenerExitCode".to_string(), json!(listener_exit_code));
    if let Some(output) = listener_output {
        replacement.insert("listenerOutput".to_string(), json!(output));
    }

    if let Some(existing) = entries.iter_mut().find(|entry| {
        entry
            .get("id")
            .and_then(Value::as_str)
            .map(|value| value == gateway_id)
            .unwrap_or(false)
    }) {
        let object = existing
            .as_object_mut()
            .ok_or_else(|| "Gateway health entry is not an object.".to_string())?;
        for (key, value) in replacement {
            object.insert(key, value);
        }
    } else {
        entries.push(Value::Object(replacement));
    }

    let content = serde_json::to_string_pretty(&entries)
        .map_err(|error| format!("Failed to serialize gateway health file: {}", error))?;
    fs::write(path, format!("{}\n", content))
        .map_err(|error| format!("Failed to write gateway health file: {}", error))
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn load_health_map() -> HashMap<String, HealthEntry> {
    let path = wsl_path_to_unc(HEALTH_WSL_PATH);
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(entries) = serde_json::from_str::<Vec<HealthEntry>>(sanitize_json_text(&raw)) else {
        return HashMap::new();
    };

    entries
        .into_iter()
        .map(|entry| (entry.id.clone(), entry))
        .collect()
}

fn sanitize_json_text(raw: &str) -> &str {
    raw.trim_start_matches('\u{feff}')
}

fn find_gateway<'a>(
    manifest: &'a GatewayManifest,
    gateway_id: &str,
) -> Result<&'a ManifestGateway, String> {
    manifest
        .gateways
        .iter()
        .find(|gateway| gateway.id == gateway_id)
        .ok_or_else(|| format!("Unknown gateway id '{}'.", gateway_id))
}

fn read_gateway_service_runtime(gateway: &ManifestGateway) -> GatewayServiceRuntime {
    let properties = match run_wsl_command(&[
        "systemctl",
        "--user",
        "show",
        gateway.service_name.as_str(),
        "--property=ActiveState",
        "--property=SubState",
        "--property=ExecMainPID",
        "--property=UnitFileState",
    ]) {
        Ok(output) => parse_systemctl_properties(&output),
        Err(error) => {
            warn!(
                "[Gateways] Failed to read systemctl properties for {}: {}",
                gateway.service_name, error
            );
            HashMap::new()
        }
    };

    GatewayServiceRuntime {
        active_state: properties
            .get("ActiveState")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        sub_state: properties
            .get("SubState")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        unit_file_state: properties
            .get("UnitFileState")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        main_pid: properties
            .get("ExecMainPID")
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|pid| *pid > 0),
        port_listening: check_wsl_port_listening(gateway.port),
    }
}

fn read_gateway_config(gateway: &ManifestGateway) -> GatewayConfigDigest {
    let config_path = wsl_path_to_unc(&wsl_join(&gateway.state_dir, "openclaw.json"));
    let Ok(raw) = fs::read_to_string(config_path) else {
        return GatewayConfigDigest {
            notes: vec!["openclaw.json is missing or unreadable.".to_string()],
            ..GatewayConfigDigest::default()
        };
    };
    let Ok(config) = serde_json::from_str::<Value>(sanitize_json_text(&raw)) else {
        return GatewayConfigDigest {
            notes: vec!["openclaw.json could not be parsed.".to_string()],
            ..GatewayConfigDigest::default()
        };
    };

    let primary_model = json_string(&config, "/agents/defaults/model/primary")
        .or_else(|| json_string(&config, "/agents/defaults/model"));
    let fallback_models = json_array_strings(&config, "/agents/defaults/model/fallbacks");
    let bind = json_string(&config, "/gateway/bind");
    let auth_mode = json_string(&config, "/gateway/auth/mode");
    let memory_search_enabled = config
        .pointer("/agents/defaults/memorySearch/enabled")
        .or_else(|| config.pointer("/memorySearch/enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let browser_headless = config.pointer("/browser/headless").and_then(Value::as_bool);
    let browser_no_sandbox = config
        .pointer("/browser/noSandbox")
        .and_then(Value::as_bool);
    let channels = config
        .get("channels")
        .and_then(Value::as_object)
        .map(|channels| {
            channels
                .iter()
                .filter_map(|(name, value)| {
                    let enabled = value
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    if enabled {
                        Some(name.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut notes = Vec::new();
    if bind.as_deref() == Some("loopback") {
        notes.push("Gateway is restricted to loopback access.".to_string());
    }
    if !memory_search_enabled {
        notes.push("Memory search is not enabled for this gateway.".to_string());
    }

    GatewayConfigDigest {
        primary_model,
        fallback_models,
        bind,
        auth_mode,
        channels,
        memory_search_enabled,
        browser_headless,
        browser_no_sandbox,
        notes,
    }
}

fn read_openclaw_version() -> Option<String> {
    match run_wsl_command(&["openclaw", "--version"]) {
        Ok(output) => {
            let trimmed = output.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Err(error) => {
            warn!("[Gateways] Failed to read OpenClaw version: {}", error);
            None
        }
    }
}

fn fetch_control_center_json(port: u16, path: &str, warnings: &mut Vec<String>) -> Option<Value> {
    let Some(response) = http_get(port, path) else {
        warnings.push(format!("{} is unavailable on port {}.", path, port));
        return None;
    };

    let body = response_body(&response);
    match serde_json::from_str::<Value>(body) {
        Ok(value) => Some(value),
        Err(error) => {
            warnings.push(format!("{} returned invalid JSON: {}", path, error));
            None
        }
    }
}

fn normalize_workbench_scope(scope: &str) -> Option<&'static str> {
    match scope.trim().to_lowercase().as_str() {
        "docs" => Some("docs"),
        "memory" => Some("memory"),
        _ => None,
    }
}

fn collect_workbench_files(gateway: &ManifestGateway, scope: &str) -> Vec<WorkbenchFileEntry> {
    let Some(normalized_scope) = normalize_workbench_scope(scope) else {
        return Vec::new();
    };

    let workspace_root = wsl_path_to_unc(&gateway.workspace_dir);
    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    match normalized_scope {
        "docs" => {
            for relative in [
                "AGENTS.md",
                "SOUL.md",
                "IDENTITY.md",
                "USER.md",
                "TOOLS.md",
                "HEARTBEAT.md",
                "README.md",
                "NOW.md",
                "MEMORY.md",
            ] {
                push_workbench_file(
                    &workspace_root,
                    relative,
                    normalized_scope,
                    &mut entries,
                    &mut seen,
                );
            }

            for directory in ["docs", "runbooks"] {
                walk_workbench_directory(
                    &workspace_root,
                    &workspace_root.join(directory),
                    normalized_scope,
                    &mut entries,
                    &mut seen,
                    80,
                );
            }
        }
        "memory" => {
            for relative in ["MEMORY.md", "NOW.md", "HEARTBEAT.md"] {
                push_workbench_file(
                    &workspace_root,
                    relative,
                    normalized_scope,
                    &mut entries,
                    &mut seen,
                );
            }

            walk_workbench_directory(
                &workspace_root,
                &workspace_root.join("memory"),
                normalized_scope,
                &mut entries,
                &mut seen,
                120,
            );
        }
        _ => {}
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));
    entries
}

fn push_workbench_file(
    workspace_root: &Path,
    relative: &str,
    scope: &str,
    entries: &mut Vec<WorkbenchFileEntry>,
    seen: &mut HashSet<String>,
) {
    let full_path = workspace_root.join(relative);
    if !full_path.is_file() {
        return;
    }

    let relative_path = relative.replace('\\', "/");
    if !seen.insert(relative_path.clone()) {
        return;
    }

    let metadata = fs::metadata(&full_path).ok();
    entries.push(WorkbenchFileEntry {
        scope: scope.to_string(),
        name: Path::new(relative)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative.to_string()),
        path: relative_path,
        bytes: metadata
            .as_ref()
            .map(|value| value.len())
            .unwrap_or_default(),
        updated_at: metadata.and_then(|value| metadata_timestamp(&value)),
    });
}

fn walk_workbench_directory(
    workspace_root: &Path,
    directory: &Path,
    scope: &str,
    entries: &mut Vec<WorkbenchFileEntry>,
    seen: &mut HashSet<String>,
    limit: usize,
) {
    if entries.len() >= limit || !directory.exists() {
        return;
    }

    let Ok(read_dir) = fs::read_dir(directory) else {
        return;
    };

    for item in read_dir.flatten() {
        if entries.len() >= limit {
            break;
        }

        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("node_modules") {
            continue;
        }

        if path.is_dir() {
            walk_workbench_directory(workspace_root, &path, scope, entries, seen, limit);
            continue;
        }

        if !path.is_file() || !is_supported_workbench_file(&name) {
            continue;
        }

        let Ok(relative) = path.strip_prefix(workspace_root) else {
            continue;
        };
        let relative_path = relative.to_string_lossy().replace('\\', "/");
        if !seen.insert(relative_path.clone()) {
            continue;
        }

        let metadata = item.metadata().ok();
        entries.push(WorkbenchFileEntry {
            scope: scope.to_string(),
            name,
            path: relative_path,
            bytes: metadata
                .as_ref()
                .map(|value| value.len())
                .unwrap_or_default(),
            updated_at: metadata.and_then(|value| metadata_timestamp(&value)),
        });
    }
}

fn is_supported_workbench_file(name: &str) -> bool {
    name.ends_with(".md") || name.ends_with(".txt")
}

fn metadata_timestamp(metadata: &fs::Metadata) -> Option<String> {
    let modified = metadata.modified().ok()?;
    let datetime: DateTime<Utc> = modified.into();
    Some(datetime.to_rfc3339())
}

fn resolve_workbench_file_path(
    gateway: &ManifestGateway,
    scope: &str,
    relative_path: &str,
) -> Option<PathBuf> {
    let scope = normalize_workbench_scope(scope)?;
    let files = collect_workbench_files(gateway, scope);
    let entry = files.into_iter().find(|item| item.path == relative_path)?;
    Some(wsl_path_to_unc(&wsl_join(
        &gateway.workspace_dir,
        &entry.path,
    )))
}

fn parse_systemctl_properties(input: &str) -> HashMap<String, String> {
    input
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

fn json_string(value: &Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn json_array_strings(value: &Value, pointer: &str) -> Vec<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn wait_for_gateway_state(port: u16, action: &str) -> Result<(), String> {
    let should_listen = action == "start" || action == "restart";
    let started_at = Instant::now();
    let timeout = Duration::from_secs(if should_listen { 18 } else { 10 });

    while started_at.elapsed() < timeout {
        let listening = check_wsl_port_listening(port);
        if listening == should_listen {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(600));
    }

    Err(format!(
        "Timed out waiting for gateway port {} to {}.",
        port,
        if should_listen {
            "start listening"
        } else {
            "stop listening"
        }
    ))
}

fn bridge_status(ports: &[u16]) -> BridgeStatus {
    let script = bridge_script_path();
    let missing_ports = ports
        .iter()
        .copied()
        .filter(|port| !is_local_port_open(*port))
        .collect::<Vec<_>>();

    BridgeStatus {
        script_path: script.as_ref().map(|path| path.display().to_string()),
        ready: missing_ports.is_empty(),
        ports: ports.to_vec(),
        missing_ports,
    }
}

fn ensure_bridge_ports(ports: &[u16]) -> Result<(), String> {
    let missing = ports
        .iter()
        .copied()
        .filter(|port| !is_local_port_open(*port))
        .collect::<Vec<_>>();

    if missing.is_empty() {
        return Ok(());
    }

    let script_path = bridge_script_path()
        .ok_or_else(|| "openclaw-wsl-bridge.js was not found under %APPDATA%\\npm.".to_string())?;

    info!(
        "[Gateways] Bridge missing local ports {:?}, starting {}",
        missing,
        script_path.display()
    );

    let mut command = Command::new("node");
    command.arg(&script_path);
    command.env("OPENCLAW_WSL_DISTRO", wsl_distro());
    command.env(
        "OPENCLAW_WSL_PORTS",
        ports
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(","),
    );

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|error| format!("Failed to launch WSL bridge: {}", error))?;

    let started_at = Instant::now();
    let timeout = Duration::from_secs(12);
    while started_at.elapsed() < timeout {
        if ports.iter().all(|port| is_local_port_open(*port)) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    Err("WSL bridge did not expose the required local gateway ports in time.".to_string())
}

fn bridge_script_path() -> Option<PathBuf> {
    let app_data = std::env::var_os("APPDATA")?;
    let path = PathBuf::from(app_data)
        .join("npm")
        .join("openclaw-wsl-bridge.js");
    path.exists().then_some(path)
}

fn build_control_center_status(
    ui_port: u16,
    repo_path: Option<&PathBuf>,
    runtime_dir: Option<String>,
) -> ControlCenterStatus {
    ControlCenterStatus {
        ui_port,
        base_url: format!("http://127.0.0.1:{}/?section=overview&lang=zh", ui_port),
        ready: control_center_ready(ui_port),
        launchable: repo_path.is_some(),
        repo_path: repo_path.map(|path| path.display().to_string()),
        runtime_dir,
    }
}

fn build_control_center_port_map(manifest: &GatewayManifest) -> HashMap<String, u16> {
    let mut assignments = HashMap::new();
    let mut used_ports = HashSet::new();

    for gateway in &manifest.gateways {
        if let Some(port) = reserved_control_center_port(&gateway.id) {
            assignments.insert(gateway.id.clone(), port);
            used_ports.insert(port);
        }
    }

    let mut next_port = CONTROL_CENTER_DYNAMIC_PORT_START;
    for gateway in &manifest.gateways {
        if assignments.contains_key(&gateway.id) {
            continue;
        }
        while used_ports.contains(&next_port) {
            next_port += 1;
        }
        assignments.insert(gateway.id.clone(), next_port);
        used_ports.insert(next_port);
        next_port += 1;
    }

    assignments
}

fn preferred_control_center_port(manifest: &GatewayManifest, gateway_id: &str) -> u16 {
    build_control_center_port_map(manifest)
        .get(gateway_id)
        .copied()
        .unwrap_or(CONTROL_CENTER_DYNAMIC_PORT_START)
}

fn reserved_control_center_port(gateway_id: &str) -> Option<u16> {
    match gateway_id {
        "main" => Some(4310),
        "gateway-lxgnews" => Some(4311),
        "doctor" => Some(4312),
        _ => None,
    }
}

fn control_center_runtime_dir(gateway_id: &str) -> PathBuf {
    manager_runtime_dir()
        .join("control-centers")
        .join(gateway_id)
}

fn control_center_log_paths(gateway_id: &str) -> (PathBuf, PathBuf) {
    let log_dir = manager_runtime_dir().join("logs");
    (
        log_dir.join(format!("control-center-{}.stdout.log", gateway_id)),
        log_dir.join(format!("control-center-{}.stderr.log", gateway_id)),
    )
}

fn control_center_diagnostics(
    gateway: &ManifestGateway,
    ui_port: u16,
    runtime_dir: &Path,
    stdout_path: &Path,
    stderr_path: &Path,
) -> String {
    format!(
        "gateway_id={}, gateway_port={}, ui_port={}, runtime_dir={}, stdout_log={}, stderr_log={}",
        gateway.id,
        gateway.port,
        ui_port,
        runtime_dir.display(),
        stdout_path.display(),
        stderr_path.display()
    )
}

fn manager_runtime_dir() -> PathBuf {
    if let Some(local_data) = dirs::data_local_dir() {
        return local_data.join("OpenClawManager");
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AppData")
        .join("Local")
        .join("OpenClawManager")
}

fn find_control_center_repo() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(explicit) = std::env::var_os("OPENCLAW_CONTROL_CENTER_PATH") {
        candidates.push(PathBuf::from(explicit));
    }

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        candidates.push(exe_dir.join("openclaw-control-center"));
        candidates.push(exe_dir.join("..").join("openclaw-control-center"));
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Desktop")
                .join("项目1")
                .join("openclaw-control-center"),
        );
        candidates.push(home.join("Desktop").join("openclaw-control-center"));
        candidates.push(home.join("repos").join("openclaw-control-center"));
    }

    candidates.into_iter().find(|path| {
        path.join("package.json").exists() && path.join("src").join("ui").join("server.ts").exists()
    })
}

fn spawn_control_center_process(
    gateway: &ManifestGateway,
    repo_path: &Path,
    runtime_dir: &Path,
    ui_port: u16,
) -> Result<(), String> {
    let log_dir = manager_runtime_dir().join("logs");
    let (stdout_path, stderr_path) = control_center_log_paths(&gateway.id);
    let diagnostics = control_center_diagnostics(
        gateway,
        ui_port,
        runtime_dir,
        &stdout_path,
        &stderr_path,
    );

    fs::create_dir_all(runtime_dir).map_err(|error| {
        format!(
            "Failed to create control center runtime dir: {}. {}",
            error, diagnostics
        )
    })?;
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create log directory: {}. {}", error, diagnostics))?;

    let stdout_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_path)
        .map_err(|error| format!("Failed to open control center stdout log: {}. {}", error, diagnostics))?;
    let stderr_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_path)
        .map_err(|error| format!("Failed to open control center stderr log: {}. {}", error, diagnostics))?;

    let mut command = Command::new("cmd");
    command.args(["/c", "npm.cmd", "run", "dev:ui"]);
    command.current_dir(repo_path);
    command.env("GATEWAY_URL", format!("ws://127.0.0.1:{}", gateway.port));
    command.env("OPENCLAW_HOME", wsl_path_to_unc(&gateway.state_dir));
    command.env(
        "OPENCLAW_CONFIG_PATH",
        wsl_path_to_unc(&wsl_join(&gateway.state_dir, "openclaw.json")),
    );
    command.env(
        "OPENCLAW_WORKSPACE_ROOT",
        wsl_path_to_unc(&gateway.workspace_dir),
    );
    command.env("READONLY_MODE", "true");
    command.env("APPROVAL_ACTIONS_ENABLED", "false");
    command.env("APPROVAL_ACTIONS_DRY_RUN", "true");
    command.env("IMPORT_MUTATION_ENABLED", "false");
    command.env("IMPORT_MUTATION_DRY_RUN", "false");
    command.env("LOCAL_TOKEN_AUTH_REQUIRED", "true");
    command.env("UI_MODE", "true");
    command.env("UI_PORT", ui_port.to_string());
    command.env("UI_BIND_ADDRESS", "127.0.0.1");
    command.env("MISSION_CONTROL_RUNTIME_DIR", runtime_dir);
    if let Some(codex_home) = dirs::home_dir().map(|home| home.join(".codex")) {
        if codex_home.exists() {
            command.env("CODEX_HOME", codex_home);
        }
    }
    command.stdout(Stdio::from(stdout_file));
    command.stderr(Stdio::from(stderr_file));

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn().map_err(|error| {
        format!(
            "Failed to start control center: {}. {}",
            error, diagnostics
        )
    })?;

    Ok(())
}

fn wait_for_control_center(
    gateway: &ManifestGateway,
    port: u16,
    runtime_dir: &Path,
    stdout_path: &Path,
    stderr_path: &Path,
    timeout: Duration,
) -> Result<(), String> {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        if control_center_ready(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(600));
    }

    Err(format!(
        "Control Center on port {} did not become ready in time. {}",
        port,
        control_center_diagnostics(gateway, port, runtime_dir, stdout_path, stderr_path)
    ))
}

fn control_center_ready(port: u16) -> bool {
    if let Some(response) = http_get(port, "/healthz") {
        if response_has_status(&response, 200) {
            return true;
        }
        if response_has_status(&response, 503) && response_body(&response).contains("\"health\"") {
            return true;
        }
    }

    http_get(port, "/?section=overview&lang=zh")
        .map(|response| {
            response_has_status(&response, 200) && control_center_html_looks_valid(&response)
        })
        .unwrap_or(false)
}

fn http_get(port: u16, path: &str) -> Option<String> {
    let address = first_socket_addr(("127.0.0.1", port))?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok()?;

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path, port
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut buffer = String::new();
    stream.read_to_string(&mut buffer).ok()?;
    Some(buffer)
}

fn is_local_port_open(port: u16) -> bool {
    first_socket_addr(("127.0.0.1", port))
        .and_then(|address| TcpStream::connect_timeout(&address, Duration::from_millis(300)).ok())
        .is_some()
}

fn response_has_status(response: &str, status_code: u16) -> bool {
    response
        .lines()
        .next()
        .map(|line| line.contains(&format!(" {}", status_code)))
        .unwrap_or(false)
}

fn response_body(response: &str) -> &str {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default()
}

fn control_center_html_looks_valid(response: &str) -> bool {
    let body = response_body(response);
    body.contains("OpenClaw Control Center")
        || body.contains("mission-control")
        || body.contains("data-dashboard-section")
}

fn first_socket_addr<T: ToSocketAddrs>(input: T) -> Option<SocketAddr> {
    input.to_socket_addrs().ok()?.next()
}

fn check_wsl_port_listening(port: u16) -> bool {
    let script = format!("ss -ltn '( sport = :{} )' | sed -n '2p'", port);
    match run_wsl_command(&["bash", "-lc", script.as_str()]) {
        Ok(output) => !output.trim().is_empty(),
        Err(_) => false,
    }
}

fn run_wsl_command(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("wsl");
    command.arg("-d").arg(wsl_distro()).arg("--").args(args);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("Failed to run WSL command {:?}: {}", args, error))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stderr.is_empty() {
            Err(stdout)
        } else if stdout.is_empty() {
            Err(stderr)
        } else {
            Err(format!("{}\n{}", stdout, stderr))
        }
    }
}

fn wsl_distro() -> String {
    std::env::var("OPENCLAW_WSL_DISTRO").unwrap_or_else(|_| DEFAULT_WSL_DISTRO.to_string())
}

fn wsl_path_to_unc(path: &str) -> PathBuf {
    let trimmed = path.trim().trim_start_matches('/');
    let mut unc = PathBuf::from(format!(r"\\wsl.localhost\{}", wsl_distro()));
    if !trimmed.is_empty() {
        for segment in trimmed.split('/') {
            unc.push(segment);
        }
    }
    unc
}

fn wsl_join(base: &str, relative: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        relative.trim_start_matches('/')
    )
}

fn read_last_lines(path: &Path, count: usize) -> Vec<String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = content
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if lines.len() > count {
        lines = lines.split_off(lines.len() - count);
    }
    lines
}

fn read_gateway_log_files(gateway: &ManifestGateway, count: usize) -> Vec<String> {
    let mut merged = Vec::new();

    for relative in [
        "logs/gateway.log",
        "logs/gateway.err.log",
        "stdout.log",
        "stderr.log",
    ] {
        let log_path = wsl_path_to_unc(&wsl_join(&gateway.state_dir, relative));
        if !log_path.exists() {
            continue;
        }
        merged.extend(read_last_lines(&log_path, count));
    }

    normalize_log_lines(merged, count)
}

fn read_gateway_journal(gateway: &ManifestGateway, count: usize) -> Vec<String> {
    let requested = count.to_string();
    let args = [
        "journalctl",
        "--user",
        "-u",
        gateway.service_name.as_str(),
        "--no-pager",
        "-n",
        requested.as_str(),
        "--output=short-iso-precise",
    ];

    match run_wsl_command(&args) {
        Ok(output) => normalize_log_lines(
            output.lines().map(str::to_string).collect::<Vec<_>>(),
            count,
        ),
        Err(error) => {
            warn!(
                "[Gateways] Failed to read journal for {}: {}",
                gateway.service_name, error
            );
            Vec::new()
        }
    }
}

fn normalize_log_lines(lines: Vec<String>, count: usize) -> Vec<String> {
    let mut normalized = lines
        .into_iter()
        .map(|line| line.trim_end().to_string())
        .filter(|line| !line.trim().is_empty())
        .filter(|line| line != "-- No entries --")
        .collect::<Vec<_>>();

    normalized.dedup();

    if normalized.len() > count {
        normalized = normalized.split_off(normalized.len() - count);
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_gateway(id: &str, port: u16) -> ManifestGateway {
        ManifestGateway {
            id: id.to_string(),
            label: id.to_string(),
            profile: Some(format!("profile-{}", id)),
            service_name: format!("openclaw-gateway-{}.service", id),
            state_dir: format!("/root/.openclaw-{}", id),
            workspace_dir: format!("/root/.openclaw-{}/workspace", id),
            port,
            browser_profile: None,
        }
    }

    fn test_manifest(ids_and_ports: &[(&str, u16)]) -> GatewayManifest {
        GatewayManifest {
            generated_at: None,
            gateways: ids_and_ports
                .iter()
                .map(|(id, port)| test_gateway(id, *port))
                .collect(),
        }
    }

    #[test]
    fn control_center_port_map_assigns_reserved_and_dynamic_ports() {
        let manifest = test_manifest(&[
            ("main", 18790),
            ("gateway-lxgnews", 18791),
            ("doctor", 18802),
            ("maliangwriter", 18803),
            ("lulu-bot", 18795),
        ]);

        let port_map = build_control_center_port_map(&manifest);

        assert_eq!(port_map.get("main"), Some(&4310));
        assert_eq!(port_map.get("gateway-lxgnews"), Some(&4311));
        assert_eq!(port_map.get("doctor"), Some(&4312));
        assert_eq!(port_map.get("maliangwriter"), Some(&4313));
        assert_eq!(port_map.get("lulu-bot"), Some(&4314));
        assert_eq!(preferred_control_center_port(&manifest, "maliangwriter"), 4313);
        assert_eq!(preferred_control_center_port(&manifest, "lulu-bot"), 4314);
    }

    #[test]
    fn control_center_diagnostics_include_dynamic_gateway_details() {
        let manifest = test_manifest(&[
            ("main", 18790),
            ("gateway-lxgnews", 18791),
            ("doctor", 18802),
            ("maliangwriter", 18803),
            ("lulu-bot", 18795),
        ]);
        let gateway = manifest
            .gateways
            .iter()
            .find(|gateway| gateway.id == "maliangwriter")
            .unwrap();
        let ui_port = preferred_control_center_port(&manifest, &gateway.id);
        let runtime_dir = control_center_runtime_dir(&gateway.id);
        let (stdout_path, stderr_path) = control_center_log_paths(&gateway.id);
        let diagnostics =
            control_center_diagnostics(gateway, ui_port, &runtime_dir, &stdout_path, &stderr_path);

        assert!(diagnostics.contains("gateway_id=maliangwriter"));
        assert!(diagnostics.contains("gateway_port=18803"));
        assert!(diagnostics.contains("ui_port=4313"));
        assert!(diagnostics.contains(&format!("runtime_dir={}", runtime_dir.display())));
        assert!(diagnostics.contains(&format!("stdout_log={}", stdout_path.display())));
        assert!(diagnostics.contains(&format!("stderr_log={}", stderr_path.display())));
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerState {
    pub generated_at: Option<String>,
    pub distro: String,
    pub bridge: BridgeStatus,
    pub control_center_repo: Option<String>,
    pub openclaw_version: Option<String>,
    pub gateways: Vec<GatewaySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub script_path: Option<String>,
    pub ready: bool,
    pub ports: Vec<u16>,
    pub missing_ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySummary {
    pub id: String,
    pub label: String,
    pub profile: Option<String>,
    pub service_name: String,
    pub state_dir: String,
    pub workspace_dir: String,
    pub port: u16,
    pub browser_profile: Option<String>,
    pub service: GatewayServiceRuntime,
    pub config: GatewayConfigDigest,
    pub health: GatewayHealthDigest,
    pub control_center: ControlCenterStatus,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayServiceRuntime {
    pub active_state: String,
    pub sub_state: String,
    pub unit_file_state: String,
    pub main_pid: Option<u32>,
    pub port_listening: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigDigest {
    pub primary_model: Option<String>,
    pub fallback_models: Vec<String>,
    pub bind: Option<String>,
    pub auth_mode: Option<String>,
    pub channels: Vec<String>,
    pub memory_search_enabled: bool,
    pub browser_headless: Option<bool>,
    pub browser_no_sandbox: Option<bool>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHealthDigest {
    pub service_active: Option<String>,
    pub service_exit_code: Option<i32>,
    pub listener_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlCenterStatus {
    pub ui_port: u16,
    pub base_url: String,
    pub ready: bool,
    pub launchable: bool,
    pub repo_path: Option<String>,
    pub runtime_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayLogResponse {
    pub gateway_id: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWorkbenchData {
    pub gateway_id: String,
    pub fetched_at: String,
    pub ready: bool,
    pub launchable: bool,
    pub ui_port: u16,
    pub base_url: String,
    pub warnings: Vec<String>,
    pub snapshot: Option<Value>,
    pub usage: Option<Value>,
    pub queue: Option<Value>,
    pub projects: Option<Value>,
    pub tasks: Option<Value>,
    pub sessions: Option<Value>,
    pub health: Option<Value>,
    pub docs: Vec<WorkbenchFileEntry>,
    pub memory: Vec<WorkbenchFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchFileEntry {
    pub scope: String,
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchFileContent {
    pub gateway_id: String,
    pub scope: String,
    pub path: String,
    pub content: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedGatewayChannelDraft {
    pub channel_type: String,
    pub enabled: bool,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateManagedGatewayRequest {
    pub label: String,
    pub gateway_id: Option<String>,
    pub profile: Option<String>,
    pub inherit_env_from: Option<String>,
    pub port: Option<u16>,
    pub browser_profile: Option<String>,
    pub memory_search_enabled: bool,
    pub primary_model: Option<String>,
    pub fallback_models: Vec<String>,
    pub channels: Vec<ManagedGatewayChannelDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateManagedGatewayResponse {
    pub gateway_id: String,
    pub label: String,
    pub profile: String,
    pub service_name: String,
    pub state_dir: String,
    pub workspace_dir: String,
    pub port: u16,
    pub control_center_port: u16,
    pub notes: Vec<String>,
}

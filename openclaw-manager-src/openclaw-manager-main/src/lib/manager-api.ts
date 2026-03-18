import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

export interface BridgeStatus {
  scriptPath: string | null;
  ready: boolean;
  ports: number[];
  missingPorts: number[];
}

export interface GatewayServiceRuntime {
  activeState: string;
  subState: string;
  unitFileState: string;
  mainPid: number | null;
  portListening: boolean;
}

export interface GatewayConfigDigest {
  primaryModel: string | null;
  fallbackModels: string[];
  bind: string | null;
  authMode: string | null;
  channels: string[];
  memorySearchEnabled: boolean;
  browserHeadless: boolean | null;
  browserNoSandbox: boolean | null;
  notes: string[];
}

export interface GatewayHealthDigest {
  serviceActive: string | null;
  serviceExitCode: number | null;
  listenerExitCode: number | null;
}

export interface ControlCenterStatus {
  uiPort: number;
  baseUrl: string;
  ready: boolean;
  launchable: boolean;
  repoPath: string | null;
  runtimeDir: string | null;
}

export interface GatewaySummary {
  id: string;
  label: string;
  profile: string | null;
  serviceName: string;
  stateDir: string;
  workspaceDir: string;
  port: number;
  browserProfile: string | null;
  service: GatewayServiceRuntime;
  config: GatewayConfigDigest;
  health: GatewayHealthDigest;
  controlCenter: ControlCenterStatus;
  issues: string[];
}

export interface ManagerState {
  generatedAt: string | null;
  distro: string;
  bridge: BridgeStatus;
  controlCenterRepo: string | null;
  openclawVersion: string | null;
  gateways: GatewaySummary[];
}

export interface GatewayLogResponse {
  gatewayId: string;
  lines: string[];
}

export interface ManagedGatewayChannelDraft {
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface CreateManagedGatewayRequest {
  label: string;
  gatewayId?: string | null;
  profile?: string | null;
  inheritEnvFrom?: string | null;
  port?: number | null;
  browserProfile?: string | null;
  memorySearchEnabled: boolean;
  primaryModel?: string | null;
  fallbackModels: string[];
  channels: ManagedGatewayChannelDraft[];
}

export interface CreateManagedGatewayResponse {
  gatewayId: string;
  label: string;
  profile: string;
  serviceName: string;
  stateDir: string;
  workspaceDir: string;
  port: number;
  controlCenterPort: number;
  notes: string[];
}

export type WorkbenchScope = 'docs' | 'memory';

export interface WorkbenchFileEntry {
  scope: WorkbenchScope;
  path: string;
  name: string;
  bytes: number;
  updatedAt: string | null;
}

export interface WorkbenchFileContent {
  gatewayId: string;
  scope: WorkbenchScope;
  path: string;
  content: string;
  updatedAt: string | null;
}

export type AgentRunState = 'idle' | 'running' | 'blocked' | 'waiting_approval' | 'error';
export type ApprovalState = 'pending' | 'approved' | 'denied' | 'unknown';
export type TaskState = 'todo' | 'in_progress' | 'blocked' | 'done';
export type ProjectState = 'planned' | 'active' | 'blocked' | 'done';
export type BudgetStatus = 'ok' | 'warn' | 'over';

export interface SessionSummary {
  sessionKey: string;
  label?: string;
  agentId?: string;
  state: AgentRunState;
  lastMessageAt?: string;
}

export interface SessionStatusSnapshot {
  sessionKey: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  updatedAt: string;
}

export interface CronJobSummary {
  jobId: string;
  name?: string;
  enabled: boolean;
  nextRunAt?: string;
}

export interface ApprovalSummary {
  approvalId: string;
  sessionKey?: string;
  agentId?: string;
  status: ApprovalState;
  decision?: string;
  command?: string;
  reason?: string;
  requestedAt?: string;
  updatedAt?: string;
}

export interface BudgetThresholds {
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  cost?: number;
  warnRatio?: number;
}

export interface ProjectRecord {
  projectId: string;
  title: string;
  status: ProjectState;
  owner: string;
  budget: BudgetThresholds;
  updatedAt: string;
}

export interface ProjectStoreSnapshot {
  projects: ProjectRecord[];
  updatedAt: string;
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  status: ProjectState;
  owner: string;
  totalTasks: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  due: number;
  updatedAt: string;
}

export interface TaskArtifact {
  artifactId: string;
  type: 'code' | 'doc' | 'link' | 'other';
  label: string;
  location: string;
}

export interface ProjectTask {
  projectId: string;
  taskId: string;
  title: string;
  status: TaskState;
  owner: string;
  dueAt?: string;
  definitionOfDone: string[];
  artifacts: TaskArtifact[];
  sessionKeys: string[];
  updatedAt: string;
}

export interface TaskStoreSnapshot {
  tasks: ProjectTask[];
  updatedAt: string;
}

export interface TasksSummary {
  projects: number;
  tasks: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  owners: number;
  artifacts: number;
}

export interface BudgetUsageSnapshot {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  cost: number;
}

export interface BudgetMetricEvaluation {
  metric: 'tokensIn' | 'tokensOut' | 'totalTokens' | 'cost';
  used: number;
  limit: number;
  warnAt: number;
  status: BudgetStatus;
}

export interface BudgetEvaluation {
  scope: 'agent' | 'project' | 'task';
  scopeId: string;
  label: string;
  thresholds: BudgetThresholds;
  usage: BudgetUsageSnapshot;
  metrics: BudgetMetricEvaluation[];
  status: BudgetStatus;
}

export interface BudgetSummary {
  total: number;
  ok: number;
  warn: number;
  over: number;
  evaluations: BudgetEvaluation[];
}

export interface ReadModelSnapshot {
  sessions: SessionSummary[];
  statuses: SessionStatusSnapshot[];
  cronJobs: CronJobSummary[];
  approvals: ApprovalSummary[];
  projects: ProjectStoreSnapshot;
  projectSummaries: ProjectSummary[];
  tasks: TaskStoreSnapshot;
  tasksSummary: TasksSummary;
  budgetSummary: BudgetSummary;
  generatedAt: string;
}

export interface UsagePeriod {
  key: string;
  label: string;
  tokens: number;
  estimatedCost: number;
  requestCountStatus: string;
  statusSamples: number;
  daysCovered: number;
  pace?: {
    label: string;
    state: string;
  };
  sourceStatus?: string;
}

export interface UsageConnectorTodo {
  id: string;
  title: string;
  detail: string;
}

export interface UsageSubscriptionSnapshot {
  status: string;
  planLabel?: string;
  consumed?: number;
  remaining?: number;
  limit?: number;
  usagePercent?: number;
  unit?: string;
  cycleStart?: string;
  cycleEnd?: string;
  detail?: string;
  connectHint?: string;
}

export interface UsageBudgetSnapshot {
  status: string;
  usedCost30d: number;
  message: string;
}

export interface UsageCostSnapshot {
  generatedAt: string;
  periods: UsagePeriod[];
  contextWindows: Array<Record<string, unknown>>;
  budget: UsageBudgetSnapshot;
  subscription: UsageSubscriptionSnapshot;
  connectors: {
    modelContextCatalog?: string;
    digestHistory?: string;
    requestCounts?: string;
    budgetLimit?: string;
    providerAttribution?: string;
    subscriptionUsage?: string;
    todos?: UsageConnectorTodo[];
  };
}

export interface UsageCostEnvelope {
  ok: boolean;
  usage: UsageCostSnapshot;
}

export interface NotificationCenterSnapshot {
  generatedAt: string;
  queue: ActionQueueItem[];
  counts: {
    total: number;
    acked: number;
    unacked: number;
  };
}

export interface ActionQueueItem {
  itemId: string;
  level: 'info' | 'warn' | 'action-required';
  code: string;
  source: string;
  sourceId: string;
  message: string;
  route: string;
  occurredAt?: string;
  acknowledged: boolean;
  ackedAt?: string;
  note?: string;
}

export interface ActionQueueEnvelope {
  ok: boolean;
  queue: NotificationCenterSnapshot;
}

export interface ProjectsEnvelope {
  ok: boolean;
  updatedAt: string;
  count: number;
  projects: ProjectRecord[];
}

export interface TasksEnvelope {
  ok: boolean;
  updatedAt: string;
  count: number;
  tasks: ProjectTask[];
}

export interface SessionConversationListItem {
  sessionKey: string;
  label?: string;
  agentId?: string;
  state: AgentRunState;
  lastMessageAt?: string;
  latestHistoryAt?: string;
  latestSnippet?: string;
}

export interface SessionsEnvelope {
  ok: boolean;
  generatedAt: string;
  total: number;
  page: number;
  pageSize: number;
  items: SessionConversationListItem[];
}

export interface HealthEnvelope {
  ok: boolean;
  health: {
    status: string;
    build?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    monitor?: Record<string, unknown>;
  };
}

export interface NativeWorkbenchData {
  gatewayId: string;
  fetchedAt: string;
  ready: boolean;
  launchable: boolean;
  uiPort: number;
  baseUrl: string;
  warnings: string[];
  snapshot: ReadModelSnapshot | null;
  usage: UsageCostEnvelope | null;
  queue: ActionQueueEnvelope | null;
  projects: ProjectsEnvelope | null;
  tasks: TasksEnvelope | null;
  sessions: SessionsEnvelope | null;
  health: HealthEnvelope | null;
  docs: WorkbenchFileEntry[];
  memory: WorkbenchFileEntry[];
}

const DEMO_STATE: ManagerState = {
  generatedAt: new Date().toISOString(),
  distro: 'Ubuntu',
  bridge: {
    scriptPath: null,
    ready: true,
    ports: [18790, 18791, 18802],
    missingPorts: [],
  },
  controlCenterRepo: 'openclaw-control-center',
  openclawVersion: '2026.3.13',
  gateways: [
    {
      id: 'main',
      label: 'Main Gateway',
      profile: null,
      serviceName: 'openclaw-gateway.service',
      stateDir: '/root/.openclaw',
      workspaceDir: '/root/.openclaw/workspace',
      port: 18790,
      browserProfile: 'zihan-profile',
      service: {
        activeState: 'active',
        subState: 'running',
        unitFileState: 'enabled',
        mainPid: 20001,
        portListening: true,
      },
      config: {
        primaryModel: 'kimi-coding/k2p5',
        fallbackModels: ['moonshot/kimi-k2.5', 'moonshot/kimi-k2-thinking'],
        bind: 'loopback',
        authMode: 'token',
        channels: ['telegram', 'discord'],
        memorySearchEnabled: false,
        browserHeadless: true,
        browserNoSandbox: true,
        notes: ['浏览器自动化已启用 headless 配置。'],
      },
      health: {
        serviceActive: 'active',
        serviceExitCode: 0,
        listenerExitCode: 0,
      },
      controlCenter: {
        uiPort: 4310,
        baseUrl: 'http://127.0.0.1:4310/?section=overview&lang=zh',
        ready: true,
        launchable: true,
        repoPath: 'openclaw-control-center',
        runtimeDir: 'runtime/main',
      },
      issues: [],
    },
    {
      id: 'gateway-lxgnews',
      label: 'LXG News Gateway',
      profile: 'gateway-lxgnews',
      serviceName: 'openclaw-gateway-lxgnews.service',
      stateDir: '/root/.openclaw-gateway-lxgnews',
      workspaceDir: '/root/.openclaw-gateway-lxgnews/lxg-workspace',
      port: 18791,
      browserProfile: null,
      service: {
        activeState: 'active',
        subState: 'running',
        unitFileState: 'enabled',
        mainPid: 20002,
        portListening: true,
      },
      config: {
        primaryModel: null,
        fallbackModels: [],
        bind: 'loopback',
        authMode: 'token',
        channels: ['telegram', 'discord'],
        memorySearchEnabled: true,
        browserHeadless: null,
        browserNoSandbox: null,
        notes: ['memory search 已启用。', '适合新闻采集与摘要。'],
      },
      health: {
        serviceActive: 'active',
        serviceExitCode: 0,
        listenerExitCode: 0,
      },
      controlCenter: {
        uiPort: 4311,
        baseUrl: 'http://127.0.0.1:4311/?section=overview&lang=zh',
        ready: false,
        launchable: true,
        repoPath: 'openclaw-control-center',
        runtimeDir: 'runtime/gateway-lxgnews',
      },
      issues: ['Control Center 还未启动。'],
    },
    {
      id: 'doctor',
      label: 'Doctor Gateway',
      profile: 'doctor',
      serviceName: 'openclaw-gateway-doctor.service',
      stateDir: '/root/.openclaw-doctor',
      workspaceDir: '/root/.openclaw-doctor/workspace',
      port: 18802,
      browserProfile: null,
      service: {
        activeState: 'active',
        subState: 'running',
        unitFileState: 'enabled',
        mainPid: 20003,
        portListening: true,
      },
      config: {
        primaryModel: null,
        fallbackModels: [],
        bind: 'loopback',
        authMode: 'token',
        channels: ['telegram'],
        memorySearchEnabled: true,
        browserHeadless: null,
        browserNoSandbox: null,
        notes: ['memory search 已启用。', '面向医生助手场景。'],
      },
      health: {
        serviceActive: 'active',
        serviceExitCode: 0,
        listenerExitCode: 0,
      },
      controlCenter: {
        uiPort: 4312,
        baseUrl: 'http://127.0.0.1:4312/?section=overview&lang=zh',
        ready: false,
        launchable: true,
        repoPath: 'openclaw-control-center',
        runtimeDir: 'runtime/doctor',
      },
      issues: ['Control Center 还未启动。'],
    },
  ],
};

async function invokeOrDemo<T>(command: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isTauri()) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${command} 只能在 Tauri 环境中调用。`);
  }

  return invoke<T>(command, args);
}

export function bootstrapManagerRuntime() {
  return invokeOrDemo<ManagerState>('bootstrap_manager_runtime', undefined, DEMO_STATE);
}

export function getManagerState() {
  return invokeOrDemo<ManagerState>('get_manager_state', undefined, DEMO_STATE);
}

export function performGatewayAction(gatewayId: string, action: 'start' | 'stop' | 'restart') {
  return invokeOrDemo<string>(
    'perform_gateway_action',
    { gatewayId, action },
    `${action} ${gatewayId}`,
  );
}

export function createManagedGateway(request: CreateManagedGatewayRequest) {
  const fallback: CreateManagedGatewayResponse = {
    gatewayId: request.gatewayId ?? 'demo-gateway',
    label: request.label,
    profile: request.profile ?? request.gatewayId ?? 'demo-gateway',
    serviceName: 'openclaw-gateway-demo.service',
    stateDir: '/root/.openclaw-demo',
    workspaceDir: '/root/.openclaw-demo/workspace',
    port: request.port ?? 18810,
    controlCenterPort: 4320,
    notes: ['Browser preview mode returns a simulated gateway response.'],
  };
  return invokeOrDemo<CreateManagedGatewayResponse>(
    'create_managed_gateway',
    { request },
    fallback,
  );
}

export function getGatewayLogs(gatewayId: string, lines = 160) {
  const fallback: GatewayLogResponse = {
    gatewayId,
    lines: [
      '[demo] openclaw manager is running in browser preview mode',
      '[demo] launch the Tauri app to inspect live gateway logs',
    ],
  };
  return invokeOrDemo<GatewayLogResponse>('get_gateway_logs', { gatewayId, lines }, fallback);
}

export function ensureControlCenter(gatewayId: string) {
  const fallback = DEMO_STATE.gateways.find((gateway) => gateway.id === gatewayId)?.controlCenter;
  if (!fallback) {
    throw new Error(`Unknown gateway: ${gatewayId}`);
  }
  return invokeOrDemo<ControlCenterStatus>('ensure_control_center', { gatewayId }, fallback);
}

export function getNativeWorkbenchData(gatewayId: string) {
  const gateway = DEMO_STATE.gateways.find((item) => item.id === gatewayId) ?? DEMO_STATE.gateways[0];
  const fallback: NativeWorkbenchData = {
    gatewayId: gateway.id,
    fetchedAt: new Date().toISOString(),
    ready: gateway.controlCenter.ready,
    launchable: gateway.controlCenter.launchable,
    uiPort: gateway.controlCenter.uiPort,
    baseUrl: gateway.controlCenter.baseUrl,
    warnings: gateway.controlCenter.ready ? [] : ['Control Center runtime is not ready in browser preview mode.'],
    snapshot: {
      sessions: [],
      statuses: [],
      cronJobs: [],
      approvals: [],
      projects: {
        projects: [],
        updatedAt: new Date(0).toISOString(),
      },
      projectSummaries: [],
      tasks: {
        tasks: [],
        updatedAt: new Date(0).toISOString(),
      },
      tasksSummary: {
        projects: 0,
        tasks: 0,
        todo: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
        owners: 0,
        artifacts: 0,
      },
      budgetSummary: {
        total: 0,
        ok: 0,
        warn: 0,
        over: 0,
        evaluations: [],
      },
      generatedAt: new Date().toISOString(),
    },
    usage: null,
    queue: null,
    projects: null,
    tasks: null,
    sessions: null,
    health: null,
    docs: [],
    memory: [],
  };

  return invokeOrDemo<NativeWorkbenchData>('get_native_workbench_data', { gatewayId }, fallback);
}

export function getWorkbenchFileContent(gatewayId: string, scope: WorkbenchScope, path: string) {
  const fallback: WorkbenchFileContent = {
    gatewayId,
    scope,
    path,
    content: 'Browser preview mode does not mount live workspace files.',
    updatedAt: new Date().toISOString(),
  };
  return invokeOrDemo<WorkbenchFileContent>(
    'get_workbench_file_content',
    { gatewayId, scope, path },
    fallback,
  );
}

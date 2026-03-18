import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Bot,
  Cable,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderOpen,
  Globe2,
  Orbit,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Settings2,
  Shield,
  Square,
  TerminalSquare,
  Waypoints,
} from 'lucide-react';
import { appLogger } from './lib/logger';
import {
  bootstrapManagerRuntime,
  ensureControlCenter,
  getGatewayLogs,
  getManagerState,
  getNativeWorkbenchData,
  performGatewayAction,
  type GatewayLogResponse,
  type GatewaySummary,
  type ManagerState,
  type NativeWorkbenchData,
} from './lib/manager-api';
import { CreateGatewayModal } from './components/create-gateway-modal';
import { NativeWorkbenchPanel } from './components/native-workbench-panel';

export type PageType = string;

export interface EnvironmentStatus {
  node_installed: boolean;
  node_version: string | null;
  node_version_ok: boolean;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  config_dir_exists: boolean;
  ready: boolean;
  os: string;
}

type ManagerPage = 'overview' | 'workbench' | 'logs' | 'configs';
type GatewayAction = 'start' | 'stop' | 'restart';
type ControlCenterSection =
  | 'overview'
  | 'usage-cost'
  | 'staff'
  | 'tasks'
  | 'team'
  | 'collaboration'
  | 'projects-tasks'
  | 'docs'
  | 'memory'
  | 'alerts'
  | 'settings';
type LanguageMode = 'zh' | 'en';

interface ToastState {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface AccentPalette {
  solid: string;
  soft: string;
  ink: string;
}

type LocalizedCopy = Record<LanguageMode, string>;

const PAGE_ITEMS: { id: ManagerPage; label: LocalizedCopy; caption: LocalizedCopy; icon: typeof Orbit }[] = [
  { id: 'overview', label: { zh: '总览', en: 'Overview' }, caption: { zh: '所有 gateway 汇总视图', en: 'All gateways in one board' }, icon: Orbit },
  { id: 'workbench', label: { zh: '工作台', en: 'Workbench' }, caption: { zh: '嵌入式 control center', en: 'Embedded control centers' }, icon: Bot },
  { id: 'logs', label: { zh: '日志', en: 'Logs' }, caption: { zh: '运行态与排障输出', en: 'Runtime and troubleshooting output' }, icon: ScrollText },
  { id: 'configs', label: { zh: '配置', en: 'Configs' }, caption: { zh: '模型、渠道、路径与运行态', en: 'Models, channels, paths, runtime' }, icon: Settings2 },
];

const CONTROL_CENTER_SECTIONS: {
  id: ControlCenterSection;
  label: LocalizedCopy;
  note: LocalizedCopy;
  icon: typeof Orbit;
}[] = [
  { id: 'overview', label: { zh: '总览', en: 'Overview' }, note: { zh: '健康状态、风险与待办', en: 'Health, risks, pending items' }, icon: Orbit },
  { id: 'usage-cost', label: { zh: '用量', en: 'Usage' }, note: { zh: '成本、额度与上下文压力', en: 'Spend, quota, context pressure' }, icon: Activity },
  { id: 'staff', label: { zh: '成员', en: 'Staff' }, note: { zh: '谁在工作、谁在排队', en: 'Who is working and who is queued' }, icon: Bot },
  { id: 'tasks', label: { zh: '任务', en: 'Tasks' }, note: { zh: '执行链、审批与证据', en: 'Execution chains, approvals, evidence' }, icon: Waypoints },
  { id: 'docs', label: { zh: '文档', en: 'Docs' }, note: { zh: '来源文档与运行手册', en: 'Source docs and runbooks' }, icon: FolderOpen },
  { id: 'memory', label: { zh: '记忆', en: 'Memory' }, note: { zh: '日报记忆与长期状态', en: 'Daily memory and long-term state' }, icon: Search },
  { id: 'settings', label: { zh: '设置', en: 'Settings' }, note: { zh: '连接状态与安全闸门', en: 'Connection state and safety gates' }, icon: Shield },
];

void CONTROL_CENTER_SECTIONS;

const ACCENTS: Record<string, AccentPalette> = {
  main: { solid: '#ff7a59', soft: '#ffe6d8', ink: '#4b220d' },
  'gateway-lxgnews': { solid: '#16a085', soft: '#dcf7ef', ink: '#07372d' },
  doctor: { solid: '#f2c94c', soft: '#fff4cb', ink: '#4f3905' },
};

const WORKBENCH_SECTIONS: {
  id: ControlCenterSection;
  label: LocalizedCopy;
  note: LocalizedCopy;
  icon: typeof Orbit;
}[] = [
  { id: 'overview', label: { zh: '总览', en: 'Overview' }, note: { zh: '健康状态、风险与待办', en: 'Health, risks, pending items' }, icon: Orbit },
  { id: 'usage-cost', label: { zh: '用量', en: 'Usage' }, note: { zh: '成本、额度与上下文压力', en: 'Spend, quota, context pressure' }, icon: Activity },
  { id: 'team', label: { zh: '成员', en: 'Staff' }, note: { zh: '谁在工作、谁在排队', en: 'Who is working and who is queued' }, icon: Bot },
  { id: 'collaboration', label: { zh: '协作', en: 'Collaboration' }, note: { zh: '交接链路、协作信号与上下游', en: 'Handoffs, collaboration signals, upstream links' }, icon: Cable },
  { id: 'projects-tasks', label: { zh: '任务', en: 'Tasks' }, note: { zh: '任务板、排期与执行证据', en: 'Boards, schedules, and execution evidence' }, icon: Waypoints },
  { id: 'docs', label: { zh: '文档', en: 'Docs' }, note: { zh: '来源文档与运行手册', en: 'Source docs and runbooks' }, icon: FolderOpen },
  { id: 'memory', label: { zh: '记忆', en: 'Memory' }, note: { zh: '日报记忆与长期状态', en: 'Daily memory and long-term state' }, icon: Search },
  { id: 'alerts', label: { zh: '告警', en: 'Alerts' }, note: { zh: '异常流、通知与需要介入的项', en: 'Exceptions, notifications, and items needing action' }, icon: AlertTriangle },
  { id: 'settings', label: { zh: '设置', en: 'Settings' }, note: { zh: '连接状态与安全闸门', en: 'Connection state and safety gates' }, icon: Shield },
];

function paletteFor(gatewayId: string): AccentPalette {
  const existing = ACCENTS[gatewayId];
  if (existing) {
    return existing;
  }

  let hash = 0;
  for (const ch of gatewayId) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  }
  const hue = (hash + 360) % 360;
  return {
    solid: `hsl(${hue} 78% 58%)`,
    soft: `hsl(${hue} 100% 95%)`,
    ink: `hsl(${hue} 54% 18%)`,
  };
}

function isGatewayHealthy(gateway: GatewaySummary) {
  return gateway.service.activeState === 'active' && gateway.service.portListening;
}

function copyFor(languageMode: LanguageMode, copy: LocalizedCopy) {
  return copy[languageMode];
}

function gatewayModeLabel(gateway: GatewaySummary, languageMode: LanguageMode) {
  if (isGatewayHealthy(gateway)) {
    return languageMode === 'zh' ? '在线' : 'Live';
  }
  if (gateway.service.activeState === 'activating') {
    return languageMode === 'zh' ? '启动中' : 'Booting';
  }
  return languageMode === 'zh' ? '离线' : 'Offline';
}

function formatGeneratedAt(value: string | null, languageMode: LanguageMode) {
  if (!value) {
    return languageMode === 'zh' ? '刚刚' : 'just now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(languageMode === 'zh' ? 'zh-CN' : 'en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toneLabel(messageCount: number, languageMode: LanguageMode) {
  if (messageCount === 0) {
    return languageMode === 'zh' ? '清爽' : 'Clear';
  }
  if (messageCount <= 2) {
    return languageMode === 'zh' ? '留意' : 'Watch';
  }
  return languageMode === 'zh' ? '处理' : 'Action';
}

function joinLabels(items: string[], languageMode: LanguageMode) {
  if (items.length === 0) {
    return languageMode === 'zh' ? '未配置' : 'Not configured';
  }
  return items.join(' / ');
}

function summaryMetric(state: ManagerState) {
  const totalGateways = state.gateways.length;
  const online = state.gateways.filter(isGatewayHealthy).length;
  const workbenches = state.gateways.filter((gateway) => gateway.controlCenter.ready).length;
  const channels = new Set(state.gateways.flatMap((gateway) => gateway.config.channels)).size;
  const issues = state.gateways.reduce((total, gateway) => total + gateway.issues.length, 0);
  return { totalGateways, online, workbenches, channels, issues };
}

function gatewayStyle(gatewayId: string): CSSProperties {
  const palette = paletteFor(gatewayId);
  return {
    '--gateway-solid': palette.solid,
    '--gateway-soft': palette.soft,
    '--gateway-ink': palette.ink,
  } as CSSProperties;
}

function App() {
  const [currentPage, setCurrentPage] = useState<ManagerPage>('overview');
  const [managerState, setManagerState] = useState<ManagerState | null>(null);
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null);
  const [controlCenterSection, setControlCenterSection] = useState<ControlCenterSection>('overview');
  const [languageMode, setLanguageMode] = useState<LanguageMode>('zh');
  const [logs, setLogs] = useState<string[]>([]);
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionByGateway, setActionByGateway] = useState<Record<string, GatewayAction | undefined>>({});
  const [workbenchBooting, setWorkbenchBooting] = useState<Record<string, boolean>>({});
  const [workbenchDataByGateway, setWorkbenchDataByGateway] = useState<Record<string, NativeWorkbenchData | undefined>>({});
  const [workbenchLoadingByGateway, setWorkbenchLoadingByGateway] = useState<Record<string, boolean>>({});
  const [isCreateGatewayOpen, setIsCreateGatewayOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const logStreamRef = useRef<HTMLPreElement | null>(null);

  const selectedGateway =
    managerState?.gateways.find((gateway) => gateway.id === selectedGatewayId) ?? managerState?.gateways[0] ?? null;
  const t = (zh: string, en: string) => (languageMode === 'zh' ? zh : en);

  function actionLabel(action: GatewayAction) {
    if (action === 'start') {
      return t('启动', 'Start');
    }
    if (action === 'restart') {
      return t('重启', 'Restart');
    }
    return t('停止', 'Stop');
  }

  async function refreshState(mode: 'bootstrap' | 'poll' | 'manual' = 'poll') {
    if (mode === 'manual') {
      setIsRefreshing(true);
    }

    try {
      const nextState = mode === 'bootstrap' ? await bootstrapManagerRuntime() : await getManagerState();
      setManagerState(nextState);
      setErrorMessage(null);
      setSelectedGatewayId((current) => {
        if (current && nextState.gateways.some((gateway) => gateway.id === current)) {
          return current;
        }
        return nextState.gateways[0]?.id ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Failed to refresh manager state', error);
      setErrorMessage(message);
    } finally {
      setIsBootstrapping(false);
      setIsRefreshing(false);
    }
  }

  async function loadGatewayLogs(gatewayId: string) {
    setLogsLoading(true);
    try {
      const response: GatewayLogResponse = await getGatewayLogs(gatewayId, 220);
      setLogs(response.lines);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Failed to read gateway logs', error);
      setLogs([`${t('读取日志失败', 'Failed to read logs')}: ${message}`]);
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadWorkbenchData(gatewayId: string) {
    setWorkbenchLoadingByGateway((current) => ({ ...current, [gatewayId]: true }));
    try {
      const payload = await getNativeWorkbenchData(gatewayId);
      setWorkbenchDataByGateway((current) => ({ ...current, [gatewayId]: payload }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Failed to load native workbench data', error);
      setToast({
        tone: 'error',
        message,
      });
    } finally {
      setWorkbenchLoadingByGateway((current) => {
        const next = { ...current };
        delete next[gatewayId];
        return next;
      });
    }
  }

  async function handleGatewayAction(gatewayId: string, action: GatewayAction) {
    setActionByGateway((current) => ({ ...current, [gatewayId]: action }));
    try {
      await performGatewayAction(gatewayId, action);
      setToast({
        tone: 'success',
        message: `${gatewayId} ${actionLabel(action)}${t('完成', ' completed.')}`,
      });
      await refreshState('manual');
      if (currentPage === 'logs') {
        await loadGatewayLogs(gatewayId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({
        tone: 'error',
        message,
      });
    } finally {
      setActionByGateway((current) => {
        const next = { ...current };
        delete next[gatewayId];
        return next;
      });
    }
  }

  async function handleEnsureControlCenter(gatewayId: string) {
    setWorkbenchBooting((current) => ({ ...current, [gatewayId]: true }));
    try {
      await ensureControlCenter(gatewayId);
      const gatewayLabel =
        managerState?.gateways.find((gateway) => gateway.id === gatewayId)?.label ?? gatewayId;
      setSelectedGatewayId(gatewayId);
      setCurrentPage('workbench');
      setToast({
        tone: 'success',
        message: t(`${gatewayLabel} 控制台已就绪`, `${gatewayLabel} control center is ready.`),
      });
      await refreshState('manual');
      await loadWorkbenchData(gatewayId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({
        tone: 'error',
        message,
      });
    } finally {
      setWorkbenchBooting((current) => {
        const next = { ...current };
        delete next[gatewayId];
        return next;
      });
    }
  }

  async function handleGatewayCreated(result: {
    gatewayId: string;
    label: string;
    port: number;
    controlCenterPort: number;
  }) {
    setIsCreateGatewayOpen(false);
    setToast({
      tone: 'success',
      message: t(
        `${result.label} 已创建，WSL 端口 ${result.port}，控制台端口 ${result.controlCenterPort}。`,
        `${result.label} created on WSL port ${result.port} with control center port ${result.controlCenterPort}.`,
      ),
    });
    await refreshState('manual');
    setSelectedGatewayId(result.gatewayId);
    setCurrentPage('overview');
  }

  function openWorkbenchSection(sectionId: ControlCenterSection, gatewayId?: string) {
    if (gatewayId) {
      setSelectedGatewayId(gatewayId);
    }
    setControlCenterSection(sectionId);
    setCurrentPage('workbench');
  }

  useEffect(() => {
    void refreshState('bootstrap');
    const interval = window.setInterval(() => {
      void refreshState('poll');
    }, 8000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedGateway || currentPage !== 'logs') {
      return;
    }

    void loadGatewayLogs(selectedGateway.id);
  }, [currentPage, selectedGatewayId]);

  useEffect(() => {
    if (!selectedGateway || currentPage !== 'logs' || !logsAutoRefresh) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadGatewayLogs(selectedGateway.id);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentPage, selectedGatewayId, logsAutoRefresh]);

  useEffect(() => {
    if (currentPage !== 'logs' || !logsAutoRefresh || !logStreamRef.current) {
      return;
    }

    logStreamRef.current.scrollTop = 0;
  }, [logs, currentPage, logsAutoRefresh]);

  useEffect(() => {
    if (!selectedGateway || currentPage !== 'workbench') {
      return;
    }

    void loadWorkbenchData(selectedGateway.id);
    const interval = window.setInterval(() => {
      void loadWorkbenchData(selectedGateway.id);
    }, 12000);

    return () => window.clearInterval(interval);
  }, [currentPage, selectedGatewayId]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = managerState ? summaryMetric(managerState) : null;

  function renderOverviewPage() {
    if (!managerState || !metrics) {
      return null;
    }

    return (
      <div className="page-stack">
        <section className="hero-grid">
          <motion.article
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="paper-card hero-card"
          >
            <div className="section-chip">{t('总控看板', 'Mission Board')}</div>
            <h2>{t('多条 gateway 车道，一套统一管理台。', 'Multiple gateway lanes, one manager shell.')}</h2>
            <p>
              {t(
                '这一版会从 WSL 读取真实 gateway 清单，把每个 gateway 当成独立账号车道来管理，让你在一个窗口里完成启动、检查和切换到对应 control center。',
                'This build reads the managed gateway manifest from WSL, treats each gateway as its own account lane, and gives you one place to start, inspect, and jump into the right control center.',
              )}
            </p>
            <div className="hero-actions">
              <button className="action-button primary" onClick={() => setCurrentPage('workbench')}>
                {t('打开工作台', 'Open workbench')}
              </button>
              <button className="action-button secondary" onClick={() => setCurrentPage('configs')}>
                {t('查看配置', 'Review configs')}
              </button>
            </div>
          </motion.article>

          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-label">{t('在线 gateway', 'Gateways online')}</span>
              <strong>{metrics.online}/{metrics.totalGateways}</strong>
              <p>{t('服务状态和监听端口都正常。', 'Service state and port listener both healthy.')}</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{t('工作台就绪', 'Workbenches ready')}</span>
              <strong>{metrics.workbenches}/{metrics.totalGateways}</strong>
              <p>{t('嵌入式 control center 已可直接打开。', 'Embedded control centers available now.')}</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{t('渠道类型', 'Channel types')}</span>
              <strong>{metrics.channels}</strong>
              <p>{t('所有 gateway 合并后的渠道类型数。', 'Unique message channel kinds across all gateways.')}</p>
            </article>
            <article className="metric-card warn">
              <span className="metric-label">{t('待处理提示', 'Follow-up hints')}</span>
              <strong>{toneLabel(metrics.issues, languageMode)}</strong>
              <p>{t(`当前还有 ${metrics.issues} 条配置或健康提示。`, `${metrics.issues} config or health notes still surfaced.`)}</p>
            </article>
          </div>
        </section>

        <section className="page-section">
          <div className="section-heading">
            <div>
              <h3>{t('多账号式 gateway 车道', 'Account-style gateway lanes')}</h3>
              <p>{t('每张卡片都对应一套真实 WSL gateway，不是假的 profile 壳子。', 'Each card is a real WSL gateway, not a fake profile shell.')}</p>
            </div>
          </div>
          <div className="gateway-grid">
            {managerState.gateways.map((gateway) => {
              const palette = paletteFor(gateway.id);
              return (
                <motion.article
                  key={gateway.id}
                  whileHover={{ y: -4 }}
                  className={`paper-card gateway-card ${selectedGatewayId === gateway.id ? 'selected' : ''}`}
                  style={gatewayStyle(gateway.id)}
                  onClick={() => setSelectedGatewayId(gateway.id)}
                >
                  <div className="gateway-topline">
                    <span className="gateway-pill" style={{ backgroundColor: palette.soft, color: palette.ink }}>
                      {gatewayModeLabel(gateway, languageMode)}
                    </span>
                    <span className="tiny-note">{t('端口', 'Port')} {gateway.port}</span>
                  </div>
                  <h4>{gateway.label}</h4>
                  <p className="gateway-summary">
                    {gateway.config.primaryModel ?? t('模型来自实例配置', 'Model comes from instance config')} · {joinLabels(gateway.config.channels, languageMode)}
                  </p>
                  <div className="gateway-meta">
                    <div>
                      <span>{t('服务', 'Service')}</span>
                      <strong>{gateway.serviceName}</strong>
                    </div>
                    <div>
                      <span>{t('工作台', 'Workbench')}</span>
                      <strong>{gateway.controlCenter.ready ? t('已嵌入', 'Embedded') : t('需要启动', 'Start needed')}</strong>
                    </div>
                  </div>
                  {gateway.issues.length > 0 ? (
                    <ul className="issue-list">
                      {gateway.issues.slice(0, 3).map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="issue-ok">
                      <CheckCircle2 size={16} />
                      {t('这个 gateway 目前没有额外提示。', 'No extra follow-up hints on this gateway.')}
                    </div>
                  )}
                  <div className="card-actions">
                    <button
                      className="mini-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedGatewayId(gateway.id);
                        setCurrentPage('workbench');
                      }}
                    >
                      {t('进入', 'Enter')}
                    </button>
                    <button
                      className="mini-button ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleEnsureControlCenter(gateway.id);
                      }}
                    >
                      {workbenchBooting[gateway.id]
                        ? t('启动中...', 'Booting...')
                        : gateway.controlCenter.ready
                          ? t('重新连接', 'Reconnect')
                          : t('启动工作台', 'Start workbench')}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="page-section">
          <div className="section-heading">
            <div>
              <h3>{t('Control Center 模块', 'Control center modules')}</h3>
              <p>{t('这里的嵌入分区按照本地 control center README 的优先级来组织。', 'The embedded sections mirror the README priorities from the local control center repo.')}</p>
            </div>
          </div>
          <div className="module-grid">
            {WORKBENCH_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className="module-card module-button"
                  onClick={() => openWorkbenchSection(section.id)}
                >
                  <div className="module-icon">
                    <Icon size={18} />
                  </div>
                  <div>
                    <strong>{copyFor(languageMode, section.label)}</strong>
                    <p>{copyFor(languageMode, section.note)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderWorkbenchPage() {
    if (!selectedGateway) {
      return null;
    }

    const currentSection =
      WORKBENCH_SECTIONS.find((section) => section.id === controlCenterSection) ?? WORKBENCH_SECTIONS[0];
    const nativeWorkbenchData = workbenchDataByGateway[selectedGateway.id] ?? null;
    const workbenchLoading = Boolean(workbenchLoadingByGateway[selectedGateway.id]);

    return (
      <div className="page-stack">
        <section className="paper-card workbench-hero" style={gatewayStyle(selectedGateway.id)}>
          <div className="workbench-hero-copy">
            <div className="section-chip">{t('内嵌工作台', 'Embedded workbench')}</div>
            <h3>{t(`${selectedGateway.label} 控制台`, `${selectedGateway.label} control desk`)}</h3>
            <p>
              {t(
                '直接在 App 里切分区、看内容、做调试，不再把“浏览器打开”当成主路径。上面的 gateway 轨道负责切账号，这里负责直接干活。',
                'Stay inside the app for section switches, debugging, and review. The gateway rail above handles account switching, and this surface is where the work happens.',
              )}
            </p>
          </div>

          <div className="workbench-hero-meta">
            <div className="quick-chip">
              <TerminalSquare size={14} />
              ws://127.0.0.1:{selectedGateway.port}
            </div>
            <div className="quick-chip">
              <Cable size={14} />
              {gatewayModeLabel(selectedGateway, languageMode)}
            </div>
            <div className="quick-chip">
              <Bot size={14} />
              {joinLabels(selectedGateway.config.channels, languageMode)}
            </div>
          </div>

          <div className="workbench-hero-actions">
            <button
              className="action-button primary"
              onClick={() =>
                selectedGateway.controlCenter.ready
                  ? void loadWorkbenchData(selectedGateway.id)
                  : void handleEnsureControlCenter(selectedGateway.id)
              }
            >
              {workbenchBooting[selectedGateway.id]
                ? t('启动中...', 'Booting...')
                : selectedGateway.controlCenter.ready
                  ? t('刷新数据', 'Refresh data')
                  : t('启动数据源', 'Start data source')}
            </button>
            <button className="action-button secondary" onClick={() => setCurrentPage('configs')}>
              {t('查看配置', 'View configs')}
            </button>
            <button className="action-button secondary" onClick={() => setCurrentPage('logs')}>
              {t('查看日志', 'View logs')}
            </button>
          </div>
        </section>

        <section className="paper-card workbench-frame workbench-frame-shell">
          <div className="frame-toolbar workbench-frame-toolbar">
            <div>
              <div className="section-chip">Control Center</div>
              <h3>{copyFor(languageMode, currentSection.label)}</h3>
              <p>{copyFor(languageMode, currentSection.note)}</p>
            </div>
            <div className="workbench-frame-note">
              {t('直接在 App 内切换分区', 'Switch sections directly inside the app')}
            </div>
          </div>

          <div className="workbench-tabstrip" role="tablist" aria-label={t('控制中心分区', 'Control center sections')}>
            {WORKBENCH_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`workbench-tab ${controlCenterSection === section.id ? 'active' : ''}`}
                  onClick={() => setControlCenterSection(section.id)}
                >
                  <Icon size={16} />
                  <span>{copyFor(languageMode, section.label)}</span>
                </button>
              );
            })}
          </div>

          <NativeWorkbenchPanel
            gateway={selectedGateway}
            section={controlCenterSection}
            languageMode={languageMode}
            data={nativeWorkbenchData}
            loading={workbenchLoading}
            booting={Boolean(workbenchBooting[selectedGateway.id])}
            onNavigateSection={(section) => setControlCenterSection(section)}
            onEnsureControlCenter={() => void handleEnsureControlCenter(selectedGateway.id)}
          />
        </section>
      </div>
    );

    /*
    return (
      <div className="workbench-layout">
        <aside className="workbench-sidebar">
          <section className="paper-card gateway-profile" style={gatewayStyle(selectedGateway.id)}>
            <div className="section-chip">{t('工作区', 'Workspace')}</div>
            <h3>{selectedGateway.label}</h3>
            <p>
              {t(
                '这里是当前选中的 gateway 车道。你可以在同一个 Manager 窗口里切换账号轨道，不用来回重开多个应用。',
                'This is the selected gateway lane. Stay inside one manager window, switch the account rail on top, and keep debugging without relaunching separate apps.',
              )}
            </p>
            <dl className="detail-list">
              <div>
                <dt>{t('网关', 'Gateway')}</dt>
                <dd>ws://127.0.0.1:{selectedGateway.port}</dd>
              </div>
              <div>
                <dt>{t('工作区', 'Workspace')}</dt>
                <dd>{selectedGateway.workspaceDir}</dd>
              </div>
              <div>
                <dt>{t('状态', 'Status')}</dt>
                <dd>{gatewayModeLabel(selectedGateway, languageMode)}</dd>
              </div>
              <div>
                <dt>{t('渠道', 'Channels')}</dt>
                <dd>{joinLabels(selectedGateway.config.channels, languageMode)}</dd>
              </div>
            </dl>
            <div className="stack-actions">
              <button
                className="action-button primary"
                onClick={() => void handleEnsureControlCenter(selectedGateway.id)}
              >
                {workbenchBooting[selectedGateway.id]
                  ? t('启动中...', 'Booting...')
                  : selectedGateway.controlCenter.ready
                    ? t('刷新工作台', 'Refresh workbench')
                    : t('启动工作台', 'Start workbench')}
              </button>
              <a className="action-button secondary" href={iframeUrl} target="_blank" rel="noreferrer">
                {t('浏览器打开', 'Open in browser')}
              </a>
            </div>
          </section>

          <section className="paper-card">
            <div className="section-chip">{t('分区', 'Sections')}</div>
            <h3>{t('嵌入式 control center 视图', 'Embedded control center views')}</h3>
            <div className="section-list">
              {WORKBENCH_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    className={`section-button ${controlCenterSection === section.id ? 'active' : ''}`}
                    onClick={() => setControlCenterSection(section.id)}
                  >
                    <Icon size={16} />
                    <div className="section-copy">
                      <span>{copyFor(languageMode, section.label)}</span>
                      <small>{copyFor(languageMode, section.note)}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="paper-card workbench-frame">
          <div className="frame-toolbar">
            <div>
              <div className="section-chip">Control Center</div>
              <h3>{t(`${selectedGateway.label} 嵌入式控制台`, `${selectedGateway.label} embedded console`)}</h3>
            </div>
            <div className="toolbar-actions">
              <a className="icon-link" href={iframeUrl} target="_blank" rel="noreferrer" title={t('新窗口打开', 'Open in new window')}>
                <ExternalLink size={18} />
              </a>
            </div>
          </div>

          {selectedGateway.controlCenter.ready ? (
            <iframe
              key={`${selectedGateway.id}-${controlCenterSection}-${languageMode}-${selectedGateway.controlCenter.uiPort}`}
              className="control-center-frame"
              src={iframeUrl}
              title={`${selectedGateway.label} control center`}
            />
          ) : (
            <div className="frame-empty">
              <Bot size={24} />
              <h4>{t('工作台还没有启动。', 'Workbench is not running yet.')}</h4>
              <p>
                {t(
                  'Manager 已经知道正确的 gateway 端口、workspace 根目录、state dir 和 runtime dir。现在只差把这条车道对应的 control center 进程拉起来。',
                  'The manager already knows the correct gateway port, workspace root, state dir, and runtime dir. The last missing step is starting the control center instance for this lane.',
                )}
              </p>
              <button
                className="action-button primary"
                onClick={() => void handleEnsureControlCenter(selectedGateway.id)}
              >
                {workbenchBooting[selectedGateway.id] ? t('启动中...', 'Starting...') : t('启动并嵌入', 'Start and embed')}
              </button>
            </div>
          )}
        </section>
      </div>
    );
    */
  }

  function renderLogsPage() {
    if (!selectedGateway) {
      return null;
    }
    return (
      <div className="page-stack">
        <section className="paper-card log-header" style={gatewayStyle(selectedGateway.id)}>
          <div>
            <div className="section-chip">{t('日志', 'Logs')}</div>
            <h3>{t(`${selectedGateway.label} 输出流`, `${selectedGateway.label} output stream`)}</h3>
            <p>
              {t(
                '这个视图会直接尾随读取 gateway 状态日志，适合做真实排障：监听异常、服务退出、渠道失败和其他运行线索。',
                'This view tails the gateway state logs from disk. It is meant for real debugging: listener problems, service exits, channel failures, and other runtime clues.',
              )}
            </p>
          </div>
          <div className="stack-actions inline">
            <button
              className="action-button secondary"
              onClick={() => setLogsAutoRefresh((current) => !current)}
            >
              {logsAutoRefresh ? <Pause size={16} /> : <Play size={16} />}
              {logsAutoRefresh ? t('鏆傚仠鑷姩鍒锋柊', 'Pause live updates') : t('鎭㈠鑷姩鍒锋柊', 'Resume live updates')}
            </button>
            <button className="action-button secondary" onClick={() => void loadGatewayLogs(selectedGateway.id)}>
              {logsLoading ? t('刷新中...', 'Refreshing...') : t('刷新日志', 'Refresh logs')}
            </button>
          </div>
        </section>

        <section className="paper-card log-panel">
          <div className="log-toolbar">
            <span>{t(`最近 ${logs.length} 行`, `Latest ${logs.length} lines`)}</span>
            <span>{logsLoading ? t('加载中...', 'Loading...') : t('已同步', 'Synced')}</span>
          </div>
          <pre className="log-stream">{logs.length > 0 ? logs.join('\n') : t('暂时还没有日志。', 'No log lines are available yet.')}</pre>
        </section>
      </div>
    );
  }

  void renderLogsPage;

  function renderLiveLogsPage() {
    if (!selectedGateway) {
      return null;
    }

    const displayLogs = [...logs].reverse();

    return (
      <div className="page-stack">
        <section className="paper-card log-header" style={gatewayStyle(selectedGateway.id)}>
          <div>
            <div className="section-chip">{t('日志', 'Logs')}</div>
            <h3>{t(`${selectedGateway.label} 运行日志`, `${selectedGateway.label} runtime stream`)}</h3>
            <p>
              {t(
                '这里会持续追踪当前 gateway 的实时运行日志。最新内容固定显示在最上面，方便你第一眼看到最新事件。',
                'This view continuously tails the selected gateway runtime. Newest entries stay pinned at the top so the latest events are visible first.',
              )}
            </p>
          </div>
          <div className="stack-actions inline">
            <button
              className="action-button secondary"
              onClick={() => setLogsAutoRefresh((current) => !current)}
            >
              {logsAutoRefresh ? <Pause size={16} /> : <Play size={16} />}
              {logsAutoRefresh ? t('暂停自动刷新', 'Pause live updates') : t('恢复自动刷新', 'Resume live updates')}
            </button>
            <button className="action-button secondary" onClick={() => void loadGatewayLogs(selectedGateway.id)}>
              {logsLoading ? t('刷新中...', 'Refreshing...') : t('立即刷新', 'Refresh now')}
            </button>
          </div>
        </section>

        <section className="paper-card log-panel">
          <div className="log-toolbar">
            <span>{t(`最新 ${displayLogs.length} 行，顶部为最新`, `Newest ${displayLogs.length} lines, latest first`)}</span>
            <span>
              {logsLoading
                ? t('加载中...', 'Loading...')
                : logsAutoRefresh
                  ? t('自动刷新已开启', 'Live updates on')
                  : t('已暂停刷新', 'Updates paused')}
            </span>
          </div>
          <pre ref={logStreamRef} className="log-stream">
            {displayLogs.length > 0 ? displayLogs.join('\n') : t('暂时还没有日志。', 'No log lines are available yet.')}
          </pre>
        </section>
      </div>
    );
  }

  function renderConfigsPage() {
    if (!selectedGateway) {
      return null;
    }

    return (
      <div className="page-stack">
        <section className="config-grid">
          <article className="paper-card">
            <div className="section-chip">{t('运行态', 'Runtime')}</div>
            <h3>{t('服务运行态', 'Service runtime')}</h3>
            <dl className="detail-list">
              <div>
                <dt>{t('服务', 'Service')}</dt>
                <dd>{selectedGateway.serviceName}</dd>
              </div>
              <div>
                <dt>{t('激活状态', 'Active')}</dt>
                <dd>{selectedGateway.service.activeState} / {selectedGateway.service.subState}</dd>
              </div>
              <div>
                <dt>{t('单元文件', 'Unit')}</dt>
                <dd>{selectedGateway.service.unitFileState}</dd>
              </div>
              <div>
                <dt>PID</dt>
                <dd>{selectedGateway.service.mainPid ?? 'n/a'}</dd>
              </div>
            </dl>
          </article>

          <article className="paper-card">
            <div className="section-chip">{t('模型与渠道', 'Model & Channels')}</div>
            <h3>{t('模型与渠道', 'Model and channels')}</h3>
            <dl className="detail-list">
              <div>
                <dt>{t('主模型', 'Primary')}</dt>
                <dd>{selectedGateway.config.primaryModel ?? t('继承实例默认值', 'Inherited from instance defaults')}</dd>
              </div>
              <div>
                <dt>{t('回退模型', 'Fallbacks')}</dt>
                <dd>{selectedGateway.config.fallbackModels.length > 0 ? selectedGateway.config.fallbackModels.join(', ') : t('无', 'None')}</dd>
              </div>
              <div>
                <dt>{t('渠道', 'Channels')}</dt>
                <dd>{joinLabels(selectedGateway.config.channels, languageMode)}</dd>
              </div>
              <div>
                <dt>{t('记忆检索', 'Memory search')}</dt>
                <dd>{selectedGateway.config.memorySearchEnabled ? t('已启用', 'enabled') : t('未启用', 'disabled')}</dd>
              </div>
            </dl>
          </article>

          <article className="paper-card">
            <div className="section-chip">{t('路径', 'Paths')}</div>
            <h3>{t('路径与配置档', 'Paths and profile')}</h3>
            <dl className="detail-list">
              <div>
                <dt>{t('状态目录', 'State dir')}</dt>
                <dd>{selectedGateway.stateDir}</dd>
              </div>
              <div>
                <dt>{t('工作区', 'Workspace')}</dt>
                <dd>{selectedGateway.workspaceDir}</dd>
              </div>
              <div>
                <dt>{t('配置档', 'Profile')}</dt>
                <dd>{selectedGateway.profile ?? t('默认', 'default')}</dd>
              </div>
              <div>
                <dt>{t('浏览器配置档', 'Browser profile')}</dt>
                <dd>{selectedGateway.browserProfile ?? t('未设置', 'Not set')}</dd>
              </div>
            </dl>
          </article>

          <article className="paper-card">
            <div className="section-chip">{t('风险摘要', 'Risk Summary')}</div>
            <h3>{t('备注与后续项', 'Notes and follow-ups')}</h3>
            {selectedGateway.issues.length > 0 || selectedGateway.config.notes.length > 0 ? (
              <ul className="issue-list large">
                {[...selectedGateway.issues, ...selectedGateway.config.notes].map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : (
              <div className="issue-ok">
                <CheckCircle2 size={16} />
                {t('这个 gateway 目前没有额外配置备注。', 'No extra config notes on this gateway.')}
              </div>
            )}
          </article>
        </section>

        <section className="paper-card repo-card">
          <div>
            <div className="section-chip">{t('管理链路', 'Manager Wiring')}</div>
            <h3>{t('桥接与仓库连接', 'Bridge and repo linkage')}</h3>
          </div>
          <div className="detail-tiles">
            <div>
              <span>{t('WSL 发行版', 'WSL distro')}</span>
              <strong>{managerState?.distro ?? 'Ubuntu'}</strong>
            </div>
            <div>
              <span>{t('OpenClaw 版本', 'OpenClaw version')}</span>
              <strong>{managerState?.openclawVersion ?? 'unknown'}</strong>
            </div>
            <div>
              <span>{t('桥接状态', 'Bridge state')}</span>
              <strong>{managerState?.bridge.ready ? t('就绪', 'ready') : t('降级', 'degraded')}</strong>
            </div>
            <div>
              <span>{t('Control center 仓库', 'Control center repo')}</span>
              <strong>{managerState?.controlCenterRepo ?? t('本地未找到仓库', 'Repo not found locally')}</strong>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderCurrentPage() {
    switch (currentPage) {
      case 'overview':
        return renderOverviewPage();
      case 'workbench':
        return renderWorkbenchPage();
      case 'logs':
        return renderLiveLogsPage();
      case 'configs':
        return renderConfigsPage();
      default:
        return null;
    }
  }

  if (isBootstrapping && !managerState) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <div className="loading-badge">OpenClaw Manager</div>
          <h1>{t('正在搭建多 gateway 操作台', 'Building the multi-gateway board')}</h1>
          <p>
            {t(
              'Manager 正在连接 WSL、加载 gateway 清单，并把每个实例接入同一套控制壳后再渲染界面。',
              'The manager is connecting to WSL, loading the gateway manifest, and wiring each instance into one shell before rendering the interface.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="manager-shell">
      <div className="paper-noise" />

      <aside className="manager-sidebar">
        <div className="brand-lockup">
          <div className="brand-badge">OC</div>
          <div>
            <strong>OpenClaw Manager</strong>
            <span>{t('WSL2 多 gateway 控制台', 'WSL2 multi-gateway control shell')}</span>
          </div>
        </div>

        <nav className="nav-stack">
          {PAGE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => setCurrentPage(item.id)}
              >
                <Icon size={18} />
                <div>
                  <strong>{copyFor(languageMode, item.label)}</strong>
                  <span>{copyFor(languageMode, item.caption)}</span>
                </div>
              </button>
            );
          })}
        </nav>

        <section className="sidebar-card">
          <div className="sidebar-card-title">
            <Cable size={16} />
            {t('系统状态', 'System state')}
          </div>
          <div className="sidebar-metric">
            <span>{t('桥接', 'Bridge')}</span>
            <strong>{managerState?.bridge.ready ? t('就绪', 'Ready') : t('需要关注', 'Needs attention')}</strong>
          </div>
          <div className="sidebar-metric">
            <span>{t('同步时间', 'Synced')}</span>
            <strong>{formatGeneratedAt(managerState?.generatedAt ?? null, languageMode)}</strong>
          </div>
          <div className="sidebar-metric">
            <span>{t('版本', 'Version')}</span>
            <strong>{managerState?.openclawVersion ?? 'unknown'}</strong>
          </div>
        </section>

        <section className="sidebar-card">
          <div className="sidebar-card-title">
            <Shield size={16} />
            {t('集成说明', 'Integration note')}
          </div>
          <p>
            {t(
              '这套 Manager 会聚合多个 WSL gateway，并为每条车道嵌入独立的 control center runtime，而不是把整套环境当成一个全局实例。',
              'The manager aggregates multiple WSL gateways and embeds a dedicated control center runtime for each lane instead of treating the whole setup as one global instance.',
            )}
          </p>
        </section>
      </aside>

      <main className="manager-main">
        <header className="manager-header">
          <div className="header-copy">
            <div className="section-chip">{t('参考 100.agitao 风格', 'Inspired by 100.agitao')}</div>
            <h1>{t('多账号 OpenClaw 操作台', 'Multi-account OpenClaw operator desk')}</h1>
            <p>
              {t(
                '一套 Manager，多条 gateway 车道，外加直接指向你真实 WSL2 实例的嵌入式工作台。',
                'One manager, multiple gateway lanes, and embedded workbenches that point straight at your real WSL2 instances.',
              )}
            </p>
          </div>

          <div className="header-actions">
            <button className="action-button primary" onClick={() => setIsCreateGatewayOpen(true)}>
              <Plus size={16} />
              {t('新增 Gateway', 'Create gateway')}
            </button>
            <div className="language-switch" aria-label={t('界面语言', 'Interface language')}>
              <span className="language-switch-icon">
                <Globe2 size={16} />
              </span>
              <button
                className={languageMode === 'zh' ? 'active' : ''}
                onClick={() => setLanguageMode('zh')}
              >
                中文
              </button>
              <button
                className={languageMode === 'en' ? 'active' : ''}
                onClick={() => setLanguageMode('en')}
              >
                EN
              </button>
            </div>
            <button className="action-button secondary" onClick={() => void refreshState('manual')}>
              <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
              {isRefreshing ? t('刷新中...', 'Refreshing...') : t('刷新状态', 'Refresh state')}
            </button>
          </div>
        </header>

        <section className="gateway-strip">
          {managerState?.gateways.map((gateway) => {
            const palette = paletteFor(gateway.id);
            const statusClass = isGatewayHealthy(gateway) ? 'healthy' : 'warning';
            return (
              <button
                key={gateway.id}
                className={`account-card ${selectedGateway?.id === gateway.id ? 'active' : ''}`}
                style={gatewayStyle(gateway.id)}
                onClick={() => setSelectedGatewayId(gateway.id)}
              >
                <div className={`status-dot ${statusClass}`} />
                <div className="account-copy">
                  <strong>{gateway.label}</strong>
                  <span>{joinLabels(gateway.config.channels, languageMode)}</span>
                </div>
                <span className="account-port" style={{ color: palette.ink }}>
                  :{gateway.port}
                </span>
              </button>
            );
          })}
        </section>

        {errorMessage ? (
          <section className="warning-banner">
            <AlertTriangle size={18} />
            <div>
              <strong>{t('状态同步失败', 'State sync failed')}</strong>
              <span>{errorMessage}</span>
            </div>
          </section>
        ) : null}

        <section className="quick-toolbar">
          <div className="quick-chip">
            <Clock3 size={14} />
            {t('同步于', 'Synced')} {formatGeneratedAt(managerState?.generatedAt ?? null, languageMode)}
          </div>
          <div className="quick-chip">
            <TerminalSquare size={14} />
            {selectedGateway ? selectedGateway.serviceName : t('未选择 gateway', 'No gateway selected')}
          </div>
          <div className="quick-chip">
            <Search size={14} />
            {t('页面', 'Page')} {copyFor(languageMode, PAGE_ITEMS.find((item) => item.id === currentPage)?.label ?? PAGE_ITEMS[0].label)}
          </div>
        </section>

        {selectedGateway ? (
          <section className="floating-actions">
            <button
              className="action-button tiny"
              disabled={Boolean(actionByGateway[selectedGateway.id])}
              onClick={() => void handleGatewayAction(selectedGateway.id, 'start')}
            >
              <Activity size={14} />
              {actionByGateway[selectedGateway.id] === 'start' ? t('启动中...', 'Starting...') : t('启动', 'Start')}
            </button>
            <button
              className="action-button tiny secondary"
              disabled={Boolean(actionByGateway[selectedGateway.id])}
              onClick={() => void handleGatewayAction(selectedGateway.id, 'restart')}
            >
              <RotateCcw size={14} />
              {actionByGateway[selectedGateway.id] === 'restart' ? t('重启中...', 'Restarting...') : t('重启', 'Restart')}
            </button>
            <button
              className="action-button tiny danger"
              disabled={Boolean(actionByGateway[selectedGateway.id])}
              onClick={() => void handleGatewayAction(selectedGateway.id, 'stop')}
            >
              <Square size={14} />
              {actionByGateway[selectedGateway.id] === 'stop' ? t('停止中...', 'Stopping...') : t('停止', 'Stop')}
            </button>
            <button className="action-button tiny secondary" onClick={() => setCurrentPage('logs')}>
              <ScrollText size={14} />
              {t('日志', 'Logs')}
            </button>
            <button className="action-button tiny secondary" onClick={() => setCurrentPage('workbench')}>
              <ExternalLink size={14} />
              {t('工作台', 'Workbench')}
            </button>
          </section>
        ) : null}

        <motion.section
          key={currentPage}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="page-frame"
        >
          {renderCurrentPage()}
        </motion.section>
      </main>

      <CreateGatewayModal
        open={isCreateGatewayOpen}
        gateways={managerState?.gateways ?? []}
        languageMode={languageMode}
        onClose={() => setIsCreateGatewayOpen(false)}
        onCreated={handleGatewayCreated}
      />

      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className={`toast ${toast.tone}`}
          >
            {toast.tone === 'success' ? (
              <CheckCircle2 size={18} />
            ) : toast.tone === 'error' ? (
              <AlertTriangle size={18} />
            ) : (
              <Activity size={18} />
            )}
            <span>{toast.message}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default App;

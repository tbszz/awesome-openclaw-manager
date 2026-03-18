import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Orbit,
  Search,
  Waypoints,
} from 'lucide-react';
import { appLogger } from '../lib/logger';
import {
  getWorkbenchFileContent,
  type GatewaySummary,
  type NativeWorkbenchData,
  type WorkbenchFileContent,
  type WorkbenchScope,
} from '../lib/manager-api';

type LanguageMode = 'zh' | 'en';
type WorkbenchSection =
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

interface NativeWorkbenchPanelProps {
  gateway: GatewaySummary;
  section: WorkbenchSection;
  languageMode: LanguageMode;
  data: NativeWorkbenchData | null;
  loading: boolean;
  booting: boolean;
  onNavigateSection: (section: WorkbenchSection) => void;
  onEnsureControlCenter: () => void;
}

interface JumpCard {
  id: WorkbenchSection;
  title: string;
  note: string;
  icon: typeof Orbit;
}

function pick(languageMode: LanguageMode, zh: string, en: string) {
  return languageMode === 'zh' ? zh : en;
}

function formatDateTime(value: string | null | undefined, languageMode: LanguageMode) {
  if (!value) {
    return pick(languageMode, '刚刚', 'just now');
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

function formatNumber(value: number | null | undefined, languageMode: LanguageMode) {
  return new Intl.NumberFormat(languageMode === 'zh' ? 'zh-CN' : 'en-US').format(value ?? 0);
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatMoney(value: number | null | undefined, languageMode: LanguageMode) {
  const numeric = value ?? 0;
  return new Intl.NumberFormat(languageMode === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric);
}

function humanServiceState(activeState: string, languageMode: LanguageMode) {
  if (activeState === 'active') {
    return pick(languageMode, '在线', 'Live');
  }
  if (activeState === 'activating') {
    return pick(languageMode, '启动中', 'Booting');
  }
  return pick(languageMode, '离线', 'Offline');
}

function labelTaskState(state: string, languageMode: LanguageMode) {
  switch (state) {
    case 'todo':
      return pick(languageMode, '待办', 'Todo');
    case 'in_progress':
      return pick(languageMode, '进行中', 'In progress');
    case 'blocked':
      return pick(languageMode, '阻塞', 'Blocked');
    case 'done':
      return pick(languageMode, '已完成', 'Done');
    default:
      return state;
  }
}

function labelProjectState(state: string, languageMode: LanguageMode) {
  switch (state) {
    case 'planned':
      return pick(languageMode, '规划中', 'Planned');
    case 'active':
      return pick(languageMode, '活跃', 'Active');
    case 'blocked':
      return pick(languageMode, '阻塞', 'Blocked');
    case 'done':
      return pick(languageMode, '完成', 'Done');
    default:
      return state;
  }
}

function labelSessionState(state: string, languageMode: LanguageMode) {
  switch (state) {
    case 'running':
      return pick(languageMode, '运行中', 'Running');
    case 'blocked':
      return pick(languageMode, '阻塞', 'Blocked');
    case 'waiting_approval':
      return pick(languageMode, '待审批', 'Waiting approval');
    case 'error':
      return pick(languageMode, '错误', 'Error');
    case 'idle':
      return pick(languageMode, '空闲', 'Idle');
    default:
      return state;
  }
}

function labelApprovalState(state: string, languageMode: LanguageMode) {
  switch (state) {
    case 'pending':
      return pick(languageMode, '待处理', 'Pending');
    case 'approved':
      return pick(languageMode, '已批准', 'Approved');
    case 'denied':
      return pick(languageMode, '已拒绝', 'Denied');
    default:
      return pick(languageMode, '未知', 'Unknown');
  }
}

function labelAlertLevel(level: string, languageMode: LanguageMode) {
  switch (level) {
    case 'action-required':
      return pick(languageMode, '需要处理', 'Action required');
    case 'warn':
      return pick(languageMode, '注意', 'Warn');
    default:
      return pick(languageMode, '信息', 'Info');
  }
}

function fileKey(gatewayId: string, scope: WorkbenchScope, path: string) {
  return `${gatewayId}:${scope}:${path}`;
}

function liveSection(section: WorkbenchSection) {
  return !['docs', 'memory', 'settings'].includes(section);
}

function normalizeSection(section: WorkbenchSection): Exclude<WorkbenchSection, 'staff' | 'tasks'> {
  if (section === 'staff') {
    return 'team';
  }
  if (section === 'tasks') {
    return 'projects-tasks';
  }
  return section;
}

function latestSessionAt(item: { lastMessageAt?: string; latestHistoryAt?: string }) {
  return item.latestHistoryAt ?? item.lastMessageAt;
}

export function NativeWorkbenchPanel({
  gateway,
  section,
  languageMode,
  data,
  loading,
  booting,
  onNavigateSection,
  onEnsureControlCenter,
}: NativeWorkbenchPanelProps) {
  const normalizedSection = normalizeSection(section);
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<WorkbenchScope, string>>>({});
  const [fileContents, setFileContents] = useState<Record<string, WorkbenchFileContent | undefined>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string | undefined>>({});
  const [fileLoadingKey, setFileLoadingKey] = useState<string | null>(null);

  const snapshot = data?.snapshot ?? null;
  const usage = data?.usage?.usage ?? null;
  const queue = data?.queue?.queue ?? null;
  const projects = data?.projects?.projects ?? snapshot?.projects.projects ?? [];
  const tasks = data?.tasks?.tasks ?? snapshot?.tasks.tasks ?? [];
  const sessions = data?.sessions?.items ?? snapshot?.sessions ?? [];
  const approvals = snapshot?.approvals ?? [];
  const cronJobs = snapshot?.cronJobs ?? [];
  const warnings = useMemo(
    () => [...gateway.issues, ...(data?.warnings ?? [])],
    [data?.warnings, gateway.issues],
  );
  const currentScope: WorkbenchScope | null =
    normalizedSection === 'docs' ? 'docs' : normalizedSection === 'memory' ? 'memory' : null;
  const currentFiles = currentScope ? (currentScope === 'docs' ? data?.docs ?? [] : data?.memory ?? []) : [];
  const filesSignature = currentFiles.map((entry) => entry.path).join('|');
  const activeFilePath = currentScope ? selectedFiles[currentScope] ?? currentFiles[0]?.path ?? null : null;
  const activeFileEntry =
    currentScope && activeFilePath ? currentFiles.find((entry) => entry.path === activeFilePath) ?? null : null;
  const activeFileCacheKey =
    currentScope && activeFilePath ? fileKey(gateway.id, currentScope, activeFilePath) : null;
  const activeFileContent = activeFileCacheKey ? fileContents[activeFileCacheKey] ?? null : null;
  const activeFileError = activeFileCacheKey ? fileErrors[activeFileCacheKey] ?? null : null;

  const jumpCards: JumpCard[] = [
    { id: 'usage-cost', title: pick(languageMode, '用量与额度', 'Usage and budget'), note: pick(languageMode, '看今天、7天和30天的消耗', 'Inspect today, 7-day, and 30-day usage'), icon: Activity },
    { id: 'team', title: pick(languageMode, '成员与会话', 'Team and sessions'), note: pick(languageMode, '谁在忙、谁阻塞、谁待审批', 'Who is busy, blocked, or waiting approval'), icon: Bot },
    { id: 'projects-tasks', title: pick(languageMode, '任务与项目', 'Projects and tasks'), note: pick(languageMode, '查看任务板、排期和执行证据', 'Review boards, schedules, and execution evidence'), icon: Waypoints },
    { id: 'alerts', title: pick(languageMode, '风险与告警', 'Risks and alerts'), note: pick(languageMode, '把需要你介入的事情收拢起来', 'Collect intervention-worthy items'), icon: AlertTriangle },
  ];

  useEffect(() => {
    if (!currentScope || currentFiles.length === 0) {
      return;
    }
    setSelectedFiles((current) => {
      const existing = current[currentScope];
      if (existing && currentFiles.some((entry) => entry.path === existing)) {
        return current;
      }
      return { ...current, [currentScope]: currentFiles[0].path };
    });
  }, [currentScope, filesSignature]);

  useEffect(() => {
    if (!currentScope || !activeFilePath) {
      return;
    }
    const cacheKey = fileKey(gateway.id, currentScope, activeFilePath);
    if (fileContents[cacheKey] || fileLoadingKey === cacheKey) {
      return;
    }

    let cancelled = false;
    setFileLoadingKey(cacheKey);
    void getWorkbenchFileContent(gateway.id, currentScope, activeFilePath)
      .then((content) => {
        if (!cancelled) {
          setFileContents((current) => ({ ...current, [cacheKey]: content }));
          setFileErrors((current) => {
            const next = { ...current };
            delete next[cacheKey];
            return next;
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        appLogger.error('Failed to read workbench file content', error);
        setFileErrors((current) => ({ ...current, [cacheKey]: message }));
      })
      .finally(() => {
        if (!cancelled) {
          setFileLoadingKey((current) => (current === cacheKey ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilePath, currentScope, gateway.id]);

  function emptyState(icon: ReactNode, title: string, note: string, action?: ReactNode) {
    return (
      <div className="native-empty-state">
        {icon}
        <h4>{title}</h4>
        <p>{note}</p>
        {action}
      </div>
    );
  }

  function statCard(label: string, value: string, note: string, tone: 'default' | 'warn' = 'default') {
    return (
      <article className={`native-stat-card ${tone}`}>
        <span className="native-stat-label">{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </article>
    );
  }

  function renderFileBrowser(scope: WorkbenchScope, title: string, note: string) {
    const files = scope === 'docs' ? data?.docs ?? [] : data?.memory ?? [];
    if (files.length === 0) {
      return emptyState(
        scope === 'docs' ? <FolderOpen size={22} /> : <Search size={22} />,
        pick(languageMode, '当前没有可展示的文件', 'No files available yet'),
        pick(languageMode, 'Manager 已经接入原生文件模型，但这个 scope 下暂时没有匹配文件。', 'Manager is wired to the native file model, but there are no matching files under this scope yet.'),
      );
    }

    return (
      <div className="native-workbench">
        <section className="native-panel-card">
          <div className="native-card-head">
            <div>
              <div className="section-chip">{title}</div>
              <h4>{note}</h4>
            </div>
          </div>
          <div className="native-file-browser">
            <div className="native-file-list">
              {files.map((entry) => (
                <button key={entry.path} type="button" className={`native-file-item ${activeFilePath === entry.path ? 'active' : ''}`} onClick={() => setSelectedFiles((current) => ({ ...current, [scope]: entry.path }))}>
                  <FileText size={16} />
                  <div><strong>{entry.name}</strong><p>{entry.path}</p></div>
                </button>
              ))}
            </div>
            <div className="native-file-viewer">
              <div className="native-file-meta">
                <div>
                  <strong>{activeFileEntry?.name ?? '-'}</strong>
                  <span>{activeFileEntry && activeFileEntry.path !== activeFileEntry.name ? activeFileEntry.path : ''}</span>
                </div>
                <div className="native-file-meta-right"><span>{formatNumber(activeFileEntry?.bytes, languageMode)} B</span><span>{formatDateTime(activeFileEntry?.updatedAt, languageMode)}</span></div>
              </div>
              {fileLoadingKey === activeFileCacheKey ? <div className="native-empty-copy">{pick(languageMode, '正在读取文件内容...', 'Loading file content...')}</div> : activeFileError ? <div className="native-empty-copy danger">{activeFileError}</div> : <pre className="native-file-content">{activeFileContent?.content ?? ''}</pre>}
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (loading && !data) {
    return emptyState(<Clock3 size={22} />, pick(languageMode, '正在同步工作台数据', 'Syncing workbench data'), pick(languageMode, 'Manager 正在刷新当前 gateway 的原生控制台数据。', 'Manager is refreshing native workbench data for the current gateway.'));
  }

  if (normalizedSection === 'docs') {
    return renderFileBrowser('docs', pick(languageMode, '文档', 'Docs'), pick(languageMode, '直接读取 workspace 里的源文档', 'Read source docs directly from the workspace'));
  }

  if (normalizedSection === 'memory') {
    return renderFileBrowser('memory', pick(languageMode, '记忆', 'Memory'), pick(languageMode, '直接读取 memory 目录和核心记忆文件', 'Read memory files directly from the workspace'));
  }

  if (liveSection(normalizedSection) && (!data || !data.ready)) {
    return emptyState(
      <Bot size={24} />,
      pick(languageMode, '数据源还没有就绪', 'Data source is not ready yet'),
      pick(languageMode, '这些分区依赖本地 control center 运行时来汇总会话、任务和预算快照。启动一次之后，Manager 会直接用自己的原生界面展示它们。', 'These sections need the local control-center runtime to aggregate sessions, tasks, and budget snapshots. Once started, Manager will render them natively inside the app.'),
      <button className="action-button primary" onClick={onEnsureControlCenter}>{booting ? pick(languageMode, '启动中...', 'Booting...') : pick(languageMode, '启动数据源', 'Start data source')}</button>,
    );
  }

  if (normalizedSection === 'overview' && snapshot) {
    const runningSessions = sessions.filter((item) => item.state === 'running').length;
    const pendingApprovals = approvals.filter((item) => item.status === 'pending').length;
    const openAlerts = (queue?.counts.unacked ?? 0) + warnings.length;
    return (
      <div className="native-workbench">
        <div className="native-toolbar"><span className="quick-chip"><Clock3 size={14} />{pick(languageMode, '同步于', 'Synced')} {formatDateTime(data?.fetchedAt, languageMode)}</span><span className="quick-chip"><Activity size={14} />{pick(languageMode, '服务', 'Service')} {humanServiceState(gateway.service.activeState, languageMode)}</span></div>
        <div className="native-stat-grid">
          {statCard(pick(languageMode, '运行中会话', 'Running sessions'), formatNumber(runningSessions, languageMode), pick(languageMode, '当前真正处于执行态的会话数量', 'Sessions actively executing now'))}
          {statCard(pick(languageMode, '进行中任务', 'In-progress tasks'), formatNumber(snapshot.tasksSummary.inProgress, languageMode), pick(languageMode, '任务板里还在推进的任务', 'Tasks still moving on the board'))}
          {statCard(pick(languageMode, '待审批', 'Pending approvals'), formatNumber(pendingApprovals, languageMode), pick(languageMode, '需要你拍板的审批', 'Approvals waiting for operator action'))}
          {statCard(pick(languageMode, '未处理告警', 'Open alerts'), formatNumber(openAlerts, languageMode), pick(languageMode, '告警队列加上当前 gateway 提示', 'Queue plus current gateway warnings'), openAlerts > 0 ? 'warn' : 'default')}
        </div>
        <div className="native-panel-grid two-up">
          <section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '分区捷径', 'Section shortcuts')}</div><h4>{pick(languageMode, '从总览直接跳到具体工作面板', 'Jump from overview into the detailed panels')}</h4></div></div><div className="native-jump-grid">{jumpCards.map((card) => { const Icon = card.icon; return <button key={card.id} type="button" className="native-jump-card" onClick={() => onNavigateSection(card.id)}><Icon size={18} /><div><strong>{card.title}</strong><p>{card.note}</p></div></button>; })}</div></section>
          <section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '系统脉搏', 'System pulse')}</div><h4>{pick(languageMode, '当前 gateway 运行摘要', 'Current gateway runtime summary')}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '网关端口', 'Gateway port')}</span><strong>{gateway.port}</strong></div><div><span>{pick(languageMode, '控制台端口', 'Console port')}</span><strong>{data?.uiPort ?? gateway.controlCenter.uiPort}</strong></div><div><span>{pick(languageMode, '预算预警', 'Budget warnings')}</span><strong>{snapshot.budgetSummary.warn + snapshot.budgetSummary.over}</strong></div><div><span>{pick(languageMode, '渠道', 'Channels')}</span><strong>{gateway.config.channels.join(' / ') || '-'}</strong></div></div></section>
        </div>
      </div>
    );
  }

  if (normalizedSection === 'usage-cost' && usage) {
    return (
      <div className="native-workbench">
        <div className="native-stat-grid">{usage.periods.map((period) => statCard(period.label, formatNumber(period.tokens, languageMode), pick(languageMode, `成本 ${formatMoney(period.estimatedCost, languageMode)}`, `${formatMoney(period.estimatedCost, languageMode)} cost`)))}</div>
        <div className="native-panel-grid two-up">
          <section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '额度窗口', 'Subscription window')}</div><h4>{usage.subscription.planLabel ?? pick(languageMode, '暂无计划信息', 'No plan label')}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '已用', 'Consumed')}</span><strong>{formatPercent(usage.subscription.usagePercent)}</strong></div><div><span>{pick(languageMode, '剩余', 'Remaining')}</span><strong>{formatNumber(usage.subscription.remaining, languageMode)} {usage.subscription.unit ?? ''}</strong></div><div><span>{pick(languageMode, '窗口结束', 'Cycle end')}</span><strong>{formatDateTime(usage.subscription.cycleEnd, languageMode)}</strong></div></div><p className="native-muted-copy">{usage.subscription.detail ?? usage.subscription.connectHint}</p></section>
          <section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '预算信号', 'Budget signal')}</div><h4>{usage.budget.status}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '30天成本', '30d cost')}</span><strong>{formatMoney(usage.budget.usedCost30d, languageMode)}</strong></div><div><span>{pick(languageMode, '连接状态', 'Connector')}</span><strong>{usage.budget.status}</strong></div></div><p className="native-muted-copy">{usage.budget.message}</p></section>
        </div>
      </div>
    );
  }

  if (normalizedSection === 'team') {
    return sessions.length === 0 ? emptyState(<Bot size={22} />, pick(languageMode, '目前还没有会话数据', 'No session data yet'), pick(languageMode, '这条 gateway 暂时没有可见会话。', 'There are no visible sessions for this gateway yet.')) : <div className="native-workbench"><div className="native-stat-grid">{statCard(pick(languageMode, '会话总数', 'Sessions'), formatNumber(sessions.length, languageMode), pick(languageMode, '可见会话总量', 'Visible session total'))}{statCard(pick(languageMode, '运行中', 'Running'), formatNumber(sessions.filter((item) => item.state === 'running').length, languageMode), pick(languageMode, '真正处于执行中的会话', 'Sessions actively running'))}{statCard(pick(languageMode, '阻塞', 'Blocked'), formatNumber(sessions.filter((item) => item.state === 'blocked').length, languageMode), pick(languageMode, '当前需要排查的会话', 'Sessions needing investigation'), sessions.filter((item) => item.state === 'blocked').length > 0 ? 'warn' : 'default')}{statCard(pick(languageMode, '待审批', 'Waiting approval'), formatNumber(sessions.filter((item) => item.state === 'waiting_approval').length, languageMode), pick(languageMode, '等待人工确认的会话', 'Sessions waiting on operator approval'))}</div><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '会话名单', 'Session roster')}</div><h4>{pick(languageMode, '谁在忙、谁卡住、谁在等', 'Who is busy, blocked, or waiting')}</h4></div></div><div className="native-card-list">{sessions.slice(0, 12).map((item) => <article key={item.sessionKey} className="native-list-card"><div className="native-list-card-top"><strong>{item.label ?? item.sessionKey}</strong><span className="native-pill">{labelSessionState(item.state, languageMode)}</span></div><p>{item.agentId ?? pick(languageMode, '未命名 agent', 'Unnamed agent')}</p><small>{pick(languageMode, '最近活动', 'Latest activity')} {formatDateTime(latestSessionAt(item), languageMode)}</small></article>)}</div></section></div>;
  }

  if (normalizedSection === 'collaboration') {
    return <div className="native-workbench"><div className="native-panel-grid two-up"><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '审批', 'Approvals')}</div><h4>{pick(languageMode, '等待人工判断的动作', 'Actions waiting for operator judgment')}</h4></div></div>{approvals.length > 0 ? <div className="native-card-list">{approvals.slice(0, 10).map((item) => <article key={item.approvalId} className="native-list-card"><div className="native-list-card-top"><strong>{item.command ?? item.reason ?? item.approvalId}</strong><span className="native-pill">{labelApprovalState(item.status, languageMode)}</span></div><p>{item.agentId ?? item.sessionKey ?? '-'}</p><small>{pick(languageMode, '更新时间', 'Updated')} {formatDateTime(item.updatedAt ?? item.requestedAt, languageMode)}</small></article>)}</div> : <div className="native-success-row"><CheckCircle2 size={18} /><span>{pick(languageMode, '当前没有待处理审批。', 'No pending approvals right now.')}</span></div>}</section><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '计划任务', 'Cron jobs')}</div><h4>{pick(languageMode, '系统节拍与后台作业', 'System cadence and scheduled jobs')}</h4></div></div>{cronJobs.length > 0 ? <div className="native-card-list">{cronJobs.slice(0, 10).map((job) => <article key={job.jobId} className="native-list-card"><div className="native-list-card-top"><strong>{job.name ?? job.jobId}</strong><span className="native-pill">{job.enabled ? pick(languageMode, '启用', 'Enabled') : pick(languageMode, '停用', 'Disabled')}</span></div><small>{pick(languageMode, '下次执行', 'Next run')} {formatDateTime(job.nextRunAt, languageMode)}</small></article>)}</div> : <div className="native-empty-copy">{pick(languageMode, '当前没有可见的计划任务。', 'No cron jobs are currently visible.')}</div>}</section></div></div>;
  }

  if (normalizedSection === 'projects-tasks' && snapshot) {
    return <div className="native-workbench"><div className="native-stat-grid">{statCard(pick(languageMode, '任务总数', 'Tasks'), formatNumber(snapshot.tasksSummary.tasks, languageMode), pick(languageMode, '所有可见任务', 'All visible tasks'))}{statCard(pick(languageMode, '进行中', 'In progress'), formatNumber(snapshot.tasksSummary.inProgress, languageMode), pick(languageMode, '仍在推进中的任务', 'Tasks actively moving'))}{statCard(pick(languageMode, '阻塞', 'Blocked'), formatNumber(snapshot.tasksSummary.blocked, languageMode), pick(languageMode, '当前卡住的任务', 'Tasks currently blocked'), snapshot.tasksSummary.blocked > 0 ? 'warn' : 'default')}{statCard(pick(languageMode, '项目数', 'Projects'), formatNumber(projects.length, languageMode), pick(languageMode, '有结构化记录的项目', 'Projects with structured records'))}</div><div className="native-panel-grid two-up"><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '项目', 'Projects')}</div><h4>{pick(languageMode, '当前项目面板', 'Current project board')}</h4></div></div>{projects.length > 0 ? <div className="native-card-list">{projects.slice(0, 10).map((project) => <article key={project.projectId} className="native-list-card"><div className="native-list-card-top"><strong>{project.title}</strong><span className="native-pill">{labelProjectState(project.status, languageMode)}</span></div><p>{pick(languageMode, '负责人', 'Owner')} {project.owner}</p><small>{pick(languageMode, '更新时间', 'Updated')} {formatDateTime(project.updatedAt, languageMode)}</small></article>)}</div> : <div className="native-empty-copy">{pick(languageMode, '还没有结构化项目记录。', 'No structured project records yet.')}</div>}</section><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '任务', 'Tasks')}</div><h4>{pick(languageMode, '近期任务列表', 'Recent task list')}</h4></div></div>{tasks.length > 0 ? <div className="native-card-list">{tasks.slice(0, 12).map((task) => <article key={task.taskId} className="native-list-card"><div className="native-list-card-top"><strong>{task.title}</strong><span className="native-pill">{labelTaskState(task.status, languageMode)}</span></div><p>{pick(languageMode, '负责人', 'Owner')} {task.owner}</p><small>{pick(languageMode, '截止', 'Due')} {formatDateTime(task.dueAt, languageMode)}</small></article>)}</div> : <div className="native-empty-copy">{pick(languageMode, '当前没有任务清单。', 'No task records are currently available.')}</div>}</section></div></div>;
  }

  if (normalizedSection === 'alerts' && snapshot) {
    const queueItems = queue?.queue ?? [];
    return <div className="native-workbench"><div className="native-stat-grid">{statCard(pick(languageMode, '总告警', 'Total alerts'), formatNumber(queue?.counts.total, languageMode), pick(languageMode, '当前队列里的告警项', 'Alerts in the current queue'), (queue?.counts.total ?? 0) > 0 ? 'warn' : 'default')}{statCard(pick(languageMode, '未确认', 'Unacked'), formatNumber(queue?.counts.unacked, languageMode), pick(languageMode, '还没被处理或消音', 'Still waiting for operator action'), (queue?.counts.unacked ?? 0) > 0 ? 'warn' : 'default')}{statCard(pick(languageMode, '预算超限', 'Over budget'), formatNumber(snapshot.budgetSummary.over, languageMode), pick(languageMode, '超过预算阈值的项', 'Items exceeding budget thresholds'), snapshot.budgetSummary.over > 0 ? 'warn' : 'default')}{statCard(pick(languageMode, '网关提示', 'Gateway notes'), formatNumber(warnings.length, languageMode), pick(languageMode, '来自网关和数据抓取层的提示', 'Warnings from gateway and data fetch layer'), warnings.length > 0 ? 'warn' : 'default')}</div><div className="native-panel-grid two-up"><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '动作队列', 'Action queue')}</div><h4>{pick(languageMode, '需要你关注的当前告警', 'Current alerts needing attention')}</h4></div></div>{queueItems.length > 0 ? <div className="native-card-list">{queueItems.slice(0, 12).map((item) => <article key={item.itemId} className="native-list-card"><div className="native-list-card-top"><strong>{item.message}</strong><span className="native-pill">{labelAlertLevel(item.level, languageMode)}</span></div><p>{item.code}</p><small>{pick(languageMode, '发生于', 'Occurred')} {formatDateTime(item.occurredAt, languageMode)}</small></article>)}</div> : <div className="native-success-row"><CheckCircle2 size={18} /><span>{pick(languageMode, '当前动作队列为空。', 'The action queue is currently empty.')}</span></div>}</section><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '补充提示', 'Additional notes')}</div><h4>{pick(languageMode, '来自网关和数据层的附加信号', 'Extra signals from the gateway and data layer')}</h4></div></div>{warnings.length > 0 ? <ul className="native-warning-list">{warnings.map((warning) => <li key={warning}><AlertTriangle size={16} /><span>{warning}</span></li>)}</ul> : <div className="native-success-row"><CheckCircle2 size={18} /><span>{pick(languageMode, '当前没有额外补充提示。', 'No extra supplementary note at the moment.')}</span></div>}</section></div></div>;
  }

  if (normalizedSection === 'settings') {
    return <div className="native-workbench"><div className="native-panel-grid two-up"><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '运行态', 'Runtime')}</div><h4>{pick(languageMode, '服务和控制台状态', 'Service and console status')}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '服务状态', 'Service')}</span><strong>{humanServiceState(gateway.service.activeState, languageMode)}</strong></div><div><span>{pick(languageMode, '监听端口', 'Port listening')}</span><strong>{gateway.service.portListening ? pick(languageMode, '是', 'Yes') : pick(languageMode, '否', 'No')}</strong></div><div><span>{pick(languageMode, '控制台就绪', 'Console ready')}</span><strong>{data?.ready ? pick(languageMode, '是', 'Yes') : pick(languageMode, '否', 'No')}</strong></div><div><span>{pick(languageMode, '控制台端口', 'Console port')}</span><strong>{data?.uiPort ?? gateway.controlCenter.uiPort}</strong></div><div><span>{pick(languageMode, '最新同步', 'Latest sync')}</span><strong>{formatDateTime(data?.fetchedAt ?? null, languageMode)}</strong></div></div></section><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '配置摘要', 'Config digest')}</div><h4>{pick(languageMode, '模型、渠道和运行选项', 'Models, channels, and runtime flags')}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '主模型', 'Primary model')}</span><strong>{gateway.config.primaryModel ?? '-'}</strong></div><div><span>{pick(languageMode, '回退模型', 'Fallbacks')}</span><strong>{gateway.config.fallbackModels.join(' / ') || '-'}</strong></div><div><span>{pick(languageMode, '渠道', 'Channels')}</span><strong>{gateway.config.channels.join(' / ') || '-'}</strong></div><div><span>{pick(languageMode, '记忆检索', 'Memory search')}</span><strong>{gateway.config.memorySearchEnabled ? pick(languageMode, '已启用', 'Enabled') : pick(languageMode, '未启用', 'Disabled')}</strong></div><div><span>{pick(languageMode, '鉴权模式', 'Auth mode')}</span><strong>{gateway.config.authMode ?? '-'}</strong></div><div><span>{pick(languageMode, '绑定', 'Bind')}</span><strong>{gateway.config.bind ?? '-'}</strong></div></div></section></div><section className="native-panel-card"><div className="native-card-head"><div><div className="section-chip">{pick(languageMode, '路径', 'Paths')}</div><h4>{pick(languageMode, '当前 gateway 的关键目录', 'Key directories for this gateway')}</h4></div></div><div className="native-kv-list"><div><span>{pick(languageMode, '状态目录', 'State dir')}</span><strong>{gateway.stateDir}</strong></div><div><span>{pick(languageMode, '工作区', 'Workspace')}</span><strong>{gateway.workspaceDir}</strong></div><div><span>{pick(languageMode, '服务名', 'Service')}</span><strong>{gateway.serviceName}</strong></div><div><span>{pick(languageMode, '基地址', 'Base URL')}</span><strong>{data?.baseUrl ?? gateway.controlCenter.baseUrl}</strong></div></div></section></div>;
  }

  return emptyState(<AlertTriangle size={22} />, pick(languageMode, '目前还没有可显示的数据', 'No data available yet'), pick(languageMode, '这一栏没有读到运行时快照，但原生数据链路已经打通。', 'This section did not return runtime content yet, but the native data path is wired up.'));
}

import { type FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Cable, Cpu, Loader2, Plus, Shield, Trash2, X } from 'lucide-react';
import {
  createManagedGateway,
  type CreateManagedGatewayResponse,
  type GatewaySummary,
} from '../lib/manager-api';

type LanguageMode = 'zh' | 'en';
type ChannelType = 'telegram' | 'discord';
type DmPolicy = 'pairing' | 'open' | 'disabled';
type GroupPolicy = 'allowlist' | 'open' | 'disabled';
type StreamingMode = 'partial' | 'off';

interface CreateGatewayModalProps {
  open: boolean;
  gateways: GatewaySummary[];
  languageMode: LanguageMode;
  onClose: () => void;
  onCreated: (result: CreateManagedGatewayResponse) => Promise<void> | void;
}

interface ChannelDraft {
  id: string;
  channelType: ChannelType;
  enabled: boolean;
  secret: string;
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  streaming: StreamingMode;
}

interface GatewayDraft {
  label: string;
  gatewayId: string;
  profile: string;
  port: string;
  inheritEnvFrom: string;
  browserProfile: string;
  primaryModel: string;
  fallbackModels: string;
  memorySearchEnabled: boolean;
  channels: ChannelDraft[];
}

const CHANNEL_OPTIONS: { value: ChannelType; label: Record<LanguageMode, string> }[] = [
  { value: 'telegram', label: { zh: 'Telegram Bot', en: 'Telegram Bot' } },
  { value: 'discord', label: { zh: 'Discord Bot', en: 'Discord Bot' } },
];

function createChannelDraft(channelType: ChannelType = 'telegram'): ChannelDraft {
  return {
    id: `${channelType}-${Math.random().toString(36).slice(2, 10)}`,
    channelType,
    enabled: true,
    secret: '',
    dmPolicy: 'pairing',
    groupPolicy: 'allowlist',
    streaming: channelType === 'telegram' ? 'partial' : 'off',
  };
}

function defaultDraft(gateways: GatewaySummary[]): GatewayDraft {
  const inherited = gateways.find((gateway) => gateway.id === 'main')?.id ?? gateways[0]?.id ?? '';
  return {
    label: '',
    gatewayId: '',
    profile: '',
    port: '',
    inheritEnvFrom: inherited,
    browserProfile: '',
    primaryModel: '',
    fallbackModels: '',
    memorySearchEnabled: false,
    channels: [createChannelDraft('telegram')],
  };
}

function copy(languageMode: LanguageMode, zh: string, en: string) {
  return languageMode === 'zh' ? zh : en;
}

export function CreateGatewayModal({
  open,
  gateways,
  languageMode,
  onClose,
  onCreated,
}: CreateGatewayModalProps) {
  const [draft, setDraft] = useState<GatewayDraft>(() => defaultDraft(gateways));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(defaultDraft(gateways));
    setAdvancedOpen(false);
    setSaving(false);
    setErrorMessage(null);
  }, [open, gateways]);

  function updateDraft<K extends keyof GatewayDraft>(key: K, value: GatewayDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateChannel(channelId: string, patch: Partial<ChannelDraft>) {
    setDraft((current) => ({
      ...current,
      channels: current.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...patch } : channel,
      ),
    }));
  }

  function addChannel() {
    const usedTypes = new Set(draft.channels.map((channel) => channel.channelType));
    const nextType = CHANNEL_OPTIONS.find((option) => !usedTypes.has(option.value))?.value ?? 'telegram';
    if (usedTypes.has(nextType)) {
      return;
    }
    setDraft((current) => ({
      ...current,
      channels: [...current.channels, createChannelDraft(nextType)],
    }));
  }

  function removeChannel(channelId: string) {
    setDraft((current) => ({
      ...current,
      channels: current.channels.filter((channel) => channel.id !== channelId),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);

    try {
      const label = draft.label.trim();
      if (!label) {
        throw new Error(copy(languageMode, '请先填写 gateway 名称。', 'Please enter a gateway name.'));
      }
      if (draft.channels.length === 0) {
        throw new Error(copy(languageMode, '至少需要一个消息渠道。', 'At least one message channel is required.'));
      }

      const channels = draft.channels.map((channel) => {
        const secret = channel.secret.trim();
        if (!secret) {
          throw new Error(
            channel.channelType === 'telegram'
              ? copy(languageMode, 'Telegram Bot Token 不能为空。', 'Telegram bot token is required.')
              : copy(languageMode, 'Discord Bot Token 不能为空。', 'Discord bot token is required.'),
          );
        }

        const config =
          channel.channelType === 'telegram'
            ? {
                botToken: secret,
                dmPolicy: channel.dmPolicy,
                groupPolicy: channel.groupPolicy,
                streaming: channel.streaming,
              }
            : {
                token: secret,
                groupPolicy: channel.groupPolicy,
                streaming: channel.streaming,
              };

        return {
          channelType: channel.channelType,
          enabled: channel.enabled,
          config,
        };
      });

      const port = draft.port.trim() ? Number(draft.port.trim()) : null;
      if (draft.port.trim() && (!Number.isInteger(port) || Number(port) <= 0)) {
        throw new Error(copy(languageMode, '端口必须是正整数。', 'Port must be a positive integer.'));
      }

      const fallbackModels = draft.fallbackModels
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean);

      const result = await createManagedGateway({
        label,
        gatewayId: draft.gatewayId.trim() || null,
        profile: draft.profile.trim() || null,
        inheritEnvFrom: draft.inheritEnvFrom || null,
        port,
        browserProfile: draft.browserProfile.trim() || null,
        memorySearchEnabled: draft.memorySearchEnabled,
        primaryModel: draft.primaryModel.trim() || null,
        fallbackModels,
        channels,
      });

      await onCreated(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const t = (zh: string, en: string) => copy(languageMode, zh, en);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="gateway-modal paper-card"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="gateway-modal-head">
              <div>
                <div className="section-chip">{t('新增 Gateway', 'Create Gateway')}</div>
                <h3>{t('把新 bot 直接接成一条独立车道', 'Turn a new bot into its own managed lane')}</h3>
                <p>
                  {t(
                    '这会创建独立的 state dir、systemd 服务、manifest 条目和桥接端口，主网关不会被覆盖。',
                    'This provisions a separate state dir, systemd service, manifest entry, and bridge port without overwriting the main lane.',
                  )}
                </p>
              </div>
              <button type="button" className="icon-link" onClick={onClose} aria-label={t('关闭', 'Close')}>
                <X size={18} />
              </button>
            </div>

            <form className="gateway-modal-body" onSubmit={handleSubmit}>
              <section className="modal-section">
                <div className="modal-section-title">
                  <Bot size={16} />
                  <span>{t('基础信息', 'Identity')}</span>
                </div>
                <div className="modal-form-grid">
                  <label className="modal-field">
                    <span>{t('Gateway 名称', 'Gateway name')}</span>
                    <input
                      value={draft.label}
                      onChange={(event) => updateDraft('label', event.target.value)}
                      placeholder={t('例如：Writer Desk', 'For example: Writer Desk')}
                    />
                  </label>
                  <label className="modal-field">
                    <span>{t('继承哪条现有车道的 env', 'Inherit runtime env from')}</span>
                    <select
                      value={draft.inheritEnvFrom}
                      onChange={(event) => updateDraft('inheritEnvFrom', event.target.value)}
                    >
                      {gateways.map((gateway) => (
                        <option key={gateway.id} value={gateway.id}>
                          {gateway.label} ({gateway.id})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="modal-section">
                <div className="modal-section-title">
                  <Cable size={16} />
                  <span>{t('消息渠道', 'Message channels')}</span>
                </div>
                <p className="modal-helper">
                  {t(
                    '一个 gateway 可以挂多个渠道，但同一种渠道只需要配置一次。',
                    'A gateway can mount multiple channels, but each channel type only needs one config.',
                  )}
                </p>
                <div className="channel-stack">
                  {draft.channels.map((channel) => {
                    const usedTypes = new Set(
                      draft.channels
                        .filter((entry) => entry.id !== channel.id)
                        .map((entry) => entry.channelType),
                    );
                    return (
                      <article key={channel.id} className="channel-card">
                        <div className="channel-card-head">
                          <strong>{t('渠道配置', 'Channel config')}</strong>
                          {draft.channels.length > 1 ? (
                            <button
                              type="button"
                              className="mini-button ghost"
                              onClick={() => removeChannel(channel.id)}
                            >
                              <Trash2 size={14} />
                              {t('移除', 'Remove')}
                            </button>
                          ) : null}
                        </div>
                        <div className="modal-form-grid">
                          <label className="modal-field">
                            <span>{t('渠道类型', 'Channel type')}</span>
                            <select
                              value={channel.channelType}
                              onChange={(event) => {
                                const channelType = event.target.value as ChannelType;
                                updateChannel(channel.id, {
                                  channelType,
                                  streaming: channelType === 'telegram' ? 'partial' : 'off',
                                });
                              }}
                            >
                              {CHANNEL_OPTIONS.map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  disabled={usedTypes.has(option.value)}
                                >
                                  {option.label[languageMode]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="modal-field">
                            <span>
                              {channel.channelType === 'telegram'
                                ? t('Bot Token', 'Bot token')
                                : t('Discord Token', 'Discord token')}
                            </span>
                            <input
                              type="password"
                              value={channel.secret}
                              onChange={(event) =>
                                updateChannel(channel.id, { secret: event.target.value })
                              }
                              placeholder={
                                channel.channelType === 'telegram'
                                  ? '123456789:AA...'
                                  : 'MT...'
                              }
                            />
                          </label>
                          {channel.channelType === 'telegram' ? (
                            <label className="modal-field">
                              <span>{t('私聊策略', 'DM policy')}</span>
                              <select
                                value={channel.dmPolicy}
                                onChange={(event) =>
                                  updateChannel(channel.id, {
                                    dmPolicy: event.target.value as DmPolicy,
                                  })
                                }
                              >
                                <option value="pairing">{t('配对模式', 'Pairing')}</option>
                                <option value="open">{t('开放', 'Open')}</option>
                                <option value="disabled">{t('禁用', 'Disabled')}</option>
                              </select>
                            </label>
                          ) : null}
                          <label className="modal-field">
                            <span>{t('群组策略', 'Group policy')}</span>
                            <select
                              value={channel.groupPolicy}
                              onChange={(event) =>
                                updateChannel(channel.id, {
                                  groupPolicy: event.target.value as GroupPolicy,
                                })
                              }
                            >
                              <option value="allowlist">{t('白名单', 'Allowlist')}</option>
                              <option value="open">{t('开放', 'Open')}</option>
                              <option value="disabled">{t('禁用', 'Disabled')}</option>
                            </select>
                          </label>
                          <label className="modal-field">
                            <span>{t('流式输出', 'Streaming')}</span>
                            <select
                              value={channel.streaming}
                              onChange={(event) =>
                                updateChannel(channel.id, {
                                  streaming: event.target.value as StreamingMode,
                                })
                              }
                            >
                              <option value="partial">{t('分段', 'Partial')}</option>
                              <option value="off">{t('关闭', 'Off')}</option>
                            </select>
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="action-button secondary"
                  onClick={addChannel}
                  disabled={draft.channels.length >= CHANNEL_OPTIONS.length}
                >
                  <Plus size={16} />
                  {t('再加一个渠道', 'Add another channel')}
                </button>
              </section>

              <section className="modal-section">
                <div className="modal-section-title">
                  <Shield size={16} />
                  <span>{t('运行默认值', 'Runtime defaults')}</span>
                </div>
                <label className="modal-toggle">
                  <input
                    type="checkbox"
                    checked={draft.memorySearchEnabled}
                    onChange={(event) => updateDraft('memorySearchEnabled', event.target.checked)}
                  />
                  <div>
                    <strong>{t('启用 Memory Search', 'Enable memory search')}</strong>
                    <span>
                      {t(
                        '适合资料型或长期协作型 gateway；不勾选就保持更轻量的默认模式。',
                        'Useful for research-heavy lanes; leave it off for a lighter default profile.',
                      )}
                    </span>
                  </div>
                </label>
              </section>

              <section className="modal-section">
                <button
                  type="button"
                  className="modal-disclosure"
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <Cpu size={16} />
                  <span>{t('高级参数', 'Advanced settings')}</span>
                </button>
                {advancedOpen ? (
                  <div className="modal-form-grid advanced">
                    <label className="modal-field">
                      <span>{t('Gateway ID', 'Gateway id')}</span>
                      <input
                        value={draft.gatewayId}
                        onChange={(event) => updateDraft('gatewayId', event.target.value)}
                        placeholder={t('留空时会从名称自动生成', 'Auto-generated from the name')}
                      />
                    </label>
                    <label className="modal-field">
                      <span>{t('Profile', 'Profile')}</span>
                      <input
                        value={draft.profile}
                        onChange={(event) => updateDraft('profile', event.target.value)}
                        placeholder={t('默认与 gateway id 相同', 'Defaults to the gateway id')}
                      />
                    </label>
                    <label className="modal-field">
                      <span>{t('WSL 端口', 'WSL port')}</span>
                      <input
                        value={draft.port}
                        onChange={(event) => updateDraft('port', event.target.value)}
                        placeholder={t('留空自动分配', 'Leave blank to auto-assign')}
                      />
                    </label>
                    <label className="modal-field">
                      <span>{t('Browser Profile', 'Browser profile')}</span>
                      <input
                        value={draft.browserProfile}
                        onChange={(event) => updateDraft('browserProfile', event.target.value)}
                        placeholder={t('可选', 'Optional')}
                      />
                    </label>
                    <label className="modal-field">
                      <span>{t('Primary Model', 'Primary model')}</span>
                      <input
                        value={draft.primaryModel}
                        onChange={(event) => updateDraft('primaryModel', event.target.value)}
                        placeholder="kimi-coding/k2p5"
                      />
                    </label>
                    <label className="modal-field">
                      <span>{t('Fallback Models', 'Fallback models')}</span>
                      <textarea
                        rows={3}
                        value={draft.fallbackModels}
                        onChange={(event) => updateDraft('fallbackModels', event.target.value)}
                        placeholder="moonshot/kimi-k2.5, moonshot/kimi-k2-thinking"
                      />
                    </label>
                  </div>
                ) : null}
              </section>

              {errorMessage ? <div className="modal-error">{errorMessage}</div> : null}

              <div className="gateway-modal-actions">
                <button type="button" className="action-button secondary" onClick={onClose}>
                  {t('取消', 'Cancel')}
                </button>
                <button type="submit" className="action-button primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                  {saving ? t('创建中...', 'Creating...') : t('创建受管 Gateway', 'Create managed gateway')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

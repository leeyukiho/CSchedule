import Taro from '@tarojs/taro'

export type HomeShortcutKey =
  | 'query'
  | 'schedule'
  | 'grades'
  | 'buddySpace'
  | 'messages'
  | 'feedback'
  | 'submission'
  | 'settings'
  | 'about'

export interface HomeShortcutConfigItem {
  key: HomeShortcutKey
  label: string
  enabled: boolean
  order: number
}

export interface HomeShortcutConfig {
  items: HomeShortcutConfigItem[]
  updatedAt?: string
}

export type HomeShortcutRuntimeItem = HomeShortcutConfigItem & {
  iconClass: string
  action: HomeShortcutKey
  url: string
  tab?: boolean
}

export const HOME_SHORTCUT_CONFIG_UPDATED_EVENT = 'cschedule.homeShortcuts.updated'

const HOME_SHORTCUT_CONFIG_KEY = 'cschedule.homeShortcuts.config'

export const HOME_SHORTCUT_CATALOG: Record<HomeShortcutKey, Omit<HomeShortcutRuntimeItem, 'order' | 'enabled'>> = {
  query: {
    key: 'query',
    label: '证书查询',
    iconClass: 'home-shortcut-icon-query',
    action: 'query',
    url: '/pages/query/index',
  },
  schedule: {
    key: 'schedule',
    label: '课表',
    iconClass: 'home-shortcut-icon-schedule',
    action: 'schedule',
    url: '/pages/schedule/index',
    tab: true,
  },
  grades: {
    key: 'grades',
    label: '成绩',
    iconClass: 'home-shortcut-icon-grades',
    action: 'grades',
    url: '/pages/grades/index',
    tab: true,
  },
  buddySpace: {
    key: 'buddySpace',
    label: '搭子空间',
    iconClass: 'home-shortcut-icon-buddy',
    action: 'buddySpace',
    url: '/pages/buddy-space/index',
  },
  messages: {
    key: 'messages',
    label: '消息',
    iconClass: 'home-shortcut-icon-message',
    action: 'messages',
    url: '/pages/messages/index',
  },
  feedback: {
    key: 'feedback',
    label: '反馈',
    iconClass: 'home-shortcut-icon-feedback',
    action: 'feedback',
    url: '/pages/feedback/index',
  },
  submission: {
    key: 'submission',
    label: '接入申请',
    iconClass: 'home-shortcut-icon-submission',
    action: 'submission',
    url: '/pages/submission/index',
  },
  settings: {
    key: 'settings',
    label: '设置',
    iconClass: 'home-shortcut-icon-settings',
    action: 'settings',
    url: '/pages/settings/index',
  },
  about: {
    key: 'about',
    label: '关于',
    iconClass: 'home-shortcut-icon-about',
    action: 'about',
    url: '/pages/about/index',
  },
}

export const DEFAULT_HOME_SHORTCUT_CONFIG: HomeShortcutConfig = {
  items: [
    { key: 'query', label: '证书查询', enabled: true, order: 10 },
    { key: 'schedule', label: '课表', enabled: true, order: 20 },
    { key: 'grades', label: '成绩', enabled: true, order: 30 },
    { key: 'buddySpace', label: '搭子空间', enabled: false, order: 40 },
    { key: 'messages', label: '消息', enabled: true, order: 50 },
    { key: 'feedback', label: '反馈', enabled: false, order: 60 },
    { key: 'submission', label: '接入申请', enabled: false, order: 70 },
    { key: 'settings', label: '设置', enabled: false, order: 80 },
    { key: 'about', label: '关于', enabled: false, order: 90 },
  ],
}

export function normalizeHomeShortcutConfig(value: unknown): HomeShortcutConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<HomeShortcutConfig>)
    : {}
  const byKey = new Map<HomeShortcutKey, HomeShortcutConfigItem>()

  for (const item of Array.isArray(record.items) ? record.items : []) {
    const source = item && typeof item === 'object' && !Array.isArray(item)
      ? (item as Partial<HomeShortcutConfigItem>)
      : {}
    const key = source.key

    if (!key || !(key in HOME_SHORTCUT_CATALOG)) {
      continue
    }

    const catalog = HOME_SHORTCUT_CATALOG[key]
    const label = typeof source.label === 'string' && source.label.trim()
      ? source.label.trim().slice(0, 8)
      : catalog.label
    const order = Number(source.order)

    byKey.set(key, {
      key,
      label,
      enabled: source.enabled !== false,
      order: Number.isFinite(order) ? order : DEFAULT_HOME_SHORTCUT_CONFIG.items.find((entry) => entry.key === key)?.order || 0,
    })
  }

  for (const item of DEFAULT_HOME_SHORTCUT_CONFIG.items) {
    if (!byKey.has(item.key)) {
      byKey.set(item.key, item)
    }
  }

  return {
    items: [...byKey.values()].sort((left, right) => left.order - right.order),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

export function buildHomeShortcutRuntimeItems(config: HomeShortcutConfig) {
  return normalizeHomeShortcutConfig(config).items
    .filter((item) => item.enabled)
    .sort((left, right) => left.order - right.order)
    .map((item) => ({
      ...item,
      iconClass: HOME_SHORTCUT_CATALOG[item.key].iconClass,
      action: HOME_SHORTCUT_CATALOG[item.key].action,
      url: HOME_SHORTCUT_CATALOG[item.key].url,
      tab: HOME_SHORTCUT_CATALOG[item.key].tab,
    }))
}

export function getStoredHomeShortcutConfig() {
  return normalizeHomeShortcutConfig(Taro.getStorageSync(HOME_SHORTCUT_CONFIG_KEY))
}

export function setStoredHomeShortcutConfig(config: HomeShortcutConfig) {
  const normalized = normalizeHomeShortcutConfig(config)

  Taro.setStorageSync(HOME_SHORTCUT_CONFIG_KEY, normalized)
  Taro.eventCenter.trigger(HOME_SHORTCUT_CONFIG_UPDATED_EVENT, normalized)
  return normalized
}

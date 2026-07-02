import { ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '../../common/prisma/prisma.service'

type HomeShortcutKey =
  | 'query'
  | 'schedule'
  | 'grades'
  | 'buddySpace'
  | 'messages'
  | 'feedback'
  | 'submission'
  | 'settings'
  | 'about'

interface HomeShortcutConfigItem {
  key: HomeShortcutKey
  label: string
  enabled: boolean
  order: number
}

interface HomeShortcutConfig {
  items: HomeShortcutConfigItem[]
  updatedAt?: string
}

const HOME_SHORTCUT_SETTING_KEY = 'app.homeShortcuts'

const HOME_SHORTCUT_CATALOG: Record<HomeShortcutKey, { label: string }> = {
  query: { label: '证书查询' },
  schedule: { label: '课表' },
  grades: { label: '成绩' },
  buddySpace: { label: '搭子空间' },
  messages: { label: '消息' },
  feedback: { label: '反馈' },
  submission: { label: '接入申请' },
  settings: { label: '设置' },
  about: { label: '关于' },
}

const DEFAULT_HOME_SHORTCUT_CONFIG: HomeShortcutConfig = {
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

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAppSettings() {
    const homeShortcuts = await this.getHomeShortcuts()

    return {
      homeShortcuts: this.toPublicHomeShortcuts(homeShortcuts),
      updatedAt: homeShortcuts.updatedAt,
    }
  }

  async getHomeShortcuts() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: HOME_SHORTCUT_SETTING_KEY },
    })

    return this.normalizeHomeShortcuts(setting?.value)
  }

  async updateHomeShortcuts(input: unknown) {
    const config = {
      ...this.normalizeHomeShortcuts(input),
      updatedAt: new Date().toISOString(),
    }

    await this.prisma.systemSetting.upsert({
      where: { key: HOME_SHORTCUT_SETTING_KEY },
      create: {
        key: HOME_SHORTCUT_SETTING_KEY,
        value: this.toJson(config),
      },
      update: {
        value: this.toJson(config),
      },
    })

    return config
  }

  async assertHomeShortcutEnabled(key: HomeShortcutKey) {
    const homeShortcuts = await this.getHomeShortcuts()
    const shortcut = homeShortcuts.items.find((item) => item.key === key)

    if (!shortcut?.enabled) {
      throw new ForbiddenException('HOME_SHORTCUT_DISABLED')
    }
  }

  private toPublicHomeShortcuts(config: HomeShortcutConfig): HomeShortcutConfig {
    return {
      items: config.items.filter((item) => item.enabled),
      updatedAt: config.updatedAt,
    }
  }

  private normalizeHomeShortcuts(value: unknown): HomeShortcutConfig {
    const record = this.asRecord(value)
    const byKey = new Map<HomeShortcutKey, HomeShortcutConfigItem>()

    for (const item of Array.isArray(record.items) ? record.items : []) {
      const source = this.asRecord(item)
      const key = source.key

      if (!this.isHomeShortcutKey(key)) {
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

  private isHomeShortcutKey(value: unknown): value is HomeShortcutKey {
    return typeof value === 'string' && value in HOME_SHORTCUT_CATALOG
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
  }
}

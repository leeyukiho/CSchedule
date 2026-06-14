import { useState } from 'react'
import Taro from '@tarojs/taro'
import { useDidShow } from '@tarojs/taro'
import { Button, Picker, View } from '@tarojs/components'

import { deactivateAccount } from '../../shared/api/accounts'
import { getTimetable } from '../../shared/api/timetable'
import { PageShell } from '../../shared/layout'
import {
  clearStoredAccountId,
  clearStoredTermStarts,
  getStoredAccountId,
  getStoredTermStarts,
  setStoredTermStart,
} from '../../shared/storage'
import { TermOption, buildTermOptions } from '../../shared/term'

export default function SettingsPage() {
  const [terms, setTerms] = useState<TermOption[]>([])
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [selectedTermId, setSelectedTermId] = useState('')

  useDidShow(() => {
    setTermStarts(getStoredTermStarts())
    void loadTerms()
  })

  async function loadTerms() {
    const accountId = getStoredAccountId()

    if (!accountId) {
      setTerms([])
      return
    }

    try {
      const timetable = await getTimetable(accountId)
      const nextTerms = buildTermOptions(timetable)
      setTerms(nextTerms)
      setSelectedTermId((current) =>
        current && nextTerms.some((term) => term.id === current)
          ? current
          : (nextTerms[0]?.id || ''),
      )
    } catch {
      setTerms([])
      setSelectedTermId('')
    }
  }

  function updateTermStart(termId: string, date: string) {
    setStoredTermStart(termId, date)
    setTermStarts(getStoredTermStarts())
  }

  const selectedTermIndex = Math.max(
    terms.findIndex((term) => term.id === selectedTermId),
    0,
  )
  const selectedTerm = terms[selectedTermIndex] || null

  async function clearCache() {
    const accountId = getStoredAccountId()

    try {
      if (accountId) {
        await deactivateAccount(accountId)
      }

      clearStoredAccountId()
      clearStoredTermStarts()
      Taro.showToast({ title: '已清理缓存', icon: 'success' })
      Taro.switchTab({ url: '/pages/profile/index' })
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '清理失败',
        icon: 'none',
      })
    }
  }

  return (
    <PageShell title='设置' back subPage>
      <View className='soft-card settings-card'>
        <View className='settings-row settings-row-stack'>
          <View>
            <View className='settings-title'>学期首周开始时间</View>
            <View className='settings-desc'>用于计算默认第几周，以及课表周一至周日的日期。</View>
          </View>
        </View>
        {terms.length > 0 && (
          <>
          <View className='settings-row'>
            <View>
              <View className='settings-title'>选择学期</View>
              <View className='settings-desc'>先选择需要调整开始周的学期，再修改日期。</View>
            </View>
            <Picker
              mode='selector'
              range={terms.map((term) => term.label)}
              value={selectedTermIndex}
              onChange={(event) =>
                setSelectedTermId(terms[Number(event.detail.value)]?.id || '')
              }
            >
              <View className='small-button settings-date-button'>
                {selectedTerm?.label || ''}
              </View>
            </Picker>
          </View>
          <View className='settings-row'>
            <View>
              <View className='settings-title'>{selectedTerm?.label || '未选择学期'}</View>
              <View className='settings-desc'>
                {selectedTerm
                  ? (termStarts[selectedTerm.id] || '未设置，将使用默认估算日期')
                  : '请先选择学期'}
              </View>
            </View>
            <Picker
              mode='date'
              value={selectedTerm ? (termStarts[selectedTerm.id] || '') : ''}
              onChange={(event) => {
                if (selectedTerm) {
                  updateTermStart(selectedTerm.id, event.detail.value)
                }
              }}
            >
              <View className='small-button settings-date-button'>
                {selectedTerm && termStarts[selectedTerm.id] ? '修改' : '设置'}
              </View>
            </Picker>
          </View>
          </>
        )}
        {terms.length === 0 && (
          <View className='settings-row settings-row-stack'>
            <View className='settings-desc'>同步课表后可设置各学期首周开始日期。</View>
          </View>
        )}
      </View>
      <View className='soft-card settings-card'>
        <View className='settings-row'>
          <View>
            <View className='settings-title'>清理缓存</View>
            <View className='settings-desc'>清理后需要重新登录学校官网账号。</View>
          </View>
          <Button className='small-button danger-button' onClick={clearCache}>
            清理
          </Button>
        </View>
      </View>
      <View className='settings-note'>清理缓存会退出当前账号，并清空本机保存的登录状态。</View>
    </PageShell>
  )
}

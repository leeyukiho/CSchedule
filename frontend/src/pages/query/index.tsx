import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { PageShell } from '../../shared/layout'
import { useDefaultShare } from '../../shared/share'

type QueryEntry = {
  id: string
  title: string
  desc: string
  tag: string
  tone: 'blue' | 'green' | 'purple'
  url: string
  displayUrl: string
}

const QUERY_ENTRIES: QueryEntry[] = [
  {
    id: 'cet',
    title: '四六级成绩查询',
    desc: '登录后直达全国大学英语四、六级考试成绩查询',
    tag: 'CET',
    tone: 'blue',
    url: 'https://iam.neea.edu.cn/login.html?client_id=prod_query_web&response_type=code&redirect_uri=https%3A%2F%2Fcjcx.neea.edu.cn%2Fhtml1%2Ffolder%2F21033%2F653-1.htm&scope=basic&state=7fc1bc3b9b2a50aedaa18ff18d38ba609371340649156f8d4dc959b8fbf26ec4746cf0a228297603f5212fb8ed676f821a07f9f1d19ac4a453442f15aa998179',
    displayUrl: 'https://cjcx.neea.edu.cn/html1/folder/21033/653-1.htm',
  },
  {
    id: 'ncre',
    title: '计算机等级考试查询',
    desc: '登录后直达全国计算机等级考试成绩查询',
    tag: 'NCRE',
    tone: 'purple',
    url: 'https://iam.neea.edu.cn/login.html?client_id=prod_query_web&response_type=code&redirect_uri=https%3A%2F%2Fcjcx.neea.edu.cn%2Fhtml1%2Ffolder%2F22014%2F5490-1.htm&scope=basic&state=ae1a502135a56ec823fe6b4dcae01a74516fdefa846d580d5096a28661684fde1dd97a415512950e7499210b9e0751952331d362c9365c1a2ec1f963449be914',
    displayUrl: 'https://cjcx.neea.edu.cn/html1/folder/22014/5490-1.htm',
  },
  {
    id: 'putonghua',
    title: '普通话成绩',
    desc: '普通话水平测试成绩与证书信息查询',
    tag: 'PSC',
    tone: 'green',
    url: 'https://zwfw.moe.gov.cn/mandarin/',
    displayUrl: 'https://zwfw.moe.gov.cn/mandarin/',
  },
  {
    id: 'certificate',
    title: '证书查询',
    desc: '中国教育考试网证书查询与验证',
    tag: '证书',
    tone: 'purple',
    url: 'https://zscx.neea.edu.cn/',
    displayUrl: 'https://zscx.neea.edu.cn/',
  },
]

export default function QueryPage() {
  useDefaultShare()

  function openQueryEntry(entry: QueryEntry) {
    Taro.navigateTo({
      url:
        `/pages/query-webview/index?title=${encodeURIComponent(entry.title)}` +
        `&url=${encodeURIComponent(entry.url)}` +
        `&displayUrl=${encodeURIComponent(entry.displayUrl)}`,
    })
  }

  return (
    <PageShell title='证书查询' back subPage>
      <View className='query-page-head'>
        <Text className='query-page-title'>常用查询</Text>
        <Text className='query-page-subtitle'>四六级、计算机等级考试、普通话和证书查询入口集中放在这里。</Text>
      </View>

      <View className='query-entry-list'>
        {QUERY_ENTRIES.map((entry) => (
          <View
            className={`soft-card query-entry-card query-entry-card-${entry.tone}`}
            key={entry.id}
            onClick={() => openQueryEntry(entry)}
          >
            <View className={`query-entry-icon query-entry-icon-${entry.tone}`}>
              <Text>{entry.tag}</Text>
            </View>
            <View className='query-entry-main'>
              <Text className='query-entry-title'>{entry.title}</Text>
              <Text className='query-entry-desc'>{entry.desc}</Text>
            </View>
            <View className='query-entry-arrow' />
          </View>
        ))}
      </View>
    </PageShell>
  )
}

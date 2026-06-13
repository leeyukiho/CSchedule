export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/schedule/index',
    'pages/grades/index',
    'pages/profile/index',
    'pages/bind/index',
    'pages/webview-sync/index',
    'pages/feedback/index',
    'pages/submission/index',
    'pages/settings/index',
    'pages/about/index',
    'pages/admin/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'CSchedule',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f8fb',
  },
  tabBar: {
    color: '#667085',
    selectedColor: '#2f7bff',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
      },
      {
        pagePath: 'pages/schedule/index',
        text: '课表',
      },
      {
        pagePath: 'pages/grades/index',
        text: '成绩',
      },
      {
        pagePath: 'pages/profile/index',
        text: '个人',
      },
    ],
  },
})

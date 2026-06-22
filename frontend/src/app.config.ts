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
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'CSchedule',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f8fb',
  },
  tabBar: {
    custom: true,
    color: '#667085',
    selectedColor: '#2f7bff',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/tabbar/home.png',
        selectedIconPath: 'assets/tabbar/home-active.png',
      },
      {
        pagePath: 'pages/schedule/index',
        text: '课表',
        iconPath: 'assets/tabbar/schedule.png',
        selectedIconPath: 'assets/tabbar/schedule-active.png',
      },
      {
        pagePath: 'pages/grades/index',
        text: '成绩',
        iconPath: 'assets/tabbar/grades.png',
        selectedIconPath: 'assets/tabbar/grades-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '个人',
        iconPath: 'assets/tabbar/profile.png',
        selectedIconPath: 'assets/tabbar/profile-active.png',
      },
    ],
  },
})

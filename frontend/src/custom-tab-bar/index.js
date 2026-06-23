const list = [
  {
    pagePath: 'pages/index/index',
    path: '/pages/index/index',
    text: '首页',
    icon: 'icon-home',
  },
  {
    pagePath: 'pages/schedule/index',
    path: '/pages/schedule/index',
    text: '课表',
    icon: 'icon-calendar',
  },
  {
    pagePath: 'pages/grades/index',
    path: '/pages/grades/index',
    text: '成绩',
    icon: 'icon-score',
  },
  {
    pagePath: 'pages/profile/index',
    path: '/pages/profile/index',
    text: '个人',
    icon: 'icon-user',
  },
]

Component({
  data: {
    selected: 0,
    list,
  },
  lifetimes: {
    attached() {
      this.syncSelected()
    },
  },
  pageLifetimes: {
    show() {
      this.syncSelected()
    },
  },
  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1]
      const route = currentPage ? currentPage.route : ''
      const selected = list.findIndex((item) => item.pagePath === route)

      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected })
      }
    },
    switchTab(event) {
      const { index, path } = event.currentTarget.dataset

      if (!path) {
        return
      }

      if (Number(index) === this.data.selected) {
        const pages = getCurrentPages()
        const currentPage = pages[pages.length - 1]

        if (currentPage && typeof currentPage.onTabReselect === 'function') {
          currentPage.onTabReselect(list[Number(index)])
        }
        return
      }

      wx.switchTab({ url: path })
    },
  },
})

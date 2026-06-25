import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const distDir = join(root, 'dist')
const appJsonPath = join(distDir, 'app.json')
const projectConfigPath = join(distDir, 'project.config.json')
const repoProjectConfigPath = join(root, '..', 'project.config.json')

function fail(message) {
  console.error(`[verify-weapp-build] ${message}`)
  process.exit(1)
}

if (!existsSync(appJsonPath)) {
  fail('dist/app.json was not generated. Run this script from frontend after taro build --type weapp.')
}

if (!existsSync(projectConfigPath)) {
  fail('dist/project.config.json was not generated.')
}

if (!existsSync(repoProjectConfigPath)) {
  fail('repo root project.config.json was not found.')
}

const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8'))
const rootValue = projectConfig.miniprogramRoot

if (rootValue !== './' && rootValue !== '') {
  fail(`dist/project.config.json must use miniprogramRoot "./" or "", got ${JSON.stringify(rootValue)}.`)
}

if (projectConfig.setting?.es6 !== true) {
  fail('dist/project.config.json must enable setting.es6 for WeChat DevTools ES6-to-ES5 transpilation.')
}

const repoProjectConfig = JSON.parse(readFileSync(repoProjectConfigPath, 'utf8'))

if (repoProjectConfig.miniprogramRoot !== 'frontend/dist/') {
  fail(`repo root project.config.json must use miniprogramRoot "frontend/dist/", got ${JSON.stringify(repoProjectConfig.miniprogramRoot)}.`)
}

const repoLaunchPath = repoProjectConfig.condition?.miniprogram?.list?.[0]?.pathName

if (repoLaunchPath !== 'pages/index/index') {
  fail(`repo root project.config.json must launch "pages/index/index", got ${JSON.stringify(repoLaunchPath)}.`)
}

console.log('[verify-weapp-build] dist/app.json found and project config is valid.')

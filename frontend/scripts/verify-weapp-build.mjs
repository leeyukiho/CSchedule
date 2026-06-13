import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const distDir = join(root, 'dist')
const appJsonPath = join(distDir, 'app.json')
const projectConfigPath = join(distDir, 'project.config.json')

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

const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8'))
const rootValue = projectConfig.miniprogramRoot

if (rootValue !== './' && rootValue !== '') {
  fail(`dist/project.config.json must use miniprogramRoot "./" or "", got ${JSON.stringify(rootValue)}.`)
}

console.log('[verify-weapp-build] dist/app.json found and project config is valid.')

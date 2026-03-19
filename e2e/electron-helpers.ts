import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'

const tempHomes: string[] = []

function createIsolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'devdock-e2e-home-'))
  tempHomes.push(home)
  mkdirSync(join(home, 'Workspace'), { recursive: true })
  return home
}

process.on('exit', () => {
  for (const dir of tempHomes) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup failures in test teardown.
    }
  }
})

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const isolatedHome = createIsolatedHome()

  const app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

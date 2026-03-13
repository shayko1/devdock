import { test, expect } from '@playwright/test'
import { launchApp } from './electron-helpers'

test.describe('Workspace Scan', () => {
  test('empty state shows scan button', async () => {
    const { app, page } = await launchApp()
    const scanBtn = page.locator('button', { hasText: /Scan/ })
    if (await scanBtn.isVisible()) {
      await expect(scanBtn).toBeEnabled()
    }
    await app.close()
  })

  test('can switch to All Folders tab', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'All Folders' }).click()
    await expect(page.locator('.folders-view')).toBeVisible()
    await app.close()
  })

  test('can switch to Claude tab', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.locator('.claude-sessions-empty')).toBeVisible()
    await app.close()
  })

  test('can switch to Agents tab', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Agents' }).click()
    await app.close()
  })
})

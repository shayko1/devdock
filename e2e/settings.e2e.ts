import { test, expect } from '@playwright/test'
import { launchApp } from './electron-helpers'

test.describe('Settings', () => {
  test('settings modal opens from titlebar gear button', async () => {
    const { app, page } = await launchApp()
    const gearButton = page.locator('.titlebar button[title="Settings"]')
    await gearButton.click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal h2')).toContainText('Settings')
    await app.close()
  })

  test('settings modal shows workspace path input', async () => {
    const { app, page } = await launchApp()
    const gearButton = page.locator('.titlebar button[title="Settings"]')
    await gearButton.click()
    const input = page.locator('.modal .search-input')
    await expect(input).toBeVisible()
    const value = await input.inputValue()
    expect(value).toContain('Workspace')
    await app.close()
  })

  test('settings modal closes on cancel', async () => {
    const { app, page } = await launchApp()
    const gearButton = page.locator('.titlebar button[title="Settings"]')
    await gearButton.click()
    await expect(page.locator('.modal')).toBeVisible()
    await page.getByText('Cancel').click()
    await expect(page.locator('.modal')).not.toBeVisible()
    await app.close()
  })
})

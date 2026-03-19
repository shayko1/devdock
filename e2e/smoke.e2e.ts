import { test, expect } from '@playwright/test'
import { launchApp } from './electron-helpers'

test.describe('Smoke @smoke', () => {
  test('app launches with all primary tabs', async () => {
    const { app, page } = await launchApp()
    await expect(page).toHaveTitle(/DevDock/)
    await expect(page.locator('.tab', { hasText: 'Launchpad' })).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'All Folders' })).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'Claude' })).toBeVisible()
    await expect(page.locator('.tab', { hasText: 'Agents' })).toBeVisible()
    await app.close()
  })

  test('settings modal opens and exposes workspace path control', async () => {
    const { app, page } = await launchApp()
    await page.locator('.titlebar button[title="Settings"]').click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.getByPlaceholder('/path/to/your/workspace')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.modal')).not.toBeVisible()
    await app.close()
  })

  test('Claude tab shows empty state entrypoint for new sessions', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.locator('.claude-sessions-empty')).toBeVisible()
    await expect(page.getByText('No active Claude sessions.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Claude Session' })).toBeVisible()
    await app.close()
  })

  test('new session modal opens from Claude empty state', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await page.getByRole('button', { name: 'New Claude Session' }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal')).toContainText('New Claude Session')
    await expect(page.locator('.modal label').filter({ hasText: 'worktree' }).locator('input[type="checkbox"]')).not.toBeChecked()
    await app.close()
  })
})

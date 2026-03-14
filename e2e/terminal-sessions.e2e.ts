import { test, expect } from '@playwright/test'
import { launchApp } from './electron-helpers'

test.describe('Terminal Sessions', () => {
  test('Claude tab shows empty state initially', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.locator('.claude-sessions-empty')).toBeVisible()
    await expect(page.getByText('No active Claude sessions.')).toBeVisible()
    await app.close()
  })

  test('New Claude Session button is visible in empty state', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.getByRole('button', { name: 'New Claude Session' })).toBeVisible()
    await app.close()
  })

  test('clicking New Claude Session opens modal', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await page.getByRole('button', { name: 'New Claude Session' }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal')).toContainText('New Claude Session')
    await app.close()
  })

  test('new session modal has worktree checkbox', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await page.getByRole('button', { name: 'New Claude Session' }).click()
    const worktreeLabel = page.locator('.modal label').filter({ hasText: 'worktree' })
    await expect(worktreeLabel).toBeVisible()
    const checkbox = worktreeLabel.locator('input[type="checkbox"]')
    await expect(checkbox).toBeChecked()
    await app.close()
  })

  test('new session modal closes with × button', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await page.getByRole('button', { name: 'New Claude Session' }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await page.locator('.modal').getByRole('button', { name: '×' }).click()
    await expect(page.locator('.modal')).not.toBeVisible()
    await app.close()
  })

  test('switching between tabs preserves state', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.locator('.claude-sessions-empty')).toBeVisible()
    await page.locator('.tab', { hasText: 'Launchpad' }).click()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await expect(page.locator('.claude-sessions-empty')).toBeVisible()
    await app.close()
  })

  test('settings gear button is accessible from Claude tab', async () => {
    const { app, page } = await launchApp()
    await page.locator('.tab', { hasText: 'Claude' }).click()
    await page.locator('.titlebar button[title="Settings"]').click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal')).toContainText('Dangerous Mode')
    await app.close()
  })
})

import { test, expect, Page } from '@playwright/test'
import { launchApp } from './electron-helpers'

async function openSettings(page: Page) {
  await page.locator('.titlebar button[title="Settings"]').click()
  await expect(page.locator('.modal')).toBeVisible()
}

function getDangerousSection(page: Page) {
  return page
    .locator('.modal div')
    .filter({ has: page.getByText('Dangerous Mode', { exact: true }) })
    .first()
}

async function ensureDangerousModeOff(page: Page) {
  const section = getDangerousSection(page)
  const text = await section.textContent()
  if (text?.includes('ON')) {
    await section.getByRole('button', { name: 'Disable' }).click()
    await expect(section).toContainText('OFF')
  }
}

async function enableDangerousMode(page: Page) {
  const section = getDangerousSection(page)
  const text = await section.textContent()
  if (text?.includes('OFF')) {
    await section.getByRole('button', { name: 'Enable' }).click()
    await page.getByTestId('dangerous-confirm-input').fill('I understand the risks')
    await page.getByRole('button', { name: 'Confirm' }).click()
  }
  await expect(section).toContainText('ON')
}

test.describe('Dangerous Mode Settings', () => {
  test('dangerous mode section is visible in settings', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)

    const section = getDangerousSection(page)
    await expect(section).toContainText('Dangerous Mode')
    await expect(section).toContainText('without asking for permission')

    await app.close()
  })

  test('can disable dangerous mode and see OFF badge', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await ensureDangerousModeOff(page)

    const section = getDangerousSection(page)
    await expect(section).toContainText('OFF')
    await expect(section.getByRole('button', { name: 'Enable' })).toBeVisible()

    await app.close()
  })

  test('clicking Enable shows confirmation dialog', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await ensureDangerousModeOff(page)

    const section = getDangerousSection(page)
    await section.getByRole('button', { name: 'Enable' }).click()

    await expect(page.getByText('Are you sure?')).toBeVisible()
    await expect(page.getByTestId('dangerous-confirm-input')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible()

    await app.close()
  })

  test('Confirm button is disabled until exact text', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await ensureDangerousModeOff(page)

    const section = getDangerousSection(page)
    await section.getByRole('button', { name: 'Enable' }).click()

    const confirmBtn = page.getByRole('button', { name: 'Confirm' })
    await expect(confirmBtn).toBeDisabled()

    await page.getByTestId('dangerous-confirm-input').fill('wrong text')
    await expect(confirmBtn).toBeDisabled()

    await page.getByTestId('dangerous-confirm-input').fill('i understand the risks')
    await expect(confirmBtn).toBeDisabled()

    await app.close()
  })

  test('typing exact confirmation enables dangerous mode', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await ensureDangerousModeOff(page)

    await enableDangerousMode(page)

    const section = getDangerousSection(page)
    await expect(section).toContainText('ON')
    await expect(section.getByRole('button', { name: 'Disable' })).toBeVisible()

    await app.close()
  })

  test('Cancel in confirmation dialog hides it', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await ensureDangerousModeOff(page)

    const section = getDangerousSection(page)
    await section.getByRole('button', { name: 'Enable' }).click()
    await expect(page.getByText('Are you sure?')).toBeVisible()

    // Click Cancel inside the confirmation (not the modal footer Cancel)
    await page.getByTestId('dangerous-confirm-input').locator('..').locator('..').getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByTestId('dangerous-confirm-input')).not.toBeVisible()
    await expect(section).toContainText('OFF')

    await app.close()
  })

  test('Disable works without confirmation', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await enableDangerousMode(page)

    const section = getDangerousSection(page)
    await section.getByRole('button', { name: 'Disable' }).click()
    await expect(section).toContainText('OFF')

    await app.close()
  })

  test('save persists dangerous mode and reopen shows it', async () => {
    const { app, page } = await launchApp()
    await openSettings(page)
    await enableDangerousMode(page)

    // Save and close
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.modal')).not.toBeVisible()

    // Reopen and verify
    await openSettings(page)
    const section = getDangerousSection(page)
    await expect(section).toContainText('ON')

    // Clean up — turn it off and save
    await section.getByRole('button', { name: 'Disable' }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await app.close()
  })
})

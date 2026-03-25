import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface AkeylessStatus {
  cliInstalled: boolean
  cliVersion: string | null
  profileConfigured: boolean
  connectRcConfigured: boolean
  scriptExists: boolean
  scriptPath: string
}

function getScriptPath(): string {
  return join(homedir(), 'Downloads', 'db-akeyless-connect.sh')
}

function checkFileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

async function getCliVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    // Try common locations
    const paths = [
      '/usr/local/bin/akeyless',
      '/opt/homebrew/bin/akeyless',
      join(homedir(), 'akeyless'),
      'akeyless',
    ]

    let tried = 0
    for (const cmd of paths) {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout) => {
        tried++
        if (!err && stdout.trim()) {
          resolve(stdout.trim())
          return
        }
        if (tried === paths.length) {
          resolve(null)
        }
      })
    }
  })
}

export function registerAkeylessHandlers() {
  ipcMain.handle('akeyless-check-status', async (): Promise<AkeylessStatus> => {
    const home = homedir()
    const cliVersion = await getCliVersion()
    const profilePath = join(home, '.akeyless', 'profiles', 'wix-keycloak.toml')
    const connectRcPath = join(home, '.akeyless-connect.rc')
    const scriptPath = getScriptPath()

    return {
      cliInstalled: cliVersion !== null,
      cliVersion,
      profileConfigured: checkFileExists(profilePath),
      connectRcConfigured: checkFileExists(connectRcPath),
      scriptExists: checkFileExists(scriptPath),
      scriptPath,
    }
  })

  ipcMain.handle('akeyless-install-cli', async (): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const arch = process.arch === 'arm64' ? 'cli-darwin-arm64' : 'cli-darwin-amd64'
      const url = `https://akeyless-cli.s3.us-east-2.amazonaws.com/cli/latest/${arch}`
      const dest = '/usr/local/bin/akeyless'

      // Download to tmp first, then move
      const tmpDest = join(homedir(), '.akeyless-cli-tmp')
      execFile('curl', ['-fsSL', '-o', tmpDest, url], { timeout: 60000 }, (err) => {
        if (err) {
          resolve({ success: false, error: `Download failed: ${err.message}` })
          return
        }
        try {
          chmodSync(tmpDest, 0o755)
        } catch (e: any) {
          resolve({ success: false, error: `chmod failed: ${e.message}` })
          return
        }

        // Try moving to /usr/local/bin, fall back to ~/akeyless
        execFile('mv', [tmpDest, dest], (mvErr) => {
          if (mvErr) {
            // Fallback: put it in home dir
            const homeDest = join(homedir(), 'akeyless')
            execFile('mv', [tmpDest, homeDest], (mvErr2) => {
              if (mvErr2) {
                resolve({ success: false, error: `Move failed: ${mvErr2.message}` })
              } else {
                resolve({ success: true })
              }
            })
          } else {
            resolve({ success: true })
          }
        })
      })
    })
  })

  ipcMain.handle('akeyless-configure', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const home = homedir()
      const profileDir = join(home, '.akeyless', 'profiles')
      const sshDir = join(home, '.akeyless', '.ssh-akeyless')

      mkdirSync(profileDir, { recursive: true })
      mkdirSync(sshDir, { recursive: true })

      // Write wix-keycloak profile
      const profileContent = `["wix-keycloak"]
  access_id = 'p-ycy3jb5rpp0u'
  access_type = 'saml'`
      writeFileSync(join(profileDir, 'wix-keycloak.toml'), profileContent, 'utf-8')

      // Write .akeyless-connect.rc
      const rcContent = `IDENTITY_FILE="${home}/.akeyless/.ssh-akeyless/id_rsa"
CERT_ISSUER_NAME="/prod/dba/dbaccess-cert-issuer"
AKEYLESS_PROFILE=wix-keycloak
AKEYLESS_GW_REST_API=https://restapi.prod-access.wewix.net
DISPLAY_STAGES=yes
USE_EXTERNAL_SSH_CLIENT=no
BASTION_API_PORT=443
BASTION_API_PROTO=https
SESSION_CACHING=no
BASTION_API_PATH=""
BASTION_API_PREFIX=config-`
      writeFileSync(join(home, '.akeyless-connect.rc'), rcContent, 'utf-8')

      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('akeyless-update-cli', async (): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      execFile('akeyless', ['update'], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, error: stderr || err.message })
        } else {
          resolve({ success: true })
        }
      })
    })
  })
}

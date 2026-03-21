import { useState, useEffect, useCallback } from 'react'

interface NotificationState {
  enabled: boolean
  quietMode: boolean
}

export function useNotifications() {
  const [settings, setSettings] = useState<NotificationState>({ enabled: true, quietMode: true })

  useEffect(() => {
    window.api.notificationGetSettings()
      .then(setSettings)
      .catch(() => { /* notification handlers not available yet */ })
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, enabled }))
    window.api.notificationSetEnabled(enabled)
  }, [])

  const setQuietMode = useCallback((quietMode: boolean) => {
    setSettings(prev => ({ ...prev, quietMode }))
    window.api.notificationSetQuietMode(quietMode)
  }, [])

  return {
    enabled: settings.enabled,
    quietMode: settings.quietMode,
    setEnabled,
    setQuietMode,
  }
}

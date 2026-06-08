import React from 'react'
import { version } from '../../package.json'
import SettingsMenu from './SettingsMenu'

const STATUS_MAP = {
  saved: { label: '저장됨', cls: 'saved' },
  saving: { label: '저장 중…', cls: 'saving' },
  modified: { label: '수정됨', cls: 'modified' },
  error: { label: '저장 실패', cls: 'error' },
}

export default function StatusBar({ file, saveStatus, autoSave, wordCount, settings, onToggleSetting }) {
  const status = STATUS_MAP[saveStatus] || STATUS_MAP.saved
  const fileName = file?.path?.replace(/\\/g, '/').split('/').pop() || ''

  return (
    <div className="status-bar">
      <div className="status-left">
        {file && (
          <span className="status-filepath" title={file.path}>
            {file.path?.replace(/\\/g, '/')}
          </span>
        )}
      </div>

      <div className="status-right">
        {file && (
          <>
            <span className={`status-badge ${status.cls}`}>
              {status.cls === 'modified' && <span className="status-dot" />}
              {status.label}
            </span>
            <span className="status-sep">·</span>
            <span className="status-words">{wordCount.toLocaleString()} 단어</span>
            <span className="status-sep">·</span>
          </>
        )}
        <span className={`status-autosave ${autoSave ? 'on' : 'off'}`}>
          Auto Save {autoSave ? 'ON' : 'OFF'}
        </span>
        <span className="status-sep">·</span>
        <span className="status-version">v{version}</span>
        {settings && onToggleSetting && (
          <SettingsMenu settings={settings} onToggle={onToggleSetting} openUp />
        )}
      </div>
    </div>
  )
}

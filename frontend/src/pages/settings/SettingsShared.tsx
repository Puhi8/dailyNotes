import type { ReactNode } from 'react'

type SettingsSectionProps = {
  children: ReactNode
  title: string
  titleMeta?: string
}

export function SettingsSection({ children, title, titleMeta }: SettingsSectionProps) {
  return <div className="panelSection">
    <h2 className="panelTitle">{title}{titleMeta && <span>{titleMeta}</span>}</h2>
    {children}
  </div>
}

import { useState } from 'react'
import theme, { DEFAULT_ACCENT_COLOR } from '../../data/theme'
import { Button } from '../../utils/simplifyReact'
import { SettingsSection } from './SettingsShared'

export default function AppearanceSettings() {
  const [accentColor, setAccentColorState] = useState(() => theme.settings.accent.get())
  return <SettingsSection title="Appearance">
    <div className="panelRow panelRowTopAlign">
      <div className="panelRowLabelGroup">
        <span>Accent color</span>
      </div>
      <span className="panelRowValue panelRowValueTheme">
        <label className="themeColorField" htmlFor="accent-color">
          <input
            id="accent-color"
            className="themeColorInput"
            type="color"
            value={accentColor}
            onChange={event => setAccentColorState(theme.settings.accent.set(event.target.value))}
          />
          <span className="themeColorValue">{accentColor.toUpperCase()}</span>
        </label>
        <Button.secondaryInline
          onClick={() => confirm("Do you really want to reset your color?") && setAccentColorState(theme.settings.accent.reset())}
          disabled={accentColor === DEFAULT_ACCENT_COLOR}
        >
          Reset
        </Button.secondaryInline>
      </span>
    </div>
  </SettingsSection>
}

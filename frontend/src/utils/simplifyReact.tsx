import { forwardRef, type ChangeEventHandler, type ComponentPropsWithoutRef, type ForwardedRef, type MouseEventHandler, type ReactNode } from 'react'

type ButtonType = 'button' | 'submit' | 'reset'

type ButtonBaseProps = {
  children: ReactNode
  className?: string
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  type?: ButtonType
}

type SecondaryButtonProps = {
  children: ReactNode
  className?: string
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
}

type ModalShellProps = {
  children: ReactNode
  className?: string
  titleId: string
}

type ToggleSwitchProps = {
  ariaLabel: string
  checked: boolean
  disabled?: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
}

type LockInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>

const classes = (...values: Array<string | null | undefined | false>) => values.filter(Boolean).join(' ')

const PrimaryButton = ({ children, className, disabled, onClick, type = 'button' }: ButtonBaseProps) => (
  <button className={classes('stateButton', className)} type={type} onClick={onClick} disabled={disabled}>
    {children}
  </button>
)

const SecondaryButton = ({ children, className, disabled, onClick }: SecondaryButtonProps) => (
  <button className={classes('stateButton stateButtonSecondary', className)} type="button" onClick={onClick} disabled={disabled}>
    {children}
  </button>
)

const SecondaryInlineButton = ({ children, className, onClick, disabled }: SecondaryButtonProps) => (
  <button
    className={classes('stateButton stateButtonSecondary panelInlineButton', className)}
    type="button"
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
)

export const Button = {
  primary: PrimaryButton,
  secondary: SecondaryButton,
  secondaryInline: SecondaryInlineButton,
}

export const ModalShell = ({ children, className, titleId }: ModalShellProps) => (
  <div className="modalBackdrop" role="presentation">
    <div className={classes('stateCard modalCard', className)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {children}
    </div>
  </div>
)

export const ToggleSwitch = ({ ariaLabel, checked, disabled, onChange }: ToggleSwitchProps) => (
  <label className="toggleSwitch" aria-label={ariaLabel}>
    <input
      className="toggleSwitchInput"
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
    <span className="toggleSwitchTrack" />
  </label>
)

const renderLockInput = (
  kind: 'text' | 'password' | 'pin' | 'newPin',
  { className, inputMode, autoComplete, ...props }: LockInputProps,
  ref: ForwardedRef<HTMLInputElement>,
) => (
  <input {...props} ref={ref} className={classes('lockInput', className)}
    type={kind === 'text' ? 'text' : 'password'}
    inputMode={inputMode ?? (kind === 'pin' || kind === 'newPin' ? 'numeric' : 'text')}
    autoComplete={autoComplete ?? (kind === 'newPin' ? 'new-password' : 'off')}
  />
)

export const LockInput = {
  text: forwardRef<HTMLInputElement, LockInputProps>(function LockTextInput(props, ref) {
    return renderLockInput('text', props, ref)
  }),
  password: forwardRef<HTMLInputElement, LockInputProps>(function LockPasswordInput(props, ref) {
    return renderLockInput('password', props, ref)
  }),
  pin: forwardRef<HTMLInputElement, LockInputProps>(function LockPinInput(props, ref) {
    return renderLockInput('pin', props, ref)
  }),
  newPin: forwardRef<HTMLInputElement, LockInputProps>(function LockPinInput(props, ref) {
    return renderLockInput('newPin', props, ref)
  }),
}

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react'

type AutoResizeTextareaProps = ComponentPropsWithoutRef<'textarea'>

const resizeTextarea = (element: HTMLTextAreaElement) => {
  element.style.height = '0px'
  element.style.height = `${element.scrollHeight}px`
}

export default function AutoResizeTextarea(props: AutoResizeTextareaProps) {
  const { onChange, value, ...rest } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => { if (textareaRef.current) resizeTextarea(textareaRef.current) }, [value])
  useLayoutEffect(() => {
    const handleResize = () => { if (textareaRef.current) resizeTextarea(textareaRef.current) }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize) }
  }, [])

  return <textarea
    {...rest}
    ref={textareaRef}
    value={value}
    onChange={event => {
      resizeTextarea(event.currentTarget)
      onChange?.(event)
    }}
  />
}

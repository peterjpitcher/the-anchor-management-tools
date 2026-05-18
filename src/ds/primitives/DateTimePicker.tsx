'use client'

import { Input } from './Input'

interface DateTimePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  type?: 'date' | 'time' | 'datetime-local'
  value: string
  onChange: (v: string) => void
}

export function DateTimePicker({
  type = 'date',
  value,
  onChange,
  ...rest
}: DateTimePickerProps) {
  return (
    <Input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  )
}

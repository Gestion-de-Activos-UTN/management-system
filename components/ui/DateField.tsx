'use client'

import { DatePickerInput, type DatePickerInputProps } from '@mantine/dates'
import { CalendarDays } from 'lucide-react'
import 'dayjs/locale/es'
import classes from './DateField.module.css'

type DateFieldProps = Omit<
  DatePickerInputProps<'default'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'valueFormat' | 'locale' | 'firstDayOfWeek'
> & {
  value?: string | null
  onChange: (value: string) => void
}

/** Calendar dates stay YYYY-MM-DD in form state; their presentation is always Spanish. */
export function DateField({ value, onChange, ...props }: DateFieldProps) {
  return (
    <DatePickerInput
      clearable
      highlightToday
      classNames={classes}
      placeholder="DD-MM-AAAA"
      leftSection={<CalendarDays size={16} strokeWidth={1.5} />}
      leftSectionPointerEvents="none"
      clearButtonProps={{ 'aria-label': 'Borrar fecha' }}
      ariaLabels={{
        nextMonth: 'Mes siguiente',
        previousMonth: 'Mes anterior',
        nextYear: 'Año siguiente',
        previousYear: 'Año anterior',
        nextDecade: 'Década siguiente',
        previousDecade: 'Década anterior',
        monthLevelControl: 'Seleccionar mes',
        yearLevelControl: 'Seleccionar año',
      }}
      {...props}
      type="default"
      locale="es"
      firstDayOfWeek={1}
      valueFormat="DD-MM-YYYY"
      value={value || null}
      onChange={next => onChange(next ?? '')}
    />
  )
}

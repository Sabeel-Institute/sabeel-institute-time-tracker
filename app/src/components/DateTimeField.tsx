// Android side of the date/time input seam (iOS: DateTimeField.ios.tsx, web:
// DateTimeField.web.tsx). Keeps the screens' existing string-based state: value
// is a dayKey ('YYYY-MM-DD') for kind='date' or 'HH:MM' for kind='time'.
//
// Android's picker is a dialog with its own OK and Cancel, so it is shown on
// press and hidden on its one answer.
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { getTheme, spacing } from '../theme';
import { fromPickerDate, toPickerDate, type DateTimeKind } from './dateTimeValue';

const t = getTheme();

export function DateTimeField({
  kind,
  value,
  onChange,
}: {
  kind: DateTimeKind;
  value: string;
  onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);

  const onPicked = (event: DateTimePickerEvent, picked?: Date) => {
    setShow(false);
    if (event.type !== 'set' || !picked) return;
    onChange(fromPickerDate(kind, picked));
  };

  return (
    <>
      <Pressable onPress={() => setShow(true)} style={styles.field}>
        <Text style={styles.value}>{value || (kind === 'date' ? 'Pick a date' : 'Pick a time')}</Text>
      </Pressable>
      {show ? (
        <DateTimePicker value={toPickerDate(kind, value)} mode={kind} onChange={onPicked} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
  },
  value: { fontSize: 15, color: t.text.primary },
});

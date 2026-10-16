// iOS side of the date/time input seam (Android: DateTimeField.tsx, web:
// DateTimeField.web.tsx). The same field and the same string values, so a
// screen never knows which platform it is on.
//
// Android's picker is a dialog with OK and Cancel, which is why that sibling
// shows it on press and hides it on its first answer. On iOS the same component
// is an inline control, and that pattern breaks twice: its default
// presentation is a compact pill that needs a second tap to open, and its time
// wheel reports every column it moves as an answer, so the wheel closed after
// the first one. Setting 13:45 took nine taps (seen on the simulator). Here
// the field opens a sheet holding the whole picker, a calendar for a date and
// the wheel for a time, and Done commits what it shows.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  // What the picker shows while the sheet is open. Committed only by Done, so
  // Cancel (or a tap outside the sheet) leaves the field as it was.
  const [draft, setDraft] = useState<Date | null>(null);
  const insets = useSafeAreaInsets();
  const close = () => setDraft(null);

  return (
    <>
      <Pressable onPress={() => setDraft(toPickerDate(kind, value))} style={styles.field}>
        <Text style={styles.value}>{value || (kind === 'date' ? 'Pick a date' : 'Pick a time')}</Text>
      </Pressable>
      <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[styles.sheet, { paddingBottom: spacing(4) + insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.bar}>
              <Pressable onPress={close} hitSlop={spacing(2)}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (draft) onChange(fromPickerDate(kind, draft));
                  close();
                }}
                hitSlop={spacing(2)}
              >
                <Text style={styles.done}>Done</Text>
              </Pressable>
            </View>
            {draft ? (
              <DateTimePicker
                value={draft}
                mode={kind}
                display={kind === 'date' ? 'inline' : 'spinner'}
                accentColor={t.accent.base}
                textColor={t.text.primary}
                onValueChange={(_, picked) => setDraft(picked)}
                style={styles.picker}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
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
  backdrop: { flex: 1, backgroundColor: t.effect.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: spacing(3),
    paddingHorizontal: spacing(4),
  },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing(2) },
  cancel: { fontSize: 17, color: t.text.secondary },
  done: { fontSize: 17, fontWeight: '700', color: t.accent.base },
  picker: { alignSelf: 'center' },
});

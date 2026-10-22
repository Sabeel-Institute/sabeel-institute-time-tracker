import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export interface PickerItem {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Scalable single-select: a field that opens a searchable modal list. Replaces
 * chip-walls anywhere the option count can grow (activities, approvers).
 */
export function SearchablePicker({
  items,
  selectedId,
  onSelect,
  placeholder,
  title,
  disabled,
}: {
  items: PickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder: string;
  /** Modal header; defaults to the placeholder. */
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(f) || i.sublabel?.toLowerCase().includes(f),
    );
  }, [items, filter]);

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[styles.field, disabled && styles.fieldDisabled]}
      >
        <Text style={selected ? styles.value : styles.placeholder} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Neither Pressable is an accessibility element: one is by default,
            and on iOS it swallows everything under it: the accessibility tree
            held the whole picker as ONE element, so VoiceOver had no row to
            move to and Maestro could not tap one. react-native-web does not forward the prop. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessible={false}>
          <Pressable style={styles.sheet} onPress={() => {}} accessible={false}>
            <Text style={styles.title}>{title ?? placeholder}</Text>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Search…"
              style={styles.search}
              autoFocus
            />
            <FlatList
              data={shown}
              keyExtractor={(i) => i.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
              renderItem={({ item }) => {
                const on = item.id === selectedId;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item.id);
                      setOpen(false);
                      setFilter('');
                    }}
                    style={[styles.row, on && styles.rowOn]}
                  >
                    <View style={styles.rowMain}>
                      <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{item.label}</Text>
                      {item.sublabel ? (
                        <Text style={[styles.rowSub, on && styles.rowSubOn]}>{item.sublabel}</Text>
                      ) : null}
                    </View>
                    {on ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
    gap: spacing(2),
  },
  fieldDisabled: { opacity: 0.5 },
  value: { flex: 1, fontSize: 15, color: t.text.primary },
  placeholder: { flex: 1, fontSize: 15, color: t.text.muted },
  chevron: { color: t.text.muted, fontSize: 13 },
  backdrop: {
    flex: 1,
    backgroundColor: t.effect.overlay,
    justifyContent: 'center',
    padding: spacing(5),
  },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderRadius: 14,
    padding: spacing(4),
    maxHeight: '75%',
    gap: spacing(3),
  },
  title: { fontSize: 16, fontWeight: '700', color: t.text.primary },
  search: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(2.5),
    fontSize: 15,
  },
  list: { flexGrow: 0 },
  empty: { color: t.text.secondary, fontSize: 14, padding: spacing(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(2),
    borderRadius: 8,
    gap: spacing(2),
  },
  rowOn: { backgroundColor: t.accent.base },
  rowMain: { flex: 1 },
  rowLabel: { fontSize: 15, color: t.text.primary, fontWeight: '600' },
  rowLabelOn: { color: t.text.inverse },
  rowSub: { fontSize: 12, color: t.text.secondary },
  rowSubOn: { color: t.accent.goldText },
  check: { color: t.text.inverse, fontWeight: '700' },
});

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
import { Icon } from '../icons';
import { IconButton } from './ui';
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
        <Icon name="expand-more" size={22} color={t.text.secondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Neither Pressable is an accessibility element: one is by default,
            and on iOS it swallows everything under it: the accessibility tree
            held the whole picker as ONE element, so VoiceOver had no row to
            move to and Maestro could not tap one. react-native-web does not forward the prop. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessible={false}>
          <Pressable style={styles.sheet} onPress={() => {}} accessible={false}>
            <View style={styles.titleRow}>
              <Text style={styles.title} role="heading">
                {title ?? placeholder}
              </Text>
              <IconButton icon="close" label="Close" bare onPress={() => setOpen(false)} />
            </View>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Search…"
              placeholderTextColor={t.text.muted}
              accessibilityLabel="Search"
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
                    accessibilityRole="radio"
                    aria-checked={on}
                    style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.rowPressed]}
                  >
                    <View style={styles.rowMain}>
                      <Text style={styles.rowLabel}>{item.label}</Text>
                      {item.sublabel ? <Text style={styles.rowSub}>{item.sublabel}</Text> : null}
                    </View>
                    {on ? <Icon name="check" size={20} color={t.accent.base} /> : null}
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
    backgroundColor: t.bg.inset,
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    minHeight: 44,
    paddingVertical: spacing(2),
    paddingLeft: spacing(3),
    paddingRight: spacing(2),
    gap: spacing(2),
  },
  fieldDisabled: { opacity: 0.5 },
  value: { flex: 1, fontSize: 15, color: t.text.primary },
  placeholder: { flex: 1, fontSize: 15, color: t.text.secondary },
  backdrop: {
    flex: 1,
    backgroundColor: t.effect.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(4),
  },
  // The same panel as every other sheet in the app (Sheet.tsx).
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: t.bg.raised,
    borderColor: t.border.strong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing(4),
    maxHeight: '80%',
    gap: spacing(3),
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(2) },
  title: { flexShrink: 1, fontSize: 18, fontWeight: '700', color: t.text.primary },
  search: {
    backgroundColor: t.bg.inset,
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(3),
    fontSize: 15,
    color: t.text.primary,
    minHeight: 44,
  },
  list: { flexGrow: 0 },
  empty: { color: t.text.secondary, fontSize: 14, padding: spacing(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(3),
    borderRadius: 8,
    gap: spacing(2),
  },
  // The current choice: the accent tint the app uses for "on", not a raspberry slab.
  rowOn: { backgroundColor: t.bg.accentSoft },
  rowPressed: { backgroundColor: t.bg.inset },
  rowMain: { flex: 1 },
  rowLabel: { fontSize: 15, color: t.text.primary, fontWeight: '600' },
  rowSub: { fontSize: 13, color: t.text.secondary },
});

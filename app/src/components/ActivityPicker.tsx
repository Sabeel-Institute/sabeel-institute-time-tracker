import { StyleSheet, Text } from 'react-native';
import type { Activity } from '../activities';
import { SearchablePicker } from './SearchablePicker';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * Activity selection — searchable list so 30 activities stay usable on a phone.
 * `undefined` is a list still loading: the field stands in, dead, rather than
 * saying there are none.
 */
export function ActivityPicker({
  activities,
  selectedId,
  onSelect,
}: {
  activities: Activity[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (activities === undefined) {
    return <SearchablePicker items={[]} selectedId={null} onSelect={onSelect} placeholder="Loading activities…" disabled />;
  }
  if (activities.length === 0) {
    return (
      <Text style={styles.empty}>No activities yet — a manager needs to create one first.</Text>
    );
  }
  return (
    <SearchablePicker
      items={activities.map((a) => ({ id: a.id, label: a.name }))}
      selectedId={selectedId}
      onSelect={onSelect}
      placeholder="Pick an activity"
      title="Activities"
    />
  );
}

const styles = StyleSheet.create({
  empty: { color: t.text.secondary, fontSize: 14 },
});

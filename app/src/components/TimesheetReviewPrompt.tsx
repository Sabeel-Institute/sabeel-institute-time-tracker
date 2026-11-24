import {
  dayLabel,
  entryMinutes,
  formatDuration,
  reviewFlagChange,
  SESSION_CAP_HOURS,
  timeOfDayFor,
  type ReviewFlag,
  type ReviewSnapshot,
} from '@sabeel/shared';
import type { TimeEntry } from '../entries';
import { Sheet } from './Sheet';
import { Button, ErrorText, Notice, Row, RowList } from './ui';

function flagMessage(flag: ReviewFlag, review: ReviewSnapshot): string {
  switch (flag.kind) {
    case 'short':
      return `Short entry · less than ${formatDuration(review.limits.minEntryMinutes)}`;
    case 'long':
      return `Long entry · more than ${formatDuration(review.limits.maxEntryMinutes)}`;
    case 'autoClosed':
      return `Auto-closed at ${SESSION_CAP_HOURS} hours · check when you finished`;
    case 'dayTotal':
      return `${dayLabel(flag.dayKey)} · ${formatDuration(flag.minutes)} total, over ${formatDuration(review.limits.maxDayMinutes)}`;
  }
}

export function reviewHighlights(review?: ReviewSnapshot, submitted?: ReviewSnapshot) {
  const entries = new Map<string, string[]>();
  const days: string[] = [];
  if (review) {
    for (const flag of review.flags) {
      const change = reviewFlagChange(flag, submitted);
      const prefix = change === 'new' ? 'Flagged since submission · ' : change === 'edited' ? 'Changed since submission · ' : '';
      const message = prefix + flagMessage(flag, review);
      if ('entryId' in flag) {
        const messages = entries.get(flag.entryId) ?? [];
        messages.push(message);
        entries.set(flag.entryId, messages);
      } else {
        days.push(message);
      }
    }
  }
  return { entries, days };
}

export function TimesheetReviewPrompt({
  visible,
  mode,
  highlights,
  entries,
  busy,
  error,
  onClose,
  onConfirm,
  onEdit,
}: {
  visible: boolean;
  mode: 'submit' | 'approve';
  highlights: ReturnType<typeof reviewHighlights>;
  entries: TimeEntry[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onEdit: (entryId: string) => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={mode === 'submit' ? 'Review before submitting' : 'Review before approving'}
      closeLabel="Cancel"
      onClose={onClose}
    >
      <Notice tone="info">Check the highlighted hours. Tap an entry to edit it, or confirm if the hours are correct.</Notice>
      {highlights.days.map((message) => <Notice key={message} tone="info">{message}</Notice>)}
      {highlights.entries.size > 0 ? (
        <RowList>
          {entries.map((entry) => {
            const messages = highlights.entries.get(entry.id);
            if (!messages || entry.end === null) return null;
            const times = `${dayLabel(entry.dayKey)} · ${timeOfDayFor(entry.start, entry.timeZone)}–${timeOfDayFor(entry.end, entry.timeZone)}`;
            return (
              <Row
                key={entry.id}
                label={entry.activityName}
                detail={times}
                value={formatDuration(entry.durationMinutes ?? entryMinutes(entry.start, entry.end))}
                review={messages}
                accessibilityLabel={[entry.activityName, times, ...messages, 'Edit this entry.'].join('. ')}
                onPress={busy ? undefined : () => onEdit(entry.id)}
              />
            );
          })}
        </RowList>
      ) : null}
      <ErrorText error={error} />
      <Button
        label={mode === 'submit' ? 'I’ve checked these entries — submit' : 'Confirm approval'}
        block
        disabled={busy}
        onPress={onConfirm}
      />
    </Sheet>
  );
}

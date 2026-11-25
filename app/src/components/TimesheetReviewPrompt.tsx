import {
  dayLabel,
  entryDisplayTimeZone,
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

/** The entries behind a day total, from its recorded contributions. */
function dayTotalEntryIds(flag: Extract<ReviewFlag, { kind: 'dayTotal' }>): string[] {
  return (flag.entryVersions ?? []).flatMap((version) => {
    try {
      const [id] = JSON.parse(version) as unknown[];
      return typeof id === 'string' ? [id] : [];
    } catch {
      return [];
    }
  });
}

export function reviewHighlights(review?: ReviewSnapshot, submitted?: ReviewSnapshot) {
  const entries = new Map<string, string[]>();
  const days: string[] = [];
  const add = (entryId: string, message: string) => {
    const messages = entries.get(entryId) ?? [];
    if (!messages.includes(message)) messages.push(message);
    entries.set(entryId, messages);
  };
  if (review) {
    for (const flag of review.flags) {
      const change = reviewFlagChange(flag, submitted);
      const prefix = change === 'new' ? 'Flagged since submission · ' : change === 'edited' ? 'Changed since submission · ' : '';
      const message = prefix + flagMessage(flag, review);
      if ('entryId' in flag) {
        add(flag.entryId, message);
      } else {
        days.push(message);
        // Highlight the rows that make up the day, so the member can tap one.
        // What changed since submission is said once, on the day itself.
        for (const entryId of dayTotalEntryIds(flag)) {
          add(entryId, `Part of the ${formatDuration(flag.minutes)} total on ${dayLabel(flag.dayKey)}`);
        }
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
            const zone = entryDisplayTimeZone(entry.timeZone);
            const suffix = zone === entry.timeZone ? '' : ' UTC';
            const times = `${dayLabel(entry.dayKey)} · ${timeOfDayFor(entry.start, zone)}–${timeOfDayFor(entry.end, zone)}${suffix}`;
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

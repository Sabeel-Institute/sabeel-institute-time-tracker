import { useState } from 'react';
import { validReviewLimits, type ReviewLimits } from '@sabeel/shared';
import { Button, ErrorText, Field, Notice, Screen, Spinner } from '../components/ui';
import { saveReviewLimits, useReviewLimits } from '../timesheetReview';

function hoursText(minutes: number): string {
  return String(Number((minutes / 60).toFixed(2)));
}

function parseHours(value: string): number {
  const text = value.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 60) : NaN;
}

function ThresholdForm({ saved }: { saved: ReviewLimits }) {
  const [draft, setDraft] = useState<Partial<Record<keyof ReviewLimits, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);

  // Live changes update untouched fields. Preserve the local draft, including
  // when a save fails and another snapshot arrives.
  const minimum = draft.minEntryMinutes ?? String(saved.minEntryMinutes);
  const maximum = draft.maxEntryMinutes ?? hoursText(saved.maxEntryMinutes);
  const daily = draft.maxDayMinutes ?? hoursText(saved.maxDayMinutes);
  const changes: Partial<ReviewLimits> = {
    ...(draft.minEntryMinutes !== undefined
      ? { minEntryMinutes: /^\d+$/.test(minimum.trim()) ? Number(minimum) : NaN } : {}),
    ...(draft.maxEntryMinutes !== undefined ? { maxEntryMinutes: parseHours(maximum) } : {}),
    ...(draft.maxDayMinutes !== undefined ? { maxDayMinutes: parseHours(daily) } : {}),
  };
  const changed = Object.entries(changes).some(([field, value]) => value !== saved[field as keyof ReviewLimits]);

  const edit = (field: keyof ReviewLimits) => (value: string) => {
    if (saving) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
    setSaveSucceeded(false);
  };
  const save = async () => {
    setError(null);
    if (!validReviewLimits({ ...saved, ...changes })) {
      setError('Enter a minimum of at least 1 minute, an entry maximum from the minimum up to 24 hours, and a daily maximum from the entry maximum up to 25 hours.');
      return;
    }
    setSaving(true);
    try {
      await saveReviewLimits(changes);
      setDraft({});
      setSaveSucceeded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Field label="Minimum time per entry (minutes)" value={minimum} onChangeText={edit('minEntryMinutes')} inputMode="numeric" editable={!saving} />
      <Field label="Maximum time per entry (hours)" value={maximum} onChangeText={edit('maxEntryMinutes')} inputMode="decimal" editable={!saving} />
      <Field label="Maximum total per day (hours)" value={daily} onChangeText={edit('maxDayMinutes')} inputMode="decimal" editable={!saving} />
      <ErrorText error={error} />
      <Button label="Save review settings" disabled={saving || !changed} onPress={save} />
      {saveSucceeded ? <Notice tone="success">Review settings saved.</Notice> : null}
    </>
  );
}

export function TimesheetReviewSettingsScreen() {
  const limits = useReviewLimits();
  return (
    <Screen title="Timesheet review settings" width="read">
      <Notice tone="info">
        Entries below the minimum or above a maximum are highlighted for review. Changes apply to draft timesheets and to the approver’s review of pending submissions.
      </Notice>
      {limits ? <ThresholdForm saved={limits} /> : <Spinner label="Loading review settings…" />}
    </Screen>
  );
}

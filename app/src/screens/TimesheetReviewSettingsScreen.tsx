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

function ThresholdForm({ saved, onSaved }: { saved: ReviewLimits; onSaved: () => void }) {
  const [minimum, setMinimum] = useState(String(saved.minEntryMinutes));
  const [maximum, setMaximum] = useState(hoursText(saved.maxEntryMinutes));
  const [daily, setDaily] = useState(hoursText(saved.maxDayMinutes));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draft: ReviewLimits = {
    minEntryMinutes: /^\d+$/.test(minimum.trim()) ? Number(minimum) : NaN,
    maxEntryMinutes: parseHours(maximum),
    maxDayMinutes: parseHours(daily),
  };
  const changed = draft.minEntryMinutes !== saved.minEntryMinutes
    || draft.maxEntryMinutes !== saved.maxEntryMinutes || draft.maxDayMinutes !== saved.maxDayMinutes;

  const save = async () => {
    setError(null);
    if (!validReviewLimits(draft)) {
      setError('Enter a minimum of at least 1 minute, an entry maximum from the minimum up to 24 hours, and a daily maximum from 1 minute to 25 hours.');
      return;
    }
    setSaving(true);
    try {
      await saveReviewLimits(draft);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Field label="Minimum time per entry (minutes)" value={minimum} onChangeText={setMinimum} inputMode="numeric" />
      <Field label="Maximum time per entry (hours)" value={maximum} onChangeText={setMaximum} inputMode="decimal" />
      <Field label="Maximum total per day (hours)" value={daily} onChangeText={setDaily} inputMode="decimal" />
      <ErrorText error={error} />
      <Button label="Save review settings" disabled={saving || !changed} onPress={save} />
    </>
  );
}

export function TimesheetReviewSettingsScreen() {
  const limits = useReviewLimits();
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const key = limits ? `${limits.minEntryMinutes}/${limits.maxEntryMinutes}/${limits.maxDayMinutes}` : '';
  return (
    <Screen title="Timesheet review settings" width="read">
      <Notice tone="info">
        Entries below the minimum or above a maximum are highlighted for review. Changes apply to draft timesheets and to the approver’s review of pending submissions.
      </Notice>
      {limits ? (
        <ThresholdForm key={key} saved={limits} onSaved={() => setSavedKey(key)} />
      ) : <Spinner label="Loading review settings…" />}
      {savedKey !== null && key !== savedKey ? <Notice tone="success">Review settings saved.</Notice> : null}
    </Screen>
  );
}

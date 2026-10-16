import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { REPORT_MAX_LENGTH, REPORT_TOO_LONG, reportTextReady } from '@sabeel/shared';
import {
  explainReportError,
  KEPT_NOT_EMAILED,
  keepReportDraft,
  readReportDraft,
  sendProblemReport,
  SENT_MESSAGE,
} from '../problemReport';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

const LABEL = 'What or who are you reporting, and what is wrong?';

/**
 * Report a problem: one field and Send (the `sabeel-app-stores` skill,
 * decision 4). The person names the entry, note or person and says what is
 * wrong, in their own words; the server keeps it and emails it to the
 * institute's administrators, who reply by email. No categories, no picker,
 * no history: the administrators act through the app's ordinary screens.
 *
 * What is typed survives Back: the draft is kept for this account until it is
 * sent (problemReport.ts).
 */
export function ReportProblemScreen({ uid }: { uid: string }) {
  const [text, setText] = useState(() => readReportDraft(uid));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Button's busy flag is state, a render late; a same-frame second tap would
  // otherwise send the report twice.
  const sending = useRef(false);

  const edit = (value: string) => {
    setText(value);
    keepReportDraft(uid, value);
    setNotice(null);
  };

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setNotice(null);
    try {
      const mail = await sendProblemReport(text);
      setText('');
      keepReportDraft(uid, '');
      setNotice(mail === 'failed' ? KEPT_NOT_EMAILED : SENT_MESSAGE);
    } catch (e) {
      setError(explainReportError(e));
    } finally {
      sending.current = false;
    }
  };

  const tooLong = text.trim().length > REPORT_MAX_LENGTH;

  return (
    <Screen width="read">
      <Text style={styles.intro}>
        Your report goes to the institute’s administrators with your name and email address,
        so they can reply.
      </Text>
      <Text style={styles.label}>{LABEL}</Text>
      <TextInput
        value={text}
        onChangeText={edit}
        multiline
        accessibilityLabel={LABEL}
        style={styles.input}
      />
      {tooLong ? <Text style={styles.hint}>{REPORT_TOO_LONG}</Text> : null}
      <Button label="Send" onPress={send} disabled={!reportTextReady(text)} />
      {notice ? (
        <Text style={[styles.notice, notice === KEPT_NOT_EMAILED && styles.noticeKept]}>{notice}</Text>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, color: t.text.secondary, lineHeight: 20 },
  label: { fontSize: 15, fontWeight: '600', color: t.text.primary, marginTop: spacing(2) },
  input: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
    fontSize: 15,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 13, color: t.feedback.danger },
  notice: { fontSize: 15, color: t.feedback.success, fontWeight: '600' },
  // Kept, but not emailed: not a success to celebrate, nor an error to fix.
  noticeKept: { color: t.text.primary },
});

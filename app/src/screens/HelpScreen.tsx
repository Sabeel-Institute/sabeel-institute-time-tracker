import { Fragment, useState } from 'react';
import { StyleSheet, Text, View, type LayoutRectangle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { HELP_VIDEOS, helpFilmUrl, type HelpAudience, type HelpVariant } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useLayout } from '../theme/layout';
import { HelpFilm } from '../components/HelpFilm';
import { Card, Row, RowList, Screen, SectionTitle, Segmented } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Everyone sees every film, in this order: everyday work, then managers', then admins'. */
const SECTIONS: { audience: HelpAudience; title: string }[] = [
  { audience: 'everyone', title: 'Using the Time Tracker' },
  { audience: 'manager', title: 'For managers' },
  { audience: 'admin', title: 'For admins' },
];

/**
 * Help (More → Help): short narrated films of the app at work, each made on a
 * phone and on a computer. Every film is listed for everyone — a member who
 * has seen what a manager does knows whom to ask.
 */
export function HelpScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Screen width="read" subtitle="Short films of the app at work. Each comes in two versions: on a phone and on a computer.">
      {SECTIONS.map(({ audience, title }) => (
        <Fragment key={audience}>
          <SectionTitle>{title}</SectionTitle>
          <RowList>
            {HELP_VIDEOS.filter((v) => v.audience === audience).map((v) => (
              <Row
                key={v.id}
                testID={`help-film-${v.id}`}
                label={v.title}
                detail={v.summary}
                accessibilityLabel={`${v.title}. ${v.summary}`}
                onPress={() => nav.navigate('HelpFilm', { id: v.id })}
              />
            ))}
          </RowList>
        </Fragment>
      ))}
    </Screen>
  );
}

/** Each cut's shape: the phone films stand, the computer films lie down. */
const ASPECT: Record<HelpVariant, number> = { phone: 390 / 844, computer: 1440 / 900 };

/**
 * The film as large as the room under the heading holds it, WHOLE: a standing
 * film drawn at the column's width is taller than a phone's screen, and its
 * controls and the bottom of the app it shows would sit below the fold.
 */
function fit(room: LayoutRectangle, aspect: number): { width: number; height: number } {
  const width = Math.min(room.width, room.height * aspect);
  return { width, height: width / aspect };
}

/**
 * One help film. It opens on the cut for the screen it is watched on, and the
 * other is a tap away: someone at a computer may want to see the phone.
 */
export function HelpFilmScreen({ id }: { id: string }) {
  const { isWide } = useLayout();
  const film = HELP_VIDEOS.find((v) => v.id === id);
  const [variant, setVariant] = useState<HelpVariant>(isWide ? 'computer' : 'phone');
  const [unplayable, setUnplayable] = useState<HelpVariant | null>(null);
  const [room, setRoom] = useState<LayoutRectangle | null>(null);
  if (!film) {
    return (
      <Screen width="read">
        <Card>
          <Text style={styles.message}>There is no such help film.</Text>
        </Card>
      </Screen>
    );
  }
  return (
    <Screen title={film.title} subtitle={film.summary} width="list" fill>
      <Segmented
        value={variant}
        options={[
          { value: 'phone', label: 'On a phone' },
          { value: 'computer', label: 'On a computer' },
        ]}
        onChange={setVariant}
      />
      <View style={styles.room} onLayout={(e) => setRoom(e.nativeEvent.layout)}>
        {unplayable === variant ? (
          <Card>
            <Text style={styles.message}>This film could not be played. Check your connection and try again.</Text>
          </Card>
        ) : room ? (
          <HelpFilm
            key={`${id}-${variant}`}
            video={helpFilmUrl(id, variant, 'video')}
            captions={helpFilmUrl(id, variant, 'captions')}
            size={fit(room, ASPECT[variant])}
            onError={() => setUnplayable(variant)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  room: { flex: 1, alignItems: 'center', marginTop: spacing(3), minHeight: 200 },
  message: { fontSize: 15, color: t.text.primary },
});

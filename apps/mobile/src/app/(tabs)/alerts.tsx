// Alert history (this user's notifications) plus official JPS alerts and admin announcements.
import type { Hazard, RiskLevel } from '@jagasekitar/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RiskBadge } from '@/components/risk';
import { Paragraph, Screen } from '@/components/screen';
import { useRemote } from '@/hooks/use-remote';
import { useLang } from '@/i18n';
import { formatTime } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';
import { useApp } from '@/providers/app-provider';

interface MyAlert {
  id: string;
  hazard: Hazard | null;
  level: RiskLevel;
  title: string;
  body: string;
  sent_at: string;
  data: { screen?: string; lat?: number; lon?: number };
}

interface OfficialAlert {
  id: number;
  title: string;
  level: RiskLevel;
  district: string | null;
  issued_at: string;
}

interface Broadcast {
  id: string;
  title_en: string;
  title_ms: string | null;
  body_en: string;
  body_ms: string | null;
  level: RiskLevel;
  sent_at: string;
}

async function fetchMine(): Promise<MyAlert[]> {
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('id, hazard, level, title, body, sent_at, data')
    .order('sent_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchOfficial(): Promise<OfficialAlert[]> {
  const { data, error } = await requireSupabase()
    .from('official_alerts')
    .select('id, title, level, district, issued_at')
    .eq('state', 'PERAK')
    .gt('expires_at', new Date().toISOString())
    .order('issued_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchBroadcasts(): Promise<Broadcast[]> {
  const { data, error } = await requireSupabase()
    .from('admin_broadcasts')
    .select('id, title_en, title_ms, body_en, body_ms, level, sent_at')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default function AlertsScreen() {
  const { t, lang, pick } = useLang();
  const router = useRouter();
  const { userId } = useApp();
  const mine = useRemote(userId ? `my-alerts:${userId}` : null, fetchMine);
  const official = useRemote('official-alerts', fetchOfficial, { refreshMs: 15 * 60_000 });
  const broadcasts = useRemote('broadcasts', fetchBroadcasts);
  const { reload: reloadMine } = mine;
  const { reload: reloadOfficial } = official;
  const { reload: reloadBroadcasts } = broadcasts;
  const reloadAll = useCallback(() => {
    reloadMine();
    reloadOfficial();
    reloadBroadcasts();
  }, [reloadMine, reloadOfficial, reloadBroadcasts]);
  useFocusEffect(reloadAll);

  return (
    <Screen title={t('tabs.alerts')}>
      {(broadcasts.data?.length ?? 0) > 0 && (
        <Text style={styles.section}>{t('alerts.announcements')}</Text>
      )}
      {broadcasts.data?.map((b) => (
        <View key={b.id} style={styles.card}>
          <RiskBadge level={b.level} size="sm" />
          <Text style={styles.title}>{pick(b.title_en, b.title_ms)}</Text>
          <Text style={styles.body}>{pick(b.body_en, b.body_ms)}</Text>
          <Text style={styles.time}>{formatTime(b.sent_at, lang)}</Text>
        </View>
      ))}

      <Text style={styles.section}>{t('alerts.mine')}</Text>
      {mine.data?.length === 0 && <Paragraph>{t('alerts.none')}</Paragraph>}
      {mine.data?.map((n) => (
        <Pressable
          key={n.id}
          style={styles.card}
          accessibilityRole="button"
          onPress={() =>
            n.data?.screen &&
            router.push({
              pathname: n.data.screen as '/flood',
              params: { lat: String(n.data.lat ?? ''), lon: String(n.data.lon ?? '') },
            })
          }
        >
          <RiskBadge level={n.level} size="sm" />
          <Text style={styles.title}>{n.title}</Text>
          <Text style={styles.body}>{n.body}</Text>
          <Text style={styles.time}>{formatTime(n.sent_at, lang)}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>{t('alerts.official')}</Text>
      {official.data?.length === 0 && <Paragraph>{t('alerts.noOfficial')}</Paragraph>}
      {official.data?.map((a) => (
        <View key={a.id} style={styles.card}>
          <RiskBadge level={a.level} size="sm" />
          <Text style={styles.title}>🌊 {a.title}</Text>
          <Text style={styles.time}>
            {a.district ? `${a.district} · ` : ''}
            {formatTime(a.issued_at, lang)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '700', color: '#111', marginTop: 8 },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111' },
  body: { fontSize: 15, lineHeight: 21, color: '#333' },
  time: { fontSize: 12, color: '#6b7280' },
});

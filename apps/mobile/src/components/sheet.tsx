// Minimal bottom sheet: slides up over the map, scrolls its content, closes on backdrop tap.
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLang } from '@/i18n';

export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 180,
      }).start();
    }
  }, [visible, slide]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 16 },
          {
            transform: [
              { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
          <Text style={styles.closeText}>{t('common.close')}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0006',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
    marginBottom: 8,
  },
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  close: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f1f4',
    alignItems: 'center',
  },
  closeText: { fontSize: 16, fontWeight: '600', color: '#111' },
});

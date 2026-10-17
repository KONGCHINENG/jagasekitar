// Drifting haze particles that move with the wind (screen-space overlay, no map touch handling).
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

const COUNT = 28;

export function WindParticles({
  bearing,
  speedKmh,
  color = '#b4530966',
}: {
  bearing: number;
  speedKmh: number;
  color?: string;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // Fixed pseudo-random start positions (stable across renders).
  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        x: ((i * 37) % 100) / 100,
        y: ((i * 61) % 100) / 100,
        delay: (i * 211) % 2400,
      })),
    [],
  );
  const [progress] = useState(() => Array.from({ length: COUNT }, () => new Animated.Value(0)));

  useEffect(() => {
    if (reduceMotion || !size.w) return;
    const duration = Math.max(2500, 9000 - speedKmh * 150); // faster wind, faster drift
    const loops = progress.map((p, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(seeds[i]!.delay),
          Animated.timing(p, {
            toValue: 1,
            duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(p, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduceMotion, size.w, speedKmh, progress, seeds]);

  const rad = (bearing * Math.PI) / 180;
  const travel = Math.min(size.w, size.h) * 0.35;
  const dx = Math.sin(rad) * travel;
  const dy = -Math.cos(rad) * travel; // north is up

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {!reduceMotion &&
        size.w > 0 &&
        seeds.map((s, i) => (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              { backgroundColor: color, left: s.x * size.w, top: s.y * size.h },
              {
                opacity: progress[i]!.interpolate({
                  inputRange: [0, 0.2, 0.8, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateX: progress[i]!.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, dx],
                    }),
                  },
                  {
                    translateY: progress[i]!.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, dy],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: { position: 'absolute', width: 18, height: 6, borderRadius: 3 },
});

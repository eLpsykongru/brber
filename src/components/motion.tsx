import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Dimensions, Easing, GestureResponderEvent,
  PanResponder, Pressable, PressableProps, StyleSheet, View, ViewStyle,
} from 'react-native';
import { shouldDismiss } from '../lib/swipe';

// Movement, with no new dependencies.
//
// reanimated + gesture-handler are the usual answer and both are NATIVE
// modules: adopting them means a fresh development build before anything can
// be tested. Core `Animated` drives the same transforms on the UI thread
// (`useNativeDriver`) and `PanResponder` reads the same touches, in JS that
// runs in the build already on the phone.
//
// ponytail: if a list ever janks under a drag, that is the moment to pay for
// reanimated — not before.

const { width: W } = Dimensions.get('window');
/** how far in from the left edge a drag must start to count as "go back" */
const EDGE = 44;

// Lets a back button inside a pushed screen animate out instead of vanishing.
// null when there is no Pushed above — the button then just calls onBack.
const DismissCtx = createContext<((then: () => void) => void) | null>(null);
export const useDismiss = () => useContext(DismissCtx);

/**
 * Wrap a back handler so it leaves the way a swipe does. Outside a Pushed it
 * returns the handler untouched, so a screen can use this unconditionally
 * whether or not anybody pushed it.
 */
export function useBack<T extends (() => void) | undefined>(onBack: T): T {
  const dismiss = useDismiss();
  if (!onBack || !dismiss) return onBack;
  return (() => dismiss(onBack)) as T;
}

/**
 * A screen pushed over whatever came before: slides in from the right, and
 * a drag from the left edge sends it back.
 *
 * The child keeps its own background, so this is a layer, not a wrapper that
 * needs to know what it is carrying.
 */
export function Pushed({ children, onBack, disabled, behind }: {
  children: ReactNode;
  /** called once the screen is off-stage, so the parent unmounts it unseen */
  onBack?: () => void;
  /** a screen with its own horizontal gesture (a map, a carousel) opts out */
  disabled?: boolean;
  /**
   * What this was pushed over. Given it, the screen underneath stays on
   * stage and trails as you drag — the thing that makes a swipe read as
   * "going back" rather than "a card appeared". Omitted, the child simply
   * slides over whatever the canvas is, which is honest but flatter.
   *
   * The caller has to hand it over because this app replaces screens rather
   * than stacking them: nothing else knows what came before.
   */
  behind?: ReactNode;
}) {
  const x = useRef(new Animated.Value(W)).current;
  const [reduced, setReduced] = useState(false);
  // read in a ref as well: the pan responder closes over its handlers once
  const backRef = useRef(onBack);
  backRef.current = onBack;
  const reducedRef = useRef(false);
  reducedRef.current = reduced;

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (live) setReduced(on); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);

  // slide in on mount. Reduce Motion is not a preference to override: it is
  // set by people for whom this movement causes actual symptoms.
  useEffect(() => {
    if (reduced) { x.setValue(0); return; }
    Animated.spring(x, {
      toValue: 0, useNativeDriver: true, damping: 22, stiffness: 210, mass: 0.9,
    }).start();
  }, [reduced, x]);

  // Leaving does not always mean unmounting: a parent that holds several
  // pushed screens (Profile's settings → account → back) swaps the child and
  // keeps this layer. Without putting the screen back on stage the swapped-in
  // child renders off to the right and the user sees a blank app.
  //
  // Coming back in from the left — where the layer underneath sits — is also
  // the honest direction for a step back.
  const reenter = useRef(() => {
    if (reducedRef.current) { x.setValue(0); return; }
    x.setValue(-W * 0.25);
    Animated.spring(x, {
      toValue: 0, useNativeDriver: true, damping: 22, stiffness: 210, mass: 0.9,
    }).start();
  }).current;

  const leave = useRef((then: () => void) => {
    if (reducedRef.current) { then(); x.setValue(0); return; }
    Animated.timing(x, {
      toValue: W, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start(() => { then(); reenter(); });
  }).current;

  const pan = useRef(PanResponder.create({
    // moveX - dx is where the finger went down. Only an edge drag starts a
    // dismissal, or every horizontal scroll in the screen would fight it.
    onMoveShouldSetPanResponder: (_e: GestureResponderEvent, g) =>
      g.dx > 6 && Math.abs(g.dy) < 14 && (g.moveX - g.dx) < EDGE,
    onPanResponderMove: (_e, g) => x.setValue(Math.max(0, g.dx)),
    onPanResponderRelease: (_e, g) => {
      if (shouldDismiss(g.dx, g.vx, W)) {
        leave(() => backRef.current?.());
      } else {
        Animated.spring(x, {
          toValue: 0, useNativeDriver: true, damping: 24, stiffness: 240,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(x, { toValue: 0, useNativeDriver: true, damping: 24, stiffness: 240 }).start();
    },
  })).current;

  const handlers = disabled ? {} : pan.panHandlers;
  const sliding = (
    <Animated.View
      style={[behind ? s.over : s.layer, { transform: [{ translateX: x }] }]}
      {...handlers}>
      {children}
    </Animated.View>
  );

  if (!behind) {
    return <DismissCtx.Provider value={onBack ? leave : null}>{sliding}</DismissCtx.Provider>;
  }

  // a quarter of the width, which is roughly what iOS does: enough to read as
  // depth, not so much that the old screen looks like it is leaving too
  const trail = x.interpolate({
    inputRange: [0, W], outputRange: [-W * 0.25, 0], extrapolate: 'clamp',
  });
  const shade = x.interpolate({
    inputRange: [0, W], outputRange: [0.22, 0], extrapolate: 'clamp',
  });
  return (
    <DismissCtx.Provider value={onBack ? leave : null}>
      <View style={s.layer}>
        <Animated.View style={[s.under, { transform: [{ translateX: trail }] }]}
          pointerEvents="none">
          {behind}
        </Animated.View>
        <Animated.View style={[s.under, s.shade, { opacity: shade }]} pointerEvents="none" />
        {sliding}
      </View>
    </DismissCtx.Provider>
  );
}

/**
 * A press that answers. Scale only — a spring on opacity reads as a flicker,
 * and colour changes fight every screen's own palette.
 */
export function Press({ children, onPress, style, scale = 0.965, disabled, ...rest }: {
  children: ReactNode; style?: ViewStyle | ViewStyle[]; scale?: number;
} & Omit<PressableProps, 'style' | 'children'>) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (t: number) =>
    Animated.spring(v, { toValue: t, useNativeDriver: true, damping: 15, stiffness: 400 }).start();
  return (
    <Pressable
      onPress={onPress} disabled={disabled}
      onPressIn={() => !disabled && to(scale)}
      onPressOut={() => to(1)}
      {...rest}>
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  layer: { flex: 1 },
  under: { ...StyleSheet.absoluteFillObject },
  shade: { backgroundColor: '#000' },
  // the sliding screen is a layer over the old one, and the shadow is what
  // stops the two backgrounds reading as one flat surface mid-drag
  over: {
    ...StyleSheet.absoluteFillObject,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14,
    shadowOffset: { width: -3, height: 0 }, elevation: 16,
  },
});

// re-exported so a screen can add the same feel to something bespoke without
// importing Animated itself
export { Animated, View };

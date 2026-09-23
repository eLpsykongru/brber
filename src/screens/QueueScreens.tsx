import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { isUuid, parseShopCode } from '../lib/shopCode';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow } from '../theme';
import { tr } from '../lib/i18n';
import { useHideTabBar } from '../components/TabBar';

// Turn 27 (walk-in check-in) and turn 28 (the full-screen "You're next").
//
// The shop scans nothing: the customer's phone reads the code by the mirror.
// That code is the one the barber side already prints — src/lib/qr.ts encodes
// https://sterncut.ma/q/<shop code>[?b=<barber code>], and posters printed
// before 0110 carry uuids in the same places.

type Est = { barber_id: string; name: string; ahead: number; wait_min: number };
type Service = { id: string; name: string; price_cents: number; barber_id: string };

const dh = (c: number) => (c / 100).toFixed(0);

// ---- 27a -----------------------------------------------------------------
// A shop's link that opens the app lands on QL-19 (QueueLinkScreen), not here:
// this is the camera and the typed code, in the shop.
export default function CheckInScreen({ onClose, onJoined }: {
  onClose: () => void; onJoined: (bookingId: string) => void;
}) {
  useHideTabBar();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<{ salon: string; barber?: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [torch, setTorch] = useState(false);
  // the camera reports a code many times a second; one lookup at a time
  const looking = useRef(false);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, [permission?.granted]);
  // 38b — a blocked camera opens the typed path rather than parking him in front
  // of a dead viewfinder with the way through as a footnote
  useEffect(() => {
    if (permission && !permission.granted) setManual(true);
  }, [permission?.granted]);

  async function take(raw: string): Promise<boolean> {
    if (looking.current) return false;
    const parsed = parseShopCode(raw);
    if (!parsed) {
      Alert.alert(tr('Not a Sterncut code'), tr('That code is not one of ours.'));
      return false;
    }
    let ids: { salon: string; barber?: string } = { salon: parsed.shop, barber: parsed.barber };
    // 0110 — six characters name the shop; the sheet below works in uuids
    if (!isUuid(parsed.shop) || (parsed.barber && !isUuid(parsed.barber))) {
      looking.current = true;
      const { data, error } = await supabase.rpc('resolve_shop_code',
        { p_shop: parsed.shop, p_barber: parsed.barber ?? null });
      looking.current = false;
      if (error) {
        Alert.alert(tr('Could not check that code'), error.message);
        return false;
      }
      const found = data as { salon: string | null; barber: string | null } | null;
      if (!found?.salon) {
        Alert.alert(tr('Not a Sterncut code'), tr('That code is not one of ours.'));
        return false;
      }
      ids = { salon: found.salon, barber: found.barber ?? undefined };
    }
    setManual(false);
    setScanned(ids);
    return true;
  }

  if (scanned) {
    return <ConfirmWalkIn salonId={scanned.salon} preferBarber={scanned.barber}
      onClose={() => setScanned(null)} onJoined={onJoined} />;
  }

  return (
    <View style={s.scanScreen}>
      {permission?.granted && (
        <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => take(data)} />
      )}
      <View style={s.scanVeil} />

      <View style={s.scanTop}>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={tr('Close')}
          style={({ pressed }) => [s.glassPuck, pressed && s.pressed]}>
          <Ionicons name="close" size={16} color="#fff" />
        </Pressable>
        <Text style={s.scanTitle}>{tr('CHECK IN')}</Text>
        <Pressable onPress={() => setTorch((t) => !t)} hitSlop={8} accessibilityLabel={tr('Torch')}
          style={({ pressed }) => [s.glassPuck, pressed && s.pressed]}>
          <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={17} color="#fff" />
        </Pressable>
      </View>

      <View style={s.reticle}>
        <View style={[s.corner, s.cornerTL]} />
        <View style={[s.corner, s.cornerTR]} />
        <View style={[s.corner, s.cornerBL]} />
        <View style={[s.corner, s.cornerBR]} />
        <View style={s.scanLine} />
      </View>

      <View style={s.scanCopy}>
        <Display size={24} style={s.scanHead}>
          {permission?.granted ? tr('Scan the code\nat the counter') : tr('Shop code')}
        </Display>
        <Text style={s.scanSub}>
          {permission?.granted
            ? tr('Every Sterncut shop has one by the mirror. It puts you in today\'s queue.')
            // 38b — the QR is a convenience, not the mechanism. Six characters
            // under the poster do the same job, so lead with that rather than
            // with the permission he has already refused once.
            : tr('Six characters, printed under the QR on the shop\'s poster.')}
        </Text>
      </View>

      <View style={s.scanFoot}>
        <Pressable onPress={() => setManual(true)}
          style={({ pressed }) => [s.glassBtn, pressed && s.pressed]}>
          <Ionicons name="qr-code-outline" size={16} color="#fff" />
          <Text style={s.glassBtnText}>{tr('Enter the shop code instead')}</Text>
        </Pressable>
        <Text style={s.scanFine}>{tr('No code at the shop? Search the salon and tap Join queue.')}</Text>
        {permission && !permission.granted && (
          <Text style={s.scanLink} onPress={() => Linking.openSettings()}>{tr('Allow the camera')}</Text>
        )}
      </View>

      <Modal visible={manual} transparent animationType="slide" onRequestClose={() => setManual(false)}>
        <Pressable style={s.scrim} onPress={() => setManual(false)} />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Display size={18} style={s.center}>{tr('Shop code')}</Display>
          <TextInput style={s.codeInput} value={code} onChangeText={setCode}
            autoCapitalize="none" placeholder={tr('Paste the link or code')}
            placeholderTextColor={colors.textTertiary} />
          <Pressable onPress={() => take(code)} disabled={!code.trim()}
            style={({ pressed }) => [s.wideDark, !code.trim() && s.disabled, pressed && s.pressed]}>
            <Text style={s.wideDarkText}>{tr('CHECK IN')}</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ---- 27b -----------------------------------------------------------------
function ConfirmWalkIn({ salonId, preferBarber, onClose, onJoined }: {
  salonId: string; preferBarber?: string; onClose: () => void; onJoined: (id: string) => void;
}) {
  const [salon, setSalon] = useState<{ name: string } | null>(null);
  const [ests, setEsts] = useState<Est[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [barber, setBarber] = useState<string | null>(preferBarber ?? null);
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sa, es, sv] = await Promise.all([
      supabase.from('salons').select('name').eq('id', salonId).single(),
      supabase.rpc('salon_queue_estimate', { p_salon: salonId }),
      supabase.from('services').select('id, name, price_cents, barber_id')
        .eq('is_active', true)
        .in('barber_id',
          (await supabase.from('barbers').select('id').eq('salon_id', salonId)).data?.map((b) => b.id) ?? []),
    ]);
    setSalon(sa.data);
    const rows = (es.data ?? []) as Est[];
    setEsts(rows);
    setServices((sv.data ?? []) as Service[]);
    if (!barber && rows.length) setBarber(rows[0].barber_id);
  }, [salonId]);

  useEffect(() => { load(); }, [load]);

  // "Anyone" = whoever is free soonest, which is what the customer means
  const chosen = ests.find((e) => e.barber_id === barber) ?? ests[0] ?? null;
  const menu = [...new Map(services.map((v) => [v.name, v])).values()].slice(0, 6);
  const service = services.find((v) => v.name === serviceName && v.barber_id === chosen?.barber_id)
    ?? services.find((v) => v.name === serviceName) ?? null;

  async function take() {
    if (!chosen || !service) return Alert.alert(tr('Pick a service'), tr('Choose what you are having.'));
    setBusy(true);
    const { data, error } = await supabase.rpc('join_queue',
      { p_barber: chosen.barber_id, p_service: service.id });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not join the queue'), error.message);
    onJoined(data as string);
  }

  const ticketNo = (chosen?.ahead ?? 0) + 1;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <View style={s.sheetHead}>
          <View style={s.sheetSlot} />
          <Display size={18} style={s.sheetTitle}>{tr('Join the queue')}</Display>
          <Pressable onPress={onClose} hitSlop={8} style={[s.sheetSlot, s.sheetSlotEnd]}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.shopRow}>
          <View style={s.shopThumb}>
            <Ionicons name="storefront-outline" size={20} color={colors.accent} />
          </View>
          <View style={s.grow}>
            <Text style={s.shopName}>{salon?.name ?? tr('Salon')}</Text>
            <Text style={s.shopSub}>{tr('You\'re at the shop · code verified')}</Text>
          </View>
          <View style={s.tick}><Ionicons name="checkmark" size={11} color="#16A34A" /></View>
        </View>

        <View style={s.waitCard}>
          <View style={s.waitNow}>
            <Text style={s.waitLabel}>{tr('WAIT NOW')}</Text>
            <Text style={s.waitValue}>{tr('~{wait_min} min', { wait_min: chosen?.wait_min ?? 0 })}</Text>
          </View>
          <View style={s.waitDivider} />
          <Text style={s.waitCopy}>
            {tr('{ahead} {x} ahead · you\'d be ticket Nº {ticketNo}', { ahead: chosen?.ahead ?? 0, x: chosen?.ahead === 1 ? tr('person') : tr('people'), ticketNo: String(ticketNo).padStart(2, '0') })}
          </Text>
        </View>

        <Text style={s.eyebrow}>{tr('SERVICE')}</Text>
        <View style={s.chipRow}>
          {menu.map((v) => {
            const on = serviceName === v.name;
            return (
              <Pressable key={v.name} onPress={() => setServiceName(v.name)}
                style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{tr('{name} · {price_cents} DH', { name: v.name, price_cents: dh(v.price_cents) })}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.eyebrow}>{tr('BARBER')}</Text>
        <View style={s.barberRow}>
          {ests.slice(0, 3).map((e) => {
            const on = chosen?.barber_id === e.barber_id;
            const soon = e.wait_min === Math.min(...ests.map((x) => x.wait_min));
            return (
              <Pressable key={e.barber_id} onPress={() => setBarber(e.barber_id)}
                style={[s.barberCard, on && s.barberCardOn]}>
                <View style={[s.barberAvatar, on && s.barberAvatarOn]}>
                  <Text style={[s.barberInitials, on && s.barberInitialsOn]}>
                    {e.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>
                <Text style={s.barberName}>{e.name.split(' ')[0]}</Text>
                <Text style={[s.barberWait, soon && s.barberWaitSoon]}>{tr('~{wait_min} min', { wait_min: e.wait_min })}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.noteIcon} />
          <Text style={s.noteText}>
            {tr('No deposit for walk-ins — pay in cash at the chair. Stay in the shop or you lose your place.')}
          </Text>
        </View>

        <Pressable onPress={take} disabled={busy || !service}
          style={({ pressed }) => [s.wideDark, (busy || !service) && s.disabled, pressed && s.pressed]}>
          <Text style={s.wideDarkText}>{tr('TAKE TICKET Nº {ticketNo}', { ticketNo: String(ticketNo).padStart(2, '0') })}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ---- 27c -----------------------------------------------------------------
export function WalkInTicketScreen({ ticketNo, ahead, waitMin, barberName, salonName, priceCents, onQueue, onLeave }: {
  ticketNo: number; ahead: number; waitMin: number; barberName: string; salonName: string;
  priceCents: number; onQueue: () => void; onLeave: () => void;
}) {
  useHideTabBar();
  return (
    <View style={s.centreScreen}>
      <View style={s.okCircle}>
        <Ionicons name="checkmark" size={32} color="#16A34A" />
      </View>
      <View>
        <Display size={28} style={s.center}>{tr('You\'re in')}</Display>
        <Text style={s.centreSub}>
          {tr('Take a seat — we\'ll ping you when you\'re next. Pay {barberName} in cash at the chair.', { barberName: barberName.split(' ')[0] })}
        </Text>
      </View>

      <View style={s.ticketCard}>
        <Text style={s.ticketLabel}>{tr('WALK-IN TICKET')}</Text>
        <Text style={s.ticketNo}>Nº {String(ticketNo).padStart(2, '0')}</Text>
        <Text style={s.ticketWho}>{barberName.split(' ')[0]} · {salonName}</Text>
        <View style={s.ticketStats}>
          <Stat value={`${ahead}`} label={tr('AHEAD')} />
          <View style={s.statDivider} />
          <Stat value={`~${waitMin}`} unit={tr(' min')} label={tr('EST. WAIT')} />
          <View style={s.statDivider} />
          <Stat value={dh(priceCents)} unit={tr(' DH')} label={tr('IN CASH')} />
        </View>
      </View>

      <Pressable onPress={onQueue} style={({ pressed }) => [s.wideDark, pressed && s.pressed]}>
        <Text style={s.wideDarkText}>{tr('VIEW LIVE QUEUE')}</Text>
      </Pressable>
      <Text style={s.link} onPress={onLeave}>{tr('Leave the queue')}</Text>
    </View>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}<Text style={s.statUnit}>{unit}</Text></Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ---- 28a / 28b -----------------------------------------------------------
// One component: the same takeover, two phases. 28a is the coral alarm before
// you sit down, 28b the calm ink card once the barber has started.
export function YoureNextScreen({ phase, ticketNo, barberName, salonName, address, etaMin,
  distanceKm, startedAt, depositCents, priceCents, onAck, onMessage }: {
  phase: 'next' | 'chair';
  ticketNo: number; barberName: string; salonName: string; address?: string | null;
  etaMin?: number; distanceKm?: number | null; startedAt?: string | null;
  depositCents: number; priceCents: number;
  onAck: () => void; onMessage: () => void;
}) {
  useHideTabBar();
  const first = barberName.split(' ')[0];
  const chair = phase === 'chair';
  const initials = barberName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <View style={[s.takeover, chair ? s.takeoverChair : s.takeoverNext]}>
      <View style={s.takeTop}>
        <View style={s.liveRow}>
          <View style={[s.liveDot, chair && s.liveDotGreen]} />
          <Text style={[s.liveText, chair && s.liveTextDim]}>
            {chair ? tr('IN PROGRESS') : tr('LIVE QUEUE')}
          </Text>
        </View>
        {/* ponytail: the chair state has no dismiss in the mock. It needs one —
            a barber who forgets to mark the cut done would otherwise strand the
            customer on a takeover. Tapping the ticket is the escape hatch. */}
        <Pressable onPress={chair ? onAck : undefined} disabled={!chair} hitSlop={8}
          style={[s.takeTicket, chair && s.takeTicketChair]}>
          <Text style={s.takeTicketText}>{tr('TICKET Nº {ticketNo}', { ticketNo: String(ticketNo).padStart(2, '0') })}</Text>
        </Pressable>
      </View>

      <View style={s.takeMiddle}>
        {chair ? (
          <View style={s.chairAvatar}>
            <Text style={s.chairInitials}>{initials}</Text>
            <View style={s.chairBadge}>
              <Ionicons name="checkmark" size={13} color={colors.ink} />
            </View>
          </View>
        ) : (
          <View style={s.nextIcon}>
            <Ionicons name="cut-outline" size={34} color="#fff" />
          </View>
        )}

        <View>
          <Text style={[s.takeTitle, chair && s.takeTitleChair]}>
            {chair ? tr('In the chair') : tr('You\'re\nnext')}
          </Text>
          <Text style={[s.takeSub, chair && s.takeSubChair]}>
            {chair
              ? (startedAt
                ? tr('{first} started your cut at {at}. Enjoy it.', { first, at: new Date(startedAt).toTimeString().slice(0, 5) })
                : tr('{first} started your cut. Enjoy it.', { first }))
              : tr('Head to the chair — {first} is finishing up. {place}.', { first, place: address ? `${salonName}, ${address}` : salonName })}
          </Text>
        </View>

        {chair && priceCents > 0 ? (
          <View style={s.chairMoney}>
            <View>
              <Text style={s.chairMoneyLabel}>{tr('PAID FROM WALLET')}</Text>
              <Text style={s.chairMoneyPaid}>{tr('{depositCents} DH', { depositCents: dh(depositCents) })}</Text>
            </View>
            <View style={s.right}>
              <Text style={s.chairMoneyLabel}>{tr('DUE AT THE COUNTER')}</Text>
              <Text style={s.chairMoneyDue}>{tr('{dh} DH', { dh: dh(priceCents - depositCents) })}</Text>
            </View>
          </View>
        ) : chair ? null : (
          <View style={s.etaPill}>
            <Ionicons name="time-outline" size={15} color="#fff" />
            <Text style={s.etaText}>
              {tr('About {etaMin} minutes{x}', { etaMin: etaMin ?? 5, x: distanceKm != null ? tr(' · {distanceKm} Km away', { distanceKm: distanceKm.toFixed(1) }) : '' })}
            </Text>
          </View>
        )}
      </View>

      <View style={s.takeFoot}>
        {chair ? (
          <Text style={s.chairFine}>
            {tr('You\'ll be asked to rate {first} when he marks the cut done.', { first })}
          </Text>
        ) : (
          <>
            <Pressable onPress={onAck} style={({ pressed }) => [s.onMyWay, pressed && s.pressed]}>
              <Text style={s.onMyWayText}>{tr('I\'M ON MY WAY')}</Text>
            </Pressable>
            <Pressable onPress={onMessage} style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color="#fff" />
              <Text style={s.ghostText}>{tr('MESSAGE {first}', { first: first.toUpperCase() })}</Text>
            </Pressable>
            <Text style={s.takeFine}>
              {tr('Need 10 more minutes? Ask {first} to hold your place.', { first })}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  right: { alignItems: 'flex-end' },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  link: { fontSize: font.small, fontWeight: '600', color: colors.accent },

  // 27a
  scanScreen: { flex: 1, backgroundColor: '#0B0B0B' },
  scanVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,11,11,0.55)' },
  scanTop: {
    position: 'absolute', top: 62, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  glassPuck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  scanTitle: {
    flex: 1, textAlign: 'center', fontSize: 11, letterSpacing: 1.98,
    fontWeight: '700', color: 'rgba(255,255,255,0.7)',
  },
  reticle: { position: 'absolute', top: 230, alignSelf: 'center', width: 230, height: 230 },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: colors.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 22 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 22 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 22 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 22 },
  scanLine: {
    position: 'absolute', left: 14, right: 14, top: '50%', height: 2, backgroundColor: colors.accent,
    opacity: 0.85,
  },
  scanCopy: { position: 'absolute', top: 492, left: 26, right: 26, alignItems: 'center' },
  scanHead: { textAlign: 'center', color: '#fff' },
  scanSub: {
    fontSize: font.small, color: 'rgba(255,255,255,0.6)', marginTop: 10,
    lineHeight: 20, textAlign: 'center',
  },
  scanFoot: { position: 'absolute', left: 26, right: 26, bottom: 44, gap: 11 },
  glassBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
  },
  glassBtnText: { fontSize: font.small, fontWeight: '600', color: '#fff' },
  scanFine: {
    textAlign: 'center', fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.45)',
  },
  scanLink: { textAlign: 'center', fontSize: font.small, fontWeight: '600', color: colors.accent },

  // sheets (27b + manual code)
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetSlot: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sheetSlotEnd: { alignItems: 'flex-end' },
  sheetTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.54 },
  codeInput: {
    backgroundColor: colors.bg, borderRadius: 16, height: 52, paddingHorizontal: 18,
    fontSize: 14, color: colors.text, ...shadow,
  },

  shopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  shopThumb: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  shopName: { fontSize: 14, fontWeight: '700', color: colors.text },
  shopSub: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  tick: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },

  waitCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.ink,
    borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18,
  },
  waitNow: { alignItems: 'center', gap: 1 },
  waitLabel: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  waitValue: { fontFamily: serif, fontSize: 22, lineHeight: 25, color: '#fff' },
  waitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.12)' },
  waitCopy: { flex: 1, fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.6)' },

  eyebrow: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -5 },
  chip: {
    borderRadius: radius.pill, backgroundColor: colors.bg,
    paddingVertical: 10, paddingHorizontal: 16, ...shadow,
  },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 12, fontWeight: '600', color: '#5C5C58' },
  chipTextOn: { color: '#fff' },

  barberRow: { flexDirection: 'row', gap: 9, marginTop: -5 },
  barberCard: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 16, padding: 12,
    alignItems: 'center', gap: 6, ...shadow,
  },
  barberCardOn: { borderWidth: 2, borderColor: colors.ink },
  barberAvatar: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  barberAvatarOn: { backgroundColor: colors.accentSoft },
  barberInitials: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  barberInitialsOn: { color: colors.accent },
  barberName: { fontSize: 12, fontWeight: '700', color: colors.text },
  barberWait: { fontSize: 10, color: colors.textSecondary },
  barberWaitSoon: { color: '#16A34A', fontWeight: '600' },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  wideDark: {
    width: '100%', height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  wideDarkText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: '#fff' },

  // 27c
  centreScreen: {
    flex: 1, backgroundColor: colors.surface, paddingHorizontal: 26,
    justifyContent: 'center', alignItems: 'center', gap: 18,
  },
  okCircle: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  centreSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 9, lineHeight: 20,
    maxWidth: 280, textAlign: 'center',
  },
  ticketCard: {
    width: '100%', backgroundColor: colors.ink, borderRadius: 24,
    paddingVertical: 22, paddingHorizontal: 20, alignItems: 'center', gap: 6,
  },
  ticketLabel: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  ticketNo: { fontFamily: serif, fontSize: 52, lineHeight: 54, color: '#fff' },
  ticketWho: { fontSize: font.small, color: 'rgba(255,255,255,0.6)' },
  ticketStats: {
    flexDirection: 'row', justifyContent: 'center', gap: 22, width: '100%', marginTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 14,
  },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  statUnit: { fontSize: 12, fontWeight: '400', color: 'rgba(255,255,255,0.5)' },
  statLabel: { fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.5)' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)' },

  // 28
  takeover: { flex: 1 },
  takeoverNext: { backgroundColor: colors.accent },
  takeoverChair: { backgroundColor: colors.ink },
  takeTop: {
    position: 'absolute', top: 66, left: 26, right: 26,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  liveDotGreen: { backgroundColor: '#4ADE80' },
  liveText: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  liveTextDim: { color: 'rgba(255,255,255,0.55)' },
  takeTicket: {
    backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999,
    paddingVertical: 6, paddingHorizontal: 11,
  },
  takeTicketChair: { backgroundColor: 'rgba(255,255,255,0.12)' },
  takeTicketText: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: '#fff' },

  takeMiddle: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20,
    paddingHorizontal: 26, paddingBottom: 60,
  },
  nextIcon: {
    width: 78, height: 78, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  chairAvatar: {
    width: 96, height: 96, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  chairInitials: { fontFamily: serif, fontSize: 30, color: '#fff' },
  chairBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 30, height: 30, borderRadius: 999,
    backgroundColor: '#4ADE80', borderWidth: 4, borderColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  takeTitle: {
    fontFamily: serif, fontSize: 52, lineHeight: 51, color: '#fff',
    textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.52,
  },
  takeTitleChair: { fontSize: 36, lineHeight: 38 },
  takeSub: {
    fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.85)', marginTop: 14,
    maxWidth: 280, textAlign: 'center',
  },
  takeSubChair: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 12 },
  etaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
    paddingVertical: 11, paddingHorizontal: 18,
  },
  etaText: { fontSize: font.small, fontWeight: '700', color: '#fff' },
  chairMoney: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 22,
    paddingVertical: 18, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  chairMoneyLabel: {
    fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: 'rgba(255,255,255,0.45)',
  },
  chairMoneyPaid: {
    fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 5, fontVariant: ['tabular-nums'],
  },
  chairMoneyDue: {
    fontFamily: serif, fontSize: 26, lineHeight: 28, color: '#fff', marginTop: 3,
    fontVariant: ['tabular-nums'],
  },

  takeFoot: { position: 'absolute', left: 26, right: 26, bottom: 44, gap: 11 },
  onMyWay: {
    height: 54, borderRadius: radius.pill, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  onMyWayText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: colors.accent },
  ghostBtn: {
    height: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
  },
  ghostText: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.78, color: '#fff' },
  takeFine: {
    textAlign: 'center', fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.7)', marginTop: 2,
  },
  chairFine: {
    textAlign: 'center', fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.45)',
  },
});

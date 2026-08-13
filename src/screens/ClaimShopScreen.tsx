import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Btn, GhostBtn, Ico, Screen, Serif, T } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// Turn 12 of "Barber App.dc.html" — Brahim claims the shop Nadia created. The
// other end of admin 11a, and the reason admin 11 could stop where it did:
// "ops can start a shop but cannot finish one."
//
// The turn's own framing sets the shape of 12a: **the shop already exists and he
// has to recognise it, so the first screen is a confirmation, not a form** — and
// the very first thing he can do is say it isn't his. That is why "This isn't my
// shop" is a plain, always-available row and not a hidden escape hatch.
//
// Everything Nadia typed is editable "because she typed it on a phone in a
// doorway", so each of the three facts has a Change that turns it into a field.
//
// Three steps, one screen: 12a confirm → 12b licence → 12c sent. It holds its own
// step state rather than re-reading my_invite(), because claim_salon() clears the
// invite the moment 12a is answered — re-reading would strand him on step two.

export type Invite = {
  salon: string; name: string; address: string | null; district: string | null;
  owner_name: string | null; owner_phone: string | null;
  invited_at: string; invited_by: string; token: string;
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** 12b prints the date the way a licence does, and we only check name + expiry. */
function parseExpiry(d: string, m: string, y: string): string | null {
  const dd = parseInt(d, 10), mm = parseInt(m, 10), yy = parseInt(y, 10);
  if (!dd || !mm || !yy || dd > 31 || mm > 12 || yy < 2000) return null;
  const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export default function ClaimShopScreen({ invite, onDone, onGo }: {
  invite: Invite;
  /** claimed and finished — the app reloads the user and carries on */
  onDone: () => void;
  /** 12c's WHILE YOU WAIT — both are screens he already has */
  onGo?: (where: 'hours' | 'team') => void;
}) {
  const [step, setStep] = useState<'confirm' | 'licence' | 'sent'>('confirm');
  const [busy, setBusy] = useState(false);

  // 12a — everything Nadia wrote, editable
  const [name, setName] = useState(invite.name);
  const [address, setAddress] = useState(invite.address ?? '');
  const [district, setDistrict] = useState(invite.district ?? '');
  const [editing, setEditing] = useState<'name' | 'where' | null>(null);

  // 12b
  const [dd, setDd] = useState(''); const [mm, setMm] = useState(''); const [yy, setYy] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  async function yesThisIsMine() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('claim_salon', {
        p_token: invite.token, p_name: name.trim(),
        p_address: address.trim(), p_district: district.trim(),
      });
      if (error) throw error;
      setStep('licence');
    } catch (e: any) {
      Alert.alert('Could not claim it', e.message ?? 'Try again in a moment.');
    } finally { setBusy(false); }
  }

  function notMyShop() {
    Alert.alert('This isn\'t your shop?', 'It goes back to the Sterncut team. Nobody sees it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'It isn\'t mine', style: 'destructive',
        onPress: async () => {
          try {
            await supabase.rpc('decline_invite', { p_token: invite.token, p_reason: null });
          } finally { onDone(); }
        },
      },
    ]);
  }

  async function pickLicence() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setPhoto(res.assets[0].uri);
  }

  async function saveLicence() {
    const iso = parseExpiry(dd, mm, yy);
    if (!iso) return Alert.alert('The date', 'Day, month and year off the licence.');
    setBusy(true);
    try {
      let path: string | null = null;
      if (photo) {
        const { data: me } = await supabase.auth.getUser();
        // same insert-only storage path onboarding uses: unique name, no overwrite
        path = `${me.user!.id}/licence-${Date.now()}.jpg`;
        const body = await fetch(photo).then((r) => r.arrayBuffer());
        const up = await supabase.storage.from('id-documents')
          .upload(path, body, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const { error } = await supabase.rpc('set_my_licence', { p_expires: iso, p_path: path });
      if (error) throw error;
      setStep('sent');
    } catch (e: any) {
      Alert.alert('Could not save it', e.message ?? 'Try again in a moment.');
    } finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- 12a ----
  if (step === 'confirm') {
    const fact = (label: string, lines: string[], key: 'name' | 'where' | null) => (
      <View style={s.fact} key={label}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>{label}</T>
          {lines.map((l, i) => (
            <T key={i} size={i === 0 ? 15 : 12} w={i === 0 ? 'b' : 'r'}
              c={i === 0 ? D.text : D.sub} style={{ marginTop: i === 0 ? 5 : 2 }}>{l}</T>
          ))}
        </View>
        {key && (
          <Pressable onPress={() => setEditing(editing === key ? null : key)} hitSlop={8}>
            <T size={12} w="sb" c={D.accent}>{editing === key ? 'Done' : 'Change'}</T>
          </Pressable>
        )}
      </View>
    );

    return (
      <Screen gap={16}>
        <View style={s.who}>
          <View style={s.dot}><T size={10} w="b">NL</T></View>
          <T size={12} c={D.sub} style={{ flex: 1 }}>
            {invite.invited_by} set this up with you today at {hhmm(invite.invited_at)}.
          </T>
        </View>

        <Serif size={30}>Is this{'\n'}your shop?</Serif>
        <T size={13} c={D.sub}>Check what she wrote down. You can change any of it.</T>

        <View style={{ gap: 10, marginTop: 4 }}>
          {editing === 'name'
            ? (
              <View style={s.fact}>
                <View style={{ flex: 1 }}>
                  <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>SHOP</T>
                  <TextInput value={name} onChangeText={setName} style={s.input}
                    placeholder="Coiffure Atlas" placeholderTextColor={D.muted} />
                </View>
                <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                  <T size={12} w="sb" c={D.accent}>Done</T>
                </Pressable>
              </View>
            )
            : fact('SHOP', [name], 'name')}

          {editing === 'where'
            ? (
              <View style={s.fact}>
                <View style={{ flex: 1 }}>
                  <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>WHERE</T>
                  <TextInput value={address} onChangeText={setAddress} style={s.input}
                    placeholder="18 Bd Moulay Youssef" placeholderTextColor={D.muted} />
                  <TextInput value={district} onChangeText={setDistrict} style={s.input}
                    placeholder="Malabata" placeholderTextColor={D.muted} />
                </View>
                <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                  <T size={12} w="sb" c={D.accent}>Done</T>
                </Pressable>
              </View>
            )
            : fact('WHERE', [address || '—', district ? `${district}, Tangier` : 'Tangier'], 'where')}

          {/* the phone is the one thing he cannot change here: it is what the
              invite was matched on, and editing it would orphan the shop */}
          {fact('YOU', [invite.owner_name || '—', `${invite.owner_phone ?? ''} · this phone`], null)}
        </View>

        <View style={s.left}>
          <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>
            THREE THINGS LEFT · ABOUT 5 MINUTES
          </T>
          {['A photo of your licence', 'A pin on your door', 'Your prices and a few photos']
            .map((l, i) => (
              <View key={l} style={s.step}>
                <View style={s.num}><T size={10} w="b" c={D.sub}>{i + 1}</T></View>
                <T size={13} c={D.textDim}>{l}</T>
              </View>
            ))}
        </View>

        <Btn title={busy ? 'ONE MOMENT…' : 'YES, THIS IS MY SHOP'}
          onPress={busy ? () => {} : yesThisIsMine} />
        <Pressable onPress={notMyShop} style={{ alignSelf: 'center', paddingVertical: 10 }}>
          <T size={13} c={D.sub}>This isn&apos;t my shop</T>
        </Pressable>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- 12b ----
  if (step === 'licence') {
    return (
      <Screen gap={16}>
        <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>STEP 1 OF 3</T>
        <Serif size={28}>Your licence</Serif>
        <T size={13} c={D.sub}>
          Lay it flat and get the whole page in. We only check the name and the expiry date.
        </T>

        <Pressable onPress={pickLicence} style={[s.shot, photo ? s.shotOn : null]}>
          <Ico name={photo ? 'check-circle' : 'camera'} size={22}
            color={photo ? D.green : D.sub} />
          <T size={13} c={photo ? D.green : D.sub} style={{ marginTop: 8 }}>
            {photo ? 'Photo added — tap to retake' : 'Photograph the licence'}
          </T>
        </Pressable>

        <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6, marginTop: 4 }}>
          WHEN DOES IT RUN OUT?
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput value={dd} onChangeText={setDd} placeholder="14" maxLength={2}
            keyboardType="number-pad" placeholderTextColor={D.muted} style={[s.input, s.date]} />
          <T size={16} c={D.muted}>/</T>
          <TextInput value={mm} onChangeText={setMm} placeholder="03" maxLength={2}
            keyboardType="number-pad" placeholderTextColor={D.muted} style={[s.input, s.date]} />
          <T size={16} c={D.muted}>/</T>
          <TextInput value={yy} onChangeText={setYy} placeholder="2027" maxLength={4}
            keyboardType="number-pad" placeholderTextColor={D.muted}
            style={[s.input, s.date, { width: 78 }]} />
        </View>
        <T size={12} c={D.sub}>
          We&apos;ll warn you nine days before it expires, so it never catches you out.
        </T>

        <Btn title={busy ? 'SAVING…' : 'NEXT · THE PIN'} onPress={busy ? () => {} : saveLicence} />
        {/* the turn offers this on purpose — the licence is his to fetch, and he
            may not have it on him. The shop stays unlisted either way. */}
        <Pressable onPress={() => setStep('sent')} style={{ alignSelf: 'center', paddingVertical: 10 }}>
          <T size={13} c={D.sub}>I&apos;ll do this later</T>
        </Pressable>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- 12c ----
  const line = (title: string, sub: string, when: string, done: boolean) => (
    <View style={s.tl} key={title}>
      <View style={[s.tlDot, done ? s.tlDone : null]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={13} w="sb" c={done ? D.text : D.sub}>{title}</T>
        <T size={11} c={D.sub} style={{ marginTop: 2 }}>{sub}</T>
      </View>
      <T size={10} c={D.sub}>{when}</T>
    </View>
  );

  return (
    <Screen gap={16}>
      <View style={s.tick}><Ico name="check" size={26} color={D.green} /></View>
      <Serif size={28}>All three done</Serif>
      <T size={13} c={D.sub}>
        {invite.invited_by} checks it and turns you on. Usually the same day.
      </T>

      <View style={{ gap: 2, marginTop: 6 }}>
        {line(`${invite.invited_by} added your shop`, 'In the shop with you', hhmm(invite.invited_at), true)}
        {line('You finished your bit', 'Licence, pin, services, photos', 'Now', true)}
        {line(`${invite.invited_by} turns you on`,
          `Then people searching ${district || 'Tangier'} find you`, 'Soon', false)}
      </View>

      <View style={s.left}>
        <T size={9} w="b" c={D.sub} style={{ letterSpacing: 1.6 }}>WHILE YOU WAIT</T>
        <T size={13} c={D.textDim} style={{ marginTop: 6 }}>
          Nobody can book you yet, but you can set your hours so your first day isn&apos;t a mess.
        </T>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <GhostBtn title="SET HOURS" style={{ flex: 1 }}
            onPress={() => { onGo?.('hours'); onDone(); }} />
          <GhostBtn title="ADD A BARBER" style={{ flex: 1 }}
            onPress={() => { onGo?.('team'); onDone(); }} />
        </View>
      </View>

      <Btn title="GO TO MY SHOP" onPress={onDone} />
    </Screen>
  );
}

const s = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: {
    width: 28, height: 28, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  fact: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: D.card, borderRadius: 16, padding: 14,
  },
  input: {
    backgroundColor: D.bg, borderWidth: 1, borderColor: D.border, borderRadius: 10,
    color: D.text, fontSize: 14, paddingHorizontal: 11, paddingVertical: 9, marginTop: 6,
  },
  date: { width: 62, textAlign: 'center' },
  left: { backgroundColor: D.card, borderRadius: 18, padding: 16, gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  num: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  shot: {
    borderWidth: 1, borderColor: D.muted, borderStyle: 'dashed', borderRadius: 18,
    paddingVertical: 34, alignItems: 'center', justifyContent: 'center',
  },
  shotOn: { borderColor: D.greenLine, borderStyle: 'solid', backgroundColor: D.greenSoft10 },
  tl: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11 },
  tlDot: {
    width: 10, height: 10, borderRadius: 999, marginTop: 4,
    borderWidth: 1, borderColor: D.muted,
  },
  tlDone: { backgroundColor: D.green, borderColor: D.green },
  tick: {
    width: 54, height: 54, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
});

import { supabase } from './supabase';
import { tr } from './i18n';

// CALL HIM and HE'S HERE are one write — 0018's check-in — on whichever board they are
// pressed (turn B11). Only a man called up from somewhere else is told; one who walked
// in is already standing there.
// ponytail: chat is the only push an app client gets (BACKLOG: reminders increment).
export async function checkIn(bookingId: string, tellInChat: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('advance_booking', { p_booking: bookingId, p_stage: 'check_in' });
  if (error) return error.message;
  if (tellInChat) {
    await supabase.from('messages').insert({ booking_id: bookingId, body: tr("You're next — head over.") });
  }
  return null;
}

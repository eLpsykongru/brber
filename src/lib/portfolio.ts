import { supabase } from './supabase';

// Portfolio photos live at portfolio/{barberId}/{filename} in a public bucket.
// Shared by the barber's manager screen and the customer's gallery.

export async function listPortfolio(barberId: string): Promise<{ name: string; url: string }[]> {
  const { data, error } = await supabase.storage.from('portfolio')
    .list(barberId, { sortBy: { column: 'created_at', order: 'desc' } });
  if (error || !data) return [];
  return data
    .filter((f) => f.id) // skip folder placeholders
    .map((f) => ({
      name: `${barberId}/${f.name}`,
      url: supabase.storage.from('portfolio').getPublicUrl(`${barberId}/${f.name}`).data.publicUrl,
    }));
}

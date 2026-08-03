export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: 'customer' | 'barber' | 'admin';
  // 19a/19b — settings and the customer's own profile (0039). Optional because
  // most callers select the short column list above.
  email?: string | null;         // from auth, not a column; filled where known
  language?: string | null;
  dob?: string | null;
  usual_service?: string | null;
};

export type Salon = {
  id: string;
  name: string;
  address: string | null;
  bio: string | null;
};

export type Service = {
  id: string;
  name: string;
  price_cents: number;
  duration_min: number;
  is_active: boolean;
};

export type Barber = {
  id: string;
  bio: string | null;
  status: 'pending' | 'approved' | 'rejected';
  id_document_path: string | null;
  salon_id: string | null;
  specialty: string | null;
  years_experience: number | null;
};

// shape the customer-facing specialist screens work with (embedded query result)
export type Specialist = {
  id: string;
  bio: string | null;
  status: string;
  salon_status?: string; // salon membership; only 'approved' members show publicly
  specialty: string | null;
  years_experience: number | null;
  profiles: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
  reviews: { rating: number }[];
  services: { id: string; name: string; price_cents: number; duration_min: number; is_active: boolean; category?: string }[];
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: 'customer' | 'barber' | 'admin';
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
  specialty: string | null;
  years_experience: number | null;
  profiles: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
  reviews: { rating: number }[];
  services: { name: string; is_active: boolean }[];
};

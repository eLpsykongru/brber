export type Profile = {
  id: string;
  full_name: string | null;
  role: 'customer' | 'barber' | 'admin';
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
  shop_name: string | null;
  shop_address: string | null;
  bio: string | null;
  status: 'pending' | 'approved' | 'rejected';
  id_document_path: string | null;
};

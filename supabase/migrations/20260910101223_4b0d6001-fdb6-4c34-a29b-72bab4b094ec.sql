CREATE TABLE public.geocode_cache (
  query_key text PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.geocode_cache TO service_role;
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.route_cache (
  route_key text PRIMARY KEY,
  distance_m double precision NOT NULL,
  duration_s double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.route_cache TO service_role;
ALTER TABLE public.route_cache ENABLE ROW LEVEL SECURITY;
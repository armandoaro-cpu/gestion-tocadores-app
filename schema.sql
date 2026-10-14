-- ============================================================
-- Gestión Tocadores — esquema de Supabase
-- Negocio único (single-business): todas las tablas son
-- accesibles solo para usuarios autenticados (RLS).
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.
-- ============================================================

-- ---------- Tabla de ventas / separaciones ----------
-- Guarda la venta y los datos del cliente en la misma ficha.
create table if not exists ventas (
  id uuid primary key default gen_random_uuid(),

  -- Datos del cliente
  nombre text not null,          -- nombre del cliente
  dni text,                      -- DNI (para buscar rápido)
  telefono text not null,        -- teléfono / WhatsApp (para buscar rápido)

  -- Datos de la venta
  tipo text not null check (tipo in ('separacion', 'directa')), -- separación o venta directa
  modelo text not null,          -- modelo del tocador en texto libre
  precio_venta numeric(12,2) not null check (precio_venta >= 0),
  costo numeric(12,2),           -- precio que pagó al proveedor (solo lo carga el dueño; puede quedar NULL)
  fecha date not null,           -- fecha de la venta/separación
  estado text not null default 'activa'
    check (estado in ('activa', 'pagada', 'enviada', 'anulada')),

  -- Destino del envío (Lima o provincia + distrito/departamento)
  destino_tipo text not null default 'lima' check (destino_tipo in ('lima', 'provincia')),
  destino_lugar text,            -- distrito o departamento
  envio_costo numeric(12,2),     -- costo del envío (se habilita solo al pagarse completo)
  envio_fecha date,              -- fecha en que se envió

  -- Anulación (en lugar de borrar: se conserva el registro)
  anulada_fecha date,            -- fecha en que se anuló
  anulada_motivo text,           -- motivo de la anulación
  devolucion_monto numeric(12,2),-- monto devuelto al cliente (= todo lo abonado)

  created_at timestamptz not null default now()
);

create index if not exists idx_ventas_fecha on ventas (fecha);
create index if not exists idx_ventas_estado on ventas (estado);

-- ---------- Tabla de abonos ----------
-- Cada pago parcial de una separación. La venta directa no usa abonos.
create table if not exists abonos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas (id) on delete cascade,

  fecha date not null,           -- fecha del abono
  monto numeric(12,2) not null check (monto > 0),
  medio text not null check (medio in ('yape', 'transferencia', 'efectivo')),
  comprobante text,              -- ruta del archivo en el bucket 'comprobantes' (obligatorio para Yape/transferencia)

  created_at timestamptz not null default now()
);

create index if not exists idx_abonos_venta on abonos (venta_id);
create index if not exists idx_abonos_fecha on abonos (fecha);

-- ---------- Tabla de gastos ----------
-- Gastos del negocio por fecha y categoría (varían, no son plantilla fija).
create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),

  fecha date not null,
  categoria text not null check (categoria in (
    'Alquiler', 'Sueldo / trabajadores', 'Luz', 'Agua',
    'Repuestos', 'Limpieza', 'Envíos', 'Otros'
  )),
  concepto text,                 -- descripción libre del gasto
  monto numeric(12,2) not null check (monto > 0),

  created_at timestamptz not null default now()
);

create index if not exists idx_gastos_fecha on gastos (fecha);

-- ---------- Tabla de configuración ----------
-- Guarda el hash SHA-256 de la contraseña del dueño (nunca en texto plano).
create table if not exists configuracion (
  clave text primary key,        -- p.ej. 'owner_pin_hash'
  valor text not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Seguridad: Row Level Security (RLS)
-- Solo usuarios autenticados pueden leer y escribir.
-- Es un negocio único, no hay separación por usuario.
-- ============================================================

alter table ventas enable row level security;
alter table abonos enable row level security;
alter table gastos enable row level security;
alter table configuracion enable row level security;

-- Políticas permisivas para usuarios autenticados (lectura y escritura)
create policy "Solo autenticados: todo en ventas"
  on ventas for all to authenticated using (true) with check (true);

create policy "Solo autenticados: todo en abonos"
  on abonos for all to authenticated using (true) with check (true);

create policy "Solo autenticados: todo en gastos"
  on gastos for all to authenticated using (true) with check (true);

create policy "Solo autenticados: todo en configuracion"
  on configuracion for all to authenticated using (true) with check (true);

-- ============================================================
-- Storage: bucket 'comprobantes' para las fotos de los abonos
-- ============================================================

insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', true)
on conflict (id) do nothing;

-- Lectura pública del bucket (las URLs se muestran dentro de la app,
-- que ya está protegida por inicio de sesión). Para mayor seguridad en
-- producción se recomienda usar URLs firmadas temporales.
create policy "Lectura pública de comprobantes"
  on storage.objects for select using (bucket_id = 'comprobantes');

create policy "Subida de comprobantes solo autenticados"
  on storage.objects for insert to authenticated with check (bucket_id = 'comprobantes');

create policy "Reemplazo de comprobantes solo autenticados"
  on storage.objects for update to authenticated using (bucket_id = 'comprobantes');

create policy "Borrado de comprobantes solo autenticados"
  on storage.objects for delete to authenticated using (bucket_id = 'comprobantes');

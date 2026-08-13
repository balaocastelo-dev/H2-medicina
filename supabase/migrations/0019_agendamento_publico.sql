-- =====================================================================
-- 0019 - Agendamento pelo site, sem login
--
-- A pessoa escolhe dia e horario numa pagina publica e sai com um
-- comprovante em PDF. A reserva nasce como "a confirmar": a pagina e
-- aberta a qualquer um, e horario bloqueado por engano ou por trote
-- custa caro numa agenda de clinica.
-- =====================================================================

alter table public.appointments
  -- Codigo curto do comprovante. E a unica chave que a pessoa tem para
  -- baixar o PDF depois — nao ha login para identifica-la.
  add column if not exists public_code        text,
  add column if not exists requested_online   boolean not null default false,
  add column if not exists requester_name     text,
  add column if not exists requester_phone    text,
  add column if not exists requester_email    citext,
  add column if not exists requester_ip       inet,
  add column if not exists requested_at       timestamptz,
  add column if not exists confirmed_by       uuid,
  add column if not exists rejected_at        timestamptz,
  add column if not exists reject_reason      text;

create unique index if not exists uq_appointments_public_code
  on public.appointments (public_code) where public_code is not null;

-- Fila de pedidos esperando a recepcao decidir.
create index if not exists idx_appointments_a_confirmar
  on public.appointments (tenant_id, scheduled_date)
  where requested_online and confirmed_at is null and rejected_at is null and deleted_at is null;

-- ---------------------------------------------------------------------
-- Um pedido publico por horario
--
-- A checagem antes do insert nao basta: dois visitantes clicando ao mesmo
-- tempo passam pelos dois `select` e gravam os dois. So o indice unico
-- resolve — a segunda gravacao falha e a tela pede outro horario.
--
-- O indice cobre apenas o que veio do site. O balcao continua podendo
-- marcar varios funcionarios da mesma empresa no mesmo horario, que e
-- exatamente o que o agendamento avulso em lote faz.
-- ---------------------------------------------------------------------
create unique index if not exists uq_appointments_reserva_online
  on public.appointments (tenant_id, scheduled_at)
  where requested_online
    and deleted_at is null
    and rejected_at is null
    and status not in ('cancelado','remarcado','ausente');

-- ---------------------------------------------------------------------
-- Grade de atendimento aberta ao publico
--
-- Fica em tenant_settings para a clinica mudar sem depender de deploy:
-- feriado, mutirao e mudanca de expediente acontecem o tempo todo.
-- ---------------------------------------------------------------------
insert into public.tenant_settings (tenant_id, group_key, settings)
select t.id, 'agendamento_online', jsonb_build_object(
  'ativo', true,
  'grade', jsonb_build_array(
    '07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00',
    '13:30','14:00','14:30','15:00','15:30','16:00','16:30'
  ),
  'dias_uteis', jsonb_build_array(1,2,3,4,5),
  'dias_de_antecedencia', 1,
  'janela_de_dias', 45
)
from public.tenants t
on conflict (tenant_id, group_key) do nothing;

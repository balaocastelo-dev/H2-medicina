import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { marcaPublica } from '@/modules/settings/marca-publica';
import { publicEnv } from '@/lib/env';
import { formatCPF, formatDate, formatTime } from '@/lib/format';
import { buildDocumentPdf, carregarLogo, type PdfBrand } from '@/modules/documents/pdf';

export const dynamic = 'force-dynamic';

/**
 * Comprovante de agendamento em PDF, baixado pelo codigo.
 *
 * Rota publica de proposito: quem agendou pelo site nao tem login. O
 * codigo de oito caracteres e a credencial — por isso o PDF traz apenas o
 * que a propria pessoa informou, e nenhum dado clinico.
 */

interface Reserva {
  public_code: string;
  requester_name: string | null;
  requester_phone: string | null;
  scheduled_at: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  status: string;
  notes: string | null;
  patients: { full_name: string; cpf: string | null } | null;
  appointment_exams: { exam_types: { name: string } | null }[];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const { codigo } = await params;
  const limpo = decodeURIComponent(codigo).trim().toUpperCase();

  // Formato fixo: barra a varredura de códigos aleatórios antes do banco.
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(limpo)) {
    return NextResponse.json({ erro: 'Código inválido.' }, { status: 400 });
  }

  try {
    // `tenants` esta sob RLS e quem baixa o comprovante nao tem login: lido
    // como anonimo, a unidade vinha nula e todo comprovante respondia 404.
    const unidade = await marcaPublica();
    if (!unidade) {
      return NextResponse.json({ erro: 'Unidade não configurada.' }, { status: 404 });
    }
    const tenant = {
      id: unidade.tenantId,
      legal_name: unidade.legalName,
      trade_name: unidade.tradeName,
    };

    const admin = createAdminClient();

    const [reservaRes, marcaRes] = await Promise.all([
      admin
        .from('appointments')
        .select(
          'public_code, requester_name, requester_phone, scheduled_at, confirmed_at, rejected_at, cancelled_at, status, notes, patients(full_name, cpf), appointment_exams(exam_types(name))',
        )
        .eq('tenant_id', tenant.id)
        .eq('public_code', limpo)
        .is('deleted_at', null)
        .maybeSingle<Reserva>(),
      admin
        .from('tenant_settings')
        .select('group_key, settings')
        .eq('tenant_id', tenant.id)
        .in('group_key', ['empresa', 'contato', 'documentos'])
        .returns<{ group_key: string; settings: Record<string, string | null> }[]>(),
    ]);

    const reserva = reservaRes.data;
    if (!reserva) {
      return NextResponse.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
    }

    const grupos = Object.fromEntries(
      (marcaRes.data ?? []).map((g) => [g.group_key, g.settings ?? {}]),
    ) as Record<string, Record<string, string | null>>;

    const empresa = grupos.empresa ?? {};
    const contato = grupos.contato ?? {};

    const marca: PdfBrand = {
      systemName: unidade.systemName,
      legalName: empresa.razao_social ?? tenant.legal_name,
      document: empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
      address:
        [contato.logradouro, contato.numero, contato.bairro, contato.cidade, contato.estado]
          .filter(Boolean)
          .join(', ') || null,
      contact: [contato.telefone, contato.email].filter(Boolean).join(' · ') || null,
      headerText: unidade.pdfHeaderHtml,
      footerText: unidade.footerText,
      primaryColor: unidade.colorPrimary,
      logo: await carregarLogo(unidade.logoUrl),
    };

    const situacao = reserva.rejected_at
      ? 'Pedido recusado pela clínica'
      : reserva.cancelled_at || reserva.status === 'cancelado'
        ? 'Agendamento cancelado'
        : reserva.confirmed_at
          ? 'Confirmado pela clínica'
          : 'Aguardando confirmação da clínica';

    const exames = (reserva.appointment_exams ?? [])
      .map((e) => e.exam_types?.name)
      .filter((n): n is string => Boolean(n));

    const pdf = await buildDocumentPdf({
      brand: marca,
      title: 'Comprovante de agendamento',
      subtitle: `Código ${reserva.public_code}`,
      sections: [
        {
          title: 'Paciente',
          lines: [
            { label: 'Nome', value: reserva.requester_name ?? reserva.patients?.full_name ?? '—' },
            {
              label: 'CPF',
              value: reserva.patients?.cpf ? formatCPF(reserva.patients.cpf) : 'não informado',
            },
            { label: 'Contato', value: reserva.requester_phone ?? 'não informado' },
          ],
        },
        {
          title: 'Agendamento',
          lines: [
            { label: 'Data', value: formatDate(reserva.scheduled_at) },
            { label: 'Horário', value: formatTime(reserva.scheduled_at) },
            { label: 'Situação', value: situacao },
          ],
        },
        {
          title: 'Exames solicitados',
          lines:
            exames.length > 0
              ? exames.map((nome) => ({ value: nome }))
              : [{ value: 'nenhum exame informado' }],
        },
      ],
      body: reserva.confirmed_at
        ? 'Compareça com 15 minutos de antecedência, trazendo documento com foto. Apresente este comprovante na recepção.'
        : 'Este comprovante registra seu pedido de agendamento. A clínica entrará em contato para confirmar o horário. Apresente este código ao chegar.',
      verificationCode: reserva.public_code,
      verificationUrl: `${publicEnv.NEXT_PUBLIC_APP_URL}/agendar/comprovante`,
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="comprovante-${reserva.public_code}.pdf"`,
        // Situação muda quando a clínica confirma: guardar em cache mostraria
        // "aguardando confirmação" para sempre.
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ erro: 'Não foi possível gerar o comprovante.' }, { status: 500 });
  }
}

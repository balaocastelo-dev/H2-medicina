'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function ReceptionLiveRefresh({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const signatureRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;

      const { data, error } = await supabase
        .from('attendances')
        .select('id, stage_code, updated_at')
        .eq('tenant_id', tenantId)
        .in('stage_code', ['aguardando_recepcao', 'na_recepcao'])
        .is('finished_at', null)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (!active || error) return;

      const signature = JSON.stringify(
        (data ?? []).map((row) => ({
          id: row.id,
          stage: row.stage_code,
          updatedAt: row.updated_at,
        })),
      );

      if (signatureRef.current === null) {
        signatureRef.current = signature;
        return;
      }

      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        router.refresh();
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [router, tenantId]);

  return null;
}

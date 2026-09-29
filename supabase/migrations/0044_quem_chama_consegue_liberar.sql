-- =====================================================================
-- 0044 - Quem pode chamar precisa poder liberar
--
-- Encontrado pela matriz de papeis do simulador, rodando cada tela com o
-- papel de quem a usa de verdade.
--
-- ---------------------------------------------------------------------
-- O que estava acontecendo
-- ---------------------------------------------------------------------
-- O papel `atendimento` tem `filas.operar`: ele opera o quadro de Filas e
-- salas, e o botao "Chamar proximo" funciona. Mas NAO tem
-- `exames.concluir` -- entao o botao de concluir o exame e recusado.
--
-- O resultado e uma armadilha: o paciente entra na sala, a sala fica
-- marcada como ocupada, e quem o chamou nao consegue solta-lo. A sala
-- segue "ocupada" com alguem que ja saiu, e o proximo paciente da fila
-- nunca e chamado.
--
-- "nao esta chamando paciente" + "Erro inesperado. Tente novamente."
--                                          -- Isabella, 29/09 11:50,
-- com um paciente esperando ha 28 horas no quadro.
--
-- Um papel que pode prender e nao pode soltar nao e uma restricao de
-- seguranca: e um jeito de perder o dia. Mover a fila e operacao, e quem
-- opera a fila precisa das duas metades.
--
-- ---------------------------------------------------------------------
-- O que NAO muda
-- ---------------------------------------------------------------------
-- `exames.preencher` continua fora: preencher a ficha do exame e ato
-- clinico, e o resultado vai para o prontuario e para o laudo. A recepcao
-- passa a poder encerrar um exame e devolver a sala; quem registra o que
-- foi medido continua sendo quem faz o exame.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

insert into public.role_permissions (role_id, permission_code)
select r.id, 'exames.concluir'
  from public.roles r
 where r.code = 'atendimento'
   and exists (select 1 from public.role_permissions rp
                where rp.role_id = r.id and rp.permission_code = 'filas.operar')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Salas presas a quem ja foi embora
--
-- Enquanto a permissao faltava, cada exame chamado e nao concluido deixou
-- a sala ocupada. Soltar so as que apontam para atendimento encerrado,
-- cancelado ou ausente: sala com paciente de verdade dentro nao se mexe.
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null
        or a.stage_code in ('finalizado','cancelado','ausente'));

-- Sala apontando para um atendimento que nao existe mais.
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
 where r.current_attendance_id is not null
   and not exists (select 1 from public.attendances a where a.id = r.current_attendance_id);


do $$
declare v_presas int;
begin
  select count(*) into v_presas from public.rooms where current_attendance_id is not null;
  raise notice 'Salas ainda ocupadas (com paciente de verdade dentro): %', v_presas;
end$$;

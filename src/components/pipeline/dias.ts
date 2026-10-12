/**
 * Os "Dias" do Pipeline contam desde a última troca do Status 2 (pedido de
 * 12/10/2026), não desde a criação do negócio. Negócio antigo sem a data da
 * troca (`status_detail_changed_at`, 0214) cai na idade do negócio.
 */
export const diasNoStatus = (deal: { days_in_status?: number; days_in_pipeline: number }): number =>
  deal.days_in_status ?? deal.days_in_pipeline;

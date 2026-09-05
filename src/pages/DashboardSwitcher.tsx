import Dashboard from "@/pages/Dashboard";

/**
 * Qual painel abre depois do login: um so, para todo mundo.
 *
 * Antes esta rota bifurcava — quem tinha "director" entre os papeis ia para um
 * painel separado, so com o comparativo do diario. Isso custava caro: o diretor
 * perdia meta, VGV, ranking, funil por etapa e selo de mes fechado, e nao tinha
 * como voltar (o `RoleSwitcher` so aparece para admin, e ele e ferramenta de
 * pre-visualizacao, nao de navegacao). Quem acumulava admin E diretor — o caso
 * da conta do cliente, com os quatro papeis — perdia o painel completo sem
 * escolher isso.
 *
 * Agora o comparativo da diretoria e uma ABA do Dashboard (`DirectorPanel`),
 * visivel para quem tem o papel `director`. Cinco blocos a mais para o diretor,
 * um a menos para ninguem. A rota fica aqui, e nao apontando direto para
 * `Dashboard`, porque e este arquivo que documenta a decisao — e o lugar de
 * mexer se um dia um papel precisar de outra primeira tela.
 */
export default function DashboardSwitcher() {
  return <Dashboard />;
}

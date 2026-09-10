/**
 * Compatibilidade: o áudio do sistema mora em `@/lib/engagement/audio`.
 *
 * Este arquivo continua existindo só para não quebrar import antigo. Código
 * novo não toca som direto — usa `celebrate()` do `useCelebration`, que é o
 * único ponto que decide som + visual + confete (ver `EngagementLayer`).
 */
export { playLeadAlert, playSaleFanfare } from "./engagement/audio";

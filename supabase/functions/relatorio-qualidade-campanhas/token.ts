/** Comparação em tempo constante: o token do relatório não vaza por tempo de resposta. */
export function tokensIguais(recebido: string, esperado: string): boolean {
  if (!recebido || !esperado) return false;
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diferenca |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferenca === 0;
}

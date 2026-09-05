/**
 * O bloco "Acesso ao sistema" da ficha segue o MESMO cadeado do resto dela.
 *
 * Defeito medido na homologação, não hipótese: `getPersonDetails` chega depois
 * do primeiro render e reescreve o formulário inteiro — inclusive
 * `login_email`. O campo "E-mail de login" e os botões ao lado eram a única
 * parte editável fora do `fieldset disabled={details !== "ready"}`, então quem
 * digitasse o endereço novo antes de a ficha carregar via o campo voltar ao
 * ANTIGO em silêncio; o botão seguinte então trocava o e-mail da pessoa para
 * ele mesmo e a tela dava "E-mail de acesso atualizado". A prova ficou no
 * banco: `access_provision_log` com `action='reset'` e o endereço antigo.
 *
 * A asserção é no `fieldset` porque é ele o cadeado: `input.disabled` não
 * enxerga o `fieldset` ancestral, e o que se quer garantir é a pertença ao
 * bloco travado, não o atributo em cada controle.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EMPTY_DETAILS, type ProfileIdentity } from "@/integrations/supabase/people";
import { BrokerEditModal } from "@/components/BrokerEditModal";

const detalhes = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/integrations/supabase/people", async (original) => {
  const real = await original<typeof import("@/integrations/supabase/people")>();
  return { ...real, getPersonDetails: detalhes.fn, savePerson: vi.fn() };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: () => undefined,
  useToast: () => ({ toast: () => undefined }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({}) },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DO_BANCO = "marcos@faceimob.com.br";

const identidade: ProfileIdentity = {
  full_name: "Marcos Gerente",
  email: DO_BANCO,
  phone: null,
  avatar_url: null,
  active: true,
  status: "active",
  manager_id: null,
  director_id: null,
};

const campoDeLogin = () =>
  document.body.querySelector<HTMLInputElement>('input[aria-label="E-mail de login"]');

// Chaves obrigatórias: `mockReset()` devolve o próprio mock, e um `beforeEach`
// que RETORNA função vira teardown para o Vitest — ele chamaria o mock de novo
// no fim do teste e ficaria pendurado na promessa que ninguém resolve.
beforeEach(() => { detalhes.fn.mockReset(); });
afterEach(() => { document.body.innerHTML = ""; });

describe("ficha · o bloco de acesso não aceita digitação antes de carregar", () => {
  it("o campo de e-mail de login só destrava quando a ficha chega do banco", async () => {
    let entregar: (() => void) | null = null;
    detalhes.fn.mockImplementation(
      () =>
        new Promise((resolve) => {
          entregar = () => resolve({ details: { ...EMPTY_DETAILS }, roles: ["broker"], identity: identidade });
        }),
    );

    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <BrokerEditModal
          open
          broker={{ id: "p1", name: "Marcos Gerente", login_email: DO_BANCO }}
          managers={[]}
          directors={[]}
          isAdmin
          podeMudarSituacao
          onClose={() => undefined}
          onSaved={() => undefined}
        />,
      );
    });

    const campo = campoDeLogin();
    expect(campo, "o campo de e-mail de login sumiu da ficha do admin").toBeTruthy();
    expect(
      campo?.closest("fieldset")?.hasAttribute("disabled"),
      "digitar aqui antes de a ficha carregar é perder o que foi digitado — e trocar o e-mail para ele mesmo",
    ).toBe(true);

    await act(async () => { entregar?.(); });

    expect(campoDeLogin()?.closest("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(campoDeLogin()?.value, "carregou: o campo passa a valer o que o banco tem").toBe(DO_BANCO);

    await act(async () => { root.unmount(); });
    container.remove();
  });
});

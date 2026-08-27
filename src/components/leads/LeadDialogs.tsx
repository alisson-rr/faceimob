import type { LeadSource, WhatsappTemplate } from "@/integrations/supabase/leads";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { ConvertLeadDialog } from "./ConvertLeadDialog";
import { LeadFormDialog } from "./LeadFormDialog";
import { LeadImportDialog } from "./LeadImportDialog";
import { EmailDialog, WhatsAppDialog } from "./OutreachDialogs";
import { ReassignLeadDialog } from "./ReassignLeadDialog";
import type { LeadDialogState } from "./model";

/**
 * Anfitrião dos diálogos da tela de Leads.
 *
 * Cada um só é montado enquanto está aberto, e o formulário leva `key` por
 * lead: assim o estado inicial sai das props na montagem e nenhum diálogo
 * precisa de efeito para se ressincronizar quando o alvo muda.
 */
export function LeadDialogs({
  state, onClose, sources, brokers, templates,
}: {
  state: LeadDialogState;
  onClose: (patch: Partial<LeadDialogState>) => void;
  sources: LeadSource[];
  brokers: PersonRecord[];
  templates: WhatsappTemplate[];
}) {
  return (
    <>
      {state.form.open && (
        <LeadFormDialog
          key={state.form.lead?.id ?? "novo"}
          lead={state.form.lead}
          sources={sources}
          onClose={() => onClose({ form: { open: false, lead: null } })}
        />
      )}

      {state.reassign && (
        <ReassignLeadDialog
          lead={state.reassign}
          brokers={brokers}
          onClose={() => onClose({ reassign: null })}
        />
      )}

      {state.convert && (
        <ConvertLeadDialog lead={state.convert} onClose={() => onClose({ convert: null })} />
      )}

      {state.whatsapp && (
        <WhatsAppDialog
          lead={state.whatsapp}
          templates={templates}
          onClose={() => onClose({ whatsapp: null })}
        />
      )}

      {state.email && <EmailDialog lead={state.email} onClose={() => onClose({ email: null })} />}

      {state.import && <LeadImportDialog sources={sources} onClose={() => onClose({ import: false })} />}
    </>
  );
}

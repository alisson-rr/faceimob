<w:left w:space="0" w:sz="0" w:val="nil"/><w:bottom w:space="0" w:sz="0" w:val="nil"/><w:right w:space="0" w:sz="0" w:val="nil"/><w:between w:space="0" w:sz="0" w:val="nil"/></w:pBdr><w:shd w:fill="auto" w:val="clear"/><w:spacing w:after="0" w:before="0" w:line="276" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/><w:b w:val="0"/><w:bCs w:val="0"/><w:i w:val="0"/><w:iCs w:val="0"/><w:smallCaps w:val="0"/><w:strike w:val="0"/><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:u w:val="none"/><w:shd w:fill="auto" w:val="clear"/><w:vertAlign w:val="baseline"/></w:rPr><w:sectPr><w:pgSz w:h="16834" w:w="11909" w:orient="portrait"/><w:pgMar w:bottom="1440" w:top="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/><w:pgNumType w:start="1"/></w:sectPr></w:pPr><w:bookmarkStart w:colFirst="0" w:colLast="0" w:name="_5q2pd2kzcz6p" w:id="0"/><w:bookmarkEnd w:id="0"/><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rFonts w:ascii="Google Sans Flex Normal" w:cs="Google Sans Flex Normal" w:eastAsia="Google Sans Flex Normal" w:hAnsi="Google Sans Flex Normal"/><w:b w:val="1"/><w:bCs w:val="1"/><w:i w:val="0"/><w:iCs w:val="0"/><w:smallCaps w:val="0"/><w:strike w:val="0"/><w:color w:val="1f1f1f"/><w:sz w:val="64"/><w:szCs w:val="64"/><w:u w:val="none"/><w:shd w:fill="auto" w:val="clear"/><w:vertAlign w:val="baseline"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">📝 Observações

jul. 23, 2026

Reunião em 23 de jul. de 2026 às 14:59 GMT-03:00

Registros da reunião Gravação





Resumo

A reunião definiu requisitos do CRM para gestão de usuários, fluxo de leads e melhorias de segurança.Estrutura e GestãoDefiniu-se uma hierarquia de acesso para diretores, gerentes e corretores. Decidiu-se que o sistema deve processar fluxos de construtoras internos e externos automaticamente.Fluxo de LeadsA distribuição de leads utilizará uma roleta com travas de tempo de 5 minutos para retorno à fila. O sistema integrará essa roleta ao pipeline de atendimento.Segurança e IntegraçãoImplementou-se validação por e-mail para aumentar a segurança das senhas. O CRM será preparado para integração futura com uma nova inteligência artificial de voz.





Próximas etapas

[Alisson Rosa] Campos de Documentos: Implementar campos específicos para cada tipo de documento exigido. Configurar o sistema para renomear automaticamente os arquivos durante o envio.

[Alisson Rosa] Botão de Download: Adicionar um botão de download para cada documento armazenado no histórico de envios.

[Alisson Rosa] Múltiplos Anexos: Permitir o upload de vários arquivos na categoria Outros.

[Alisson Rosa] Ajustar Permissões Rafael: Remover o usuário Rafael das notificações de CCA. Garantir que o perfil dele seja configurado apenas como corretor.

[Alisson Rosa] Trava de Atendimento: Desenvolver uma funcionalidade para travar o lead após o clique do usuário indicando o atendimento.

[Alisson Rosa] Bloqueio por Atrasos: Criar um bloqueio automático para usuários com mais de 20 leads atrasados.

[Alisson Rosa] Contador de Leads: Implementar um contador visual para exibir quantos leads foram recebidos em diferentes períodos.

[Alisson Rosa] Conversão de Negócios: Configurar a obrigatoriedade de anexar pelo menos um documento ao converter um lead em negócio.

[Alisson Rosa] Implementar login seguro: Desenvolver fluxo de autenticação via código enviado por e-mail para substituir o armazenamento de senhas fixas.

[Alisson Rosa] Desenvolver funil vendas: Implementar lógica de pipeline, definir hierarquia de cargos e configurar o cálculo automático de divisão de VGV.

[Douglas Gomes] Integrar plataforma IA: Configurar a integração da plataforma de chamadas e WhatsApp com o sistema via API assim que a ferramenta estiver disponível.

[Alisson Rosa] Exibir posição fila: Adicionar indicadores visuais que informam a posição do usuário na fila de atendimento de leads.





Detalhes

Introdução e Ajustes de Conexão: Alisson Rosa e Douglas Gomes realizam testes de áudio e definem o início do detalhamento do sistema para garantir que os requisitos sejam compreendidos para a implementação.

Estrutura Hierárquica de Usuários: A hierarquia definida para o sistema consiste em Diretores, Gerentes e Corretores; é importante notar que os Diretores possuem a capacidade de atuar em múltiplos papéis simultaneamente, como gerentes ou corretores, e o sistema deve suportar essa função dupla.

Gestão de Construtoras e CCA: O fluxo para as construtoras diferencia-se entre interno (analisado pelo CCA da empresa) e externo (documentos enviados por e-mail automaticamente); foi decidido que o sistema deve processar ambos os fluxos, com a automação de e-mails para externos contendo os anexos do card.

Otimização do Cadastro de Documentos: O sistema atual utiliza um campo único para anexos, o que é ineficiente; foi estabelecido que a nova versão deve conter campos específicos para cada tipo de documento, funcionalidade de renomeação automática de arquivos, botões de download e registro de histórico de alterações para o time do CCA.

Correção de Perfil de Usuário: Identificou-se que o usuário Rafael Ram estava recebendo notificações de CCA de forma indevida, devido a funções duplicadas no banco de dados, o que gera problemas operacionais.

Ajuste Técnico no Cadastro do Usuário: Douglas Gomes e Alisson Rosa investigam a base de dados para localizar e corrigir a permissão de Rafael Ram, assegurando que o usuário receba apenas notificações pertinentes ao seu papel atual de corretor.

Estrutura de Equipes e Gestão de Diretores: Foi reforçado que diretores, como Arquimedes, possuem equipes próprias com gerentes e corretores; o sistema deve permitir essa flexibilidade, onde o diretor exerce a liderança sobre múltiplos subgrupos e a sua própria equipe.

Sistema de Distribuição de Leads (Roleta): Os leads chegam via API (Meta e WhatsApp) e são organizados através de uma "roleta" baseada em horários de check-in e IP do usuário, garantindo a organização da fila e o controle de quem é o próximo a receber um lead.

Gestão de Leads e Status de Atendimento: O sistema precisa integrar a "roleta" ao pipeline, criando um status de "em atendimento" para travar o lead com o corretor; caso o corretor não realize uma ação em 5 minutos, o lead deve retornar para a fila.

Segurança de Acesso (IP): O sistema de check-in permanece restrito por IP para prevenir fraudes, com a implementação de uma função para identificar o IP do usuário, facilitando o suporte administrativo em casos onde o endereço IP é dinâmico.

Histórico e Manutenção de Leads: O registro histórico deve permitir comentários manuais para manter um log de toda a movimentação do lead, possibilitando que corretores, gerentes e a equipe do CCA registrem observações específicas durante o processo.

Estrutura de Cadastro de Negócios e VGV: O cadastro de um negócio suporta múltiplos corretores, com a necessidade de automação no preenchimento do gerente e diretor; além disso, o cálculo do VGV (Valor Geral de Vendas) deve ser dividido de forma igualitária entre os corretores participantes.

Controle de Acesso e Visibilidade: A visibilidade no pipeline deve ser restrita conforme a hierarquia: corretores veem apenas seus negócios, gerentes veem o desempenho de sua equipe, e diretores possuem visibilidade total, garantindo o acesso apropriado a relatórios.

Segurança na Autenticação: Para eliminar a vulnerabilidade de senhas expostas no banco de dados, Alisson Rosa propõe que o sistema utilize validação por e-mail ou criação de senha no primeiro login, removendo a necessidade de exposição de senhas administrativas.

Interface e Experiência do Usuário (Dashboard): O dashboard deve ser intuitivo, com visualização clara de produtividade e equipes, além de notificações em formato de pop-up quando novos leads forem atribuídos para garantir que o corretor seja notificado independentemente de onde esteja no sistema.

Integração Futura com IA: Douglas Gomes informa sobre a contratação de uma IA de voz e WhatsApp para aquecimento de leads, com prazo de 60 dias para entrega; o sistema CRM deve estar pronto para integrar essa plataforma via API dentro deste cronograma.





Revise as anotações do Gemini para checar se estão corretas. Confira dicas e saiba como o Gemini faz anotações

Como está a qualidade de destas observações? Responda a uma breve pesquisa para nos dar seu feedback, incluindo o quanto as observações foram úteis para o que você precisa.
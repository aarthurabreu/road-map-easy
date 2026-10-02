# Easy Road Map

Guia turístico com roteiros, Google Maps/Places, notas privadas e compartilhamento restrito por e-mail. React + Vinext/Vite, Worker e banco Cloudflare D1, hospedados pelo Sites.

## Desenvolvimento e validação

Use Node 24 e pnpm 11.19.0. Instale com `pnpm install --frozen-lockfile`; execute `pnpm dev`.

- `pnpm test`: testes de autenticação, isolamento de contas, compartilhamento, limites de envio e estabilidade do mapa. O adaptador de teste executa as migrações SQL reais em SQLite em memória, sem banco de produção.
- `pnpm typecheck`: TypeScript sem gerar cache.
- `pnpm lint`: ESLint.
- `pnpm check`: os três comandos anteriores.
- `pnpm build`: compilação de produção.
- `pnpm test:offline`: após o build, testa o service worker de produção e abertura fria sem rede, em desktop e celular.
- `pnpm exec playwright install chromium`, depois `pnpm test:browser`: testes DOM em navegador desktop/mobile. O script inicia e encerra seu próprio servidor local. No Windows, também é possível definir `ROAMLY_TEST_BROWSER_CHANNEL=chrome` para usar o Chrome instalado.

Para usar um servidor **local de teste** existente, defina `ROAMLY_TEST_BASE_URL`. Para trocar a porta automática, defina `ROAMLY_TEST_PORT` (padrão 4173). Os testes de navegador interceptam APIs e bloqueiam serviços externos: não enviam e-mails nem gastam quota Google. Não são uma validação de entrega do Resend, OAuth real, GPS físico ou instalação no iPhone. Falhas salvam capturas em `test-results/`.

Na suíte offline, `context.setOffline(true)` bloqueia a rede durante a nova navegação. O sinal `navigator.onLine`/evento de reconexão é simulado explicitamente devido ao [bug do Chromium embarcado no Playwright 1.62](https://github.com/microsoft/playwright/issues/42174). O teste aguarda a resposta de configuração, não um tempo fixo, e não altera o código do app para compensar o emulador.

A automação `.github/workflows/checks.yml` verifica testes, tipos, lint, build e navegador em pushes para main/master e em PRs. Ela não publica o app. Sua primeira execução remota precisa ser acompanhada.

## Organização

`app/page.tsx` apenas compõe o controlador e a tela. Em `app/trip-guide/`:

- `use-trip-guide.ts`: estado e ações do roteiro; `trip-guide-view.tsx`: interface.
- `place-model.ts` e `types.ts`: modelo, restauração e deduplicação.
- `google-places.ts` e `google-runtime.ts`: acesso aos provedores e transformação dos dados.
- `live-google-map.tsx` e `place-components.tsx`: mapa, fotos e cartões.
- `formatting.ts` e `itinerary-persistence.ts`: apresentação e persistência.
- `use-browser-environment.ts`: preferências externas usadas no mapa compartilhado.

`app/api/_lib/auth.ts` centraliza sessões; `invitations.ts` centraliza envio e orçamento de convites. `tests/helpers/runtime.mjs` fornece o adaptador SQLite e os provedores sintéticos dos testes.

## Configuração e segurança

Os nomes das variáveis estão em `.env.example`. Configure valores reais em `.env.local` ignorado ou nos segredos do ambiente de hospedagem. Nunca envie segredos ao Git. A chave Maps de navegador é pública por natureza: restrinja-a aos domínios autorizados e APIs necessárias. OAuth, segredo de sessão e Resend continuam configurados no servidor. Nenhuma credencial real é necessária para a suíte mockada.

Sessões duram sete dias e também precisam existir em `auth_sessions`. Sair invalida somente a sessão deste navegador; uma cópia daquele cookie deixa de acessar APIs privadas. Novo login no mesmo navegador também invalida a sessão substituída. Outros aparelhos permanecem conectados. Excluir a conta remove todas as suas sessões. Cookies anteriores à migração 0004 não têm ID de sessão e exigirão um novo login uma vez.

Limites de **tentativas de e-mail**, em janelas móveis:

| Escopo | Limite |
| --- | --- |
| Conta Google | 10/hora e 50/dia |
| Destinatário, somando remetentes | 20/dia |
| Aplicativo inteiro | 500/dia |
| Mesma conta e mesmo destinatário | uma tentativa a cada 5 minutos |

As reservas são atômicas no D1. Falhas do provedor também consomem orçamento. Excluir convite/mapa/conta não o devolve; trocar nome de mapa ou recriar a mesma conta não o reinicia. Identificadores protegidos por HMAC substituem e-mails/IDs brutos no registro antispam. Registros fora da janela de 24 horas são limpos na próxima tentativa de envio configurado, não por um agendador.

Ao atingir um limite, o convite permanece disponível para copiar e enviar manualmente; o servidor retorna `emailRateLimited: true` e não chama o Resend. Sem configuração de envio, o link manual funciona sem consumir orçamento. Há também um teto de 50 convites ativos por mapa; reenviar um convite existente não dispara outro e-mail. O aviso de privacidade explica a retenção antispam.

## Sincronização e alterações offline

O D1 é a fonte persistente dos roteiros conectados. Cada salvamento compara a revisão lida com a revisão atual do servidor (CAS); um dispositivo desatualizado recebe 412 e precisa reconciliar antes de escrever. O importador de convites usa o mesmo mecanismo e repete a leitura até quatro vezes em caso de concorrência. Clientes antigos sem revisão recebem 428 e devem recarregar o app.

`app/itinerary-sync.ts` calcula intenções de edição (criar/excluir mapas e locais, notas e cores); GPS e atualizações de dados do Google não geram edições. `sync-engine.ts` mantém uma operação imutável por chave no navegador, isolada por usuário e geração da conta. A fila só é removida após confirmação dos IDs pelo servidor, ou escolha explícita da versão da nuvem. Recibos no D1 impedem reaplicar uma edição cujo salvamento teve a resposta perdida. Esses recibos são removidos na exclusão da conta.

Um lote de até 100 IDs usa JSON parametrizado e três comandos atômicos, não um comando por ID. O adaptador de testes impõe limites de 100 parâmetros por query e 50 comandos por batch, compatíveis com os [limites do D1](https://developers.cloudflare.com/d1/platform/limits/). Os recibos e a revisão são lidos no mesmo snapshot SQL.

Alterações independentes são combinadas; edição concorrente da mesma informação ou edição contra exclusão mostra ambas as versões. O usuário pode manter suas alterações ou usar a nuvem, sem descartar alterações independentes. Reconexão, retorno à aba e falhas transitórias acionam nova tentativa. Uma identificação local permite abrir o cache da última conta sem rede; ela nunca autoriza APIs.

Avisos mostram conexão ausente, fila pendente, erro e conflitos, em português, espanhol e inglês. Falha de armazenamento conserva o input em memória e orienta manter o app aberto ou baixar uma cópia. A exportação inclui alterações pendentes e funciona offline com a cópia deste aparelho, indicando quando a nuvem não pôde ser consultada. Armazenamento de navegador não é garantia de backup: limpar dados, modo privado, limites ou remoção automática podem apagar alterações ainda não enviadas.

Depois de uma primeira abertura online e da instalação bem-sucedida do service worker, o app pode reabrir sem internet com os roteiros que este navegador já guardou. O cache guarda somente uma interface pública anônima, arquivos estáticos versionados, ícones e manifesto. APIs, convites, fotos e mapas do Google não entram nesse cache. Sem rede, horários aparecem como não confirmados; o Google Maps exige conexão. Não há promessa de abrir offline antes dessa primeira instalação, nem de recuperar dados se o navegador limpar o armazenamento.

Cada alteração no código do worker, na interface ou em seus arquivos gera um cache distinto. A versão nova aguarda o fechamento das abas antigas; não há reload forçado sobre edições pendentes. A reconexão recupera configurações públicas e tenta enviar a fila com a sessão verificada pelo servidor. A suíte de produção realmente desliga a rede, fecha a página e abre outra, mas não substitui um teste físico no iPhone.

## Publicação e recuperação

As alterações deste trabalho são locais até haver uma solicitação de publicação. Antes de atualizar o ambiente, confirme backup e aplicação das migrações `drizzle/` em ordem, incluindo `0004_sessions_and_invite_budgets.sql` e `0005_itinerary_revisions.sql`, pelo fluxo Sites/D1 do projeto. Não publique o código novo sem o esquema correspondente. Não remova tabelas de produção para reverter: preserve a migração e use uma versão compatível do código. Após 0005, não reverta para um servidor que aceite PUT sem revisão: ele não oferece a proteção de concorrência.

Para recuperação, obtenha uma exportação do D1 pelo painel/CLI autorizado do provedor e guarde-a em armazenamento privado, criptografado e fora do repositório. Ela contém e-mails, notas e dados de conta. Faça um ensaio de restauração em um banco separado: aplique o esquema, importe a cópia e confira quantidade de contas/roteiros/convites, acesso por e-mail e ausência de acesso cruzado. Não ensaie sobre o banco de produção. Registre data, responsável e resultado; escolha frequência/retenção de backups conforme a operação real. Ferramentas e permissões de backup do ambiente precisam ser confirmadas antes de prometer recuperação.

Após restauração de produção, invalide as sessões restauradas por procedimento administrativo autorizado antes de liberar acesso, pois uma cópia antiga pode conter sessões revogadas depois do backup. Reconfirme quotas/credenciais e teste um convite e um logout reais. Rollback e restauração de produção exigem aprovação explícita.

## Validação dos locais, Maps e uso da interface

`app/place-schema.ts` valida tipos, status, coordenadas, URLs HTTPS e créditos de fotos na entrada de dados. Novos locais inválidos retornam 422 sem alterar revisão, recibos ou convites. Convites não importam registros inválidos. Leituras antigas recuperam metadados opcionais seguros, preservando identidade, notas e cores válidas, e informam que houve recuperação. Place IDs continuam opacos; IDs internos padrão incluem o destino para não misturar notas de mapas diferentes. Dicionários usam apenas propriedades próprias. A leitura do D1 inclui a geração autorizada no próprio SELECT.

Horários modernos e legados compartilham um cálculo para 24h, múltiplos turnos, intervalos, meia-noite e virada da semana. Fechamento temporário/permanente e abertura futura do estabelecimento prevalecem sobre períodos de funcionamento. Status é recalculado em memória a cada minuto, sem chamada Google por minuto. Dados sem horário vivo, offline, com mais de 30 minutos ou de outro dia local são não confirmados. Dados vencidos podem ser atualizados online; quota, permissão e Place ID inválido não são repetidos automaticamente até uma tentativa explícita ou reconexão. Detalhes em andamento são compartilhados, com até quatro solicitações simultâneas e apenas uma retentativa de erro transitório. Falhas de script removem o script inválido e permitem nova tentativa.

Lista, cartão e convite usam a primeira foto da mesma consulta, exibindo todos os créditos, inclusive nomes sem link. Não há componentes Google de detalhe fazendo consultas extras por miniatura. Fotos Google, seus créditos e horários estruturados ficam em memória e não entram nos novos caches, filas, backups ou salvamentos D1; o Place ID permanece. As regras seguem as [referências oficiais de horários](https://developers.google.com/maps/documentation/javascript/reference/place#OpeningHours) e [fotos](https://developers.google.com/maps/documentation/javascript/place-photos).

A busca possui os modos “No roteiro” e “Google Maps”. A busca local funciona mesmo com o mapa conectado e não chama autocomplete; resultados vazios não são confundidos com roteiro sem locais. Distâncias continuam calculadas ao vivo, com os mais próximos primeiro após permitir localização.

GPS é acompanhado pelo controlador, inclusive na visualização de lista. Erros ou uma posição com mais de 60 segundos removem o marcador azul e as distâncias, em vez de apresentar a última posição como atual. Centralizar solicita uma nova posição com `maximumAge: 0`. Parar o acompanhamento limpa a posição; localização não entra no banco nem nos backups.

Modais usam dialog nativo, Tab/Shift+Tab contidos, Escape e restauração do foco. Confirmações de exclusão explicam conta/aparelhos, próxima sincronização, revogação de convites e permanência de cópias já importadas. Rotas e confirmações mantêm seu local-alvo e fecham se ele for removido remotamente.

Falhas no acesso ao armazenamento não derrubam a página; visitante recebe aviso e download. Com login, leitura totalmente bloqueada permite visualizar/exportar a nuvem e manter edições voláteis, mas suspende escrita e confirmação de filas desconhecidas. Uma fila com entrada corrompida continua bloqueando a sincronização. Exclusão confirmada no servidor não é desfeita por falha na limpeza local, e sinalização entre abas é best-effort.

Testes aprovados não equivalem a uma garantia de ausência de vulnerabilidades. Provedores reais, dados excepcionais do Google e dispositivos físicos ainda precisam de validação após publicação.

Veja [OPERACAO.md](OPERACAO.md) para configurar envio de convites, ensaiar recuperação de banco e executar o teste físico no iPhone. Não trate testes mockados ou cópias exportadas por um único usuário como backup do banco inteiro.

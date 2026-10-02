# Operação e validação real

## Convites por e-mail

O app já usa a API do Resend no servidor. Para ativar: conectar a conta Resend, verificar um domínio próprio com os registros DNS indicados pelo provedor e configurar `RESEND_API_KEY` como segredo e `RESEND_FROM_EMAIL` como endereço desse domínio no ambiente Sites. Nunca colocar a chave no Git, código cliente ou chat. O domínio de testes `resend.dev` só permite enviar ao e-mail da própria conta Resend, não a todos os convidados.

Depois da configuração, criar um convite com uma conta autorizada para outro e-mail controlado pelo responsável. Conferir entrega (inclusive spam), remetente, link HTTPS correto, acesso somente com o e-mail convidado, importação em Meus roteiros e revogação. Confirmar que limites preservam o link manual sem novo envio. Registrar data/resultado, sem armazenar tokens ou conteúdo pessoal no repositório. Até esse teste, envio real permanece não validado.

## Backup e recuperação do D1

Acesso de leitura pelo Sites não equivale a permissão de exportar ou restaurar. O banco físico é gerenciado pelo provedor; obter sua identificação e acesso administrativo autorizado antes de executar exportação. Não criar um endpoint público de dump nem copiar resultados parciais de uma ferramenta de linhas como se fossem um backup completo.

1. Obter exportação consistente pelo painel/CLI autorizado, documentando banco, data UTC e versão do esquema. Guardar o arquivo criptografado em local privado, fora do Git e desta hospedagem, com hash e política de retenção.
2. Criar um banco separado de ensaio; nunca restaurar sobre produção para testar. Importar a cópia conforme o procedimento do provedor.
3. Verificar integridade, esquema e contagens de `user_accounts`, `user_itineraries`, `map_shares`, `auth_sessions`, `invite_email_attempts` e `itinerary_mutations`. Conferir revisão/recibos e amostras autorizadas de notas, cores e roteiros.
4. Ensaiar isolamento de contas, importação/revogação e salvamento com revisão usando contas de teste. Não enviar mensagens reais durante o ensaio. Uma exportação SQLite sintética não prova recuperação do D1 real.
5. Registrar responsável, duração, resultados e local privado da cópia. Definir frequência/retenção e repetir o ensaio após alterações relevantes. Confirmar separadamente a disponibilidade/retenção do Time Travel no ambiente administrado.

Restauração ou rollback de produção exige aprovação específica. Antes de liberar o banco restaurado, invalidar administrativamente as sessões restauradas: o backup pode conter sessões revogadas depois. Não reverter para código sem a proteção de revisão/CAS. Reconferir limites e segredos externos, que não fazem parte do dump.

## Teste físico no iPhone

No Safari, abrir o endereço publicado com conexão e esperar a interface carregar. Em Compartilhar → Adicionar à Tela de Início, instalar o atalho. Usar contas e roteiros de teste, sem apagar dados reais.

- Entrar com Google, criar um roteiro e adicionar um lugar; conferir primeira foto e créditos, horário e status com o Google no mesmo momento.
- Permitir GPS: conferir marcador azul, distâncias e ordem do mais próximo; caminhar, alternar Mapa/Lista, centralizar novamente e voltar após bloquear a tela. Negar/revogar permissão deve retirar posição/distâncias antigas.
- Abrir as quatro rotas (a pé, carro, bicicleta e transporte público) e verificar o destino correto. O destino usa o Place ID; GPS indisponível deixa a origem a cargo do Maps.
- Editar nota/cor, fechar cartão, apagar um local/roteiro de teste e conferir em um segundo aparelho logado na mesma conta.
- Após carregar online, ativar modo avião, fechar o app da Tela de Início e reabrir. Conferir roteiros guardados, horários não confirmados e edição de nota. Desativar modo avião: a nota deve sincronizar sem duplicidade. Não esperar tiles/fotos novos do Google offline.
- Receber convite no segundo e-mail, abrir no Safari e importar diretamente para Meus roteiros. Conferir também abertura pelo atalho instalado: no iOS um link pode abrir no Safari; não prometer associação nativa universal sem um app nativo configurado.
- Alternar português, espanhol, inglês e modo noturno; verificar busca, botões, teclado, rolagem e retorno da tela bloqueada sem piscar.

Registrar modelo do iPhone, versão iOS, navegador/atalho, data e resultado de cada fluxo. A emulação de viewport no Chrome não é um teste de iPhone, GPS físico, login Google ou entrega real de e-mail.

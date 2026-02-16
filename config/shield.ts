import { defineConfig } from '@adonisjs/shield'

const shieldConfig = defineConfig({
  /**
   * Configure CSP policies for your app. Refer documentation
   * to learn more
   */
  csp: {
    enabled: false,
    directives: {},
    reportOnly: false,
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more
   */
  csrf: {
    enabled: true,
    exceptRoutes: [
      '/api/facial/status',
      '/api/facial/reconhecer',
      '/api/facial/registrar',
      '/api/facial/sincronizar',
      '/api/auth/login',
      '/api/auth/verificar-codigo',
      '/api/auth/reenviar-codigo',
      '/api/auth/solicitar-codigo',
      '/api/auth/validar-codigo-admin',
      '/api/auth/selecionar-entidade',
      '/api/auth/login-entidade',
      '/selecionar-entidade',
      '/selecionar-municipio',
      '/api/rep/usuarios',
      '/api/rep/status',
      '/api/rep/sincronizar',
      '/api/rep/sincronizar-tudo',
      '/api/funcionarios/:id/digitais',
      '/api/funcionarios/:id/digitais/:dedo',
      '/api/funcionarios/:id/digitais/baixar',
      '/api/funcionarios/:id/digitais/enviar',
      '/api/funcionarios/:id/digitais/capturar',
      '/api/funcionarios/:id/foto',
      '/api/terminal/registrar',
      '/api/app/sync-offline',
      '/api/terminal-digital/identificar',
      '/api/terminal-digital/registrar',
      '/api/webhook/controlid',
      '/api/webhook/teste',
      '/api/debug/equipamentos',
      '/api/configuracoes/geolocalizacao',
      '/api/configuracoes/mapa',
      '/api/configuracoes/cerca',
      '/api/equipamentos/:id/sincronizar',
      '/api/interno/nova-batida',
      '/api/configuracoes/data-inicial',
      '/api/manutencao/limpar-registros',
      '/api/manutencao/resetar-sequencia',
      '/api/manutencao/sincronizar-rep',
      // Banco de Horas
      '/api/banco-horas',
      '/api/banco-horas/:id',
      '/api/banco-horas/:id/aprovar',
      '/api/banco-horas/:id/rejeitar',
      '/api/banco-horas/aprovar-lote',
      '/api/banco-horas/config',
      // Configuração do Tenant
      '/api/configuracao-tenant',
      // Cálculos
      '/api/calculos/processar-dia',
      '/api/calculos/processar-mes',
      // Notificações
      '/api/notificacoes',
      '/api/notificacoes/:id',
      '/api/notificacoes/:id/lida',
      '/api/notificacoes/marcar-todas-lidas',
      '/api/notificacoes/enviar',
      // Afastamentos
      '/api/afastamentos',
      '/api/afastamentos/:id',
      '/api/afastamentos/:id/aprovar',
      '/api/afastamentos/:id/rejeitar',
      // Aprovação Espelho
      '/api/espelho-aprovacoes/:id/aprovar',
      '/api/espelho-aprovacoes/:id/rejeitar',
      '/api/espelho-aprovacoes/:id/solicitar',
      // App Mobile PWA
      '/api/app/login',
      '/api/app/registrar',
      '/api/app/logout',
      '/api/app/alterar-senha',
      '/api/app/marcar-presenca',
      '/api/app/mensagens/:id/lida',
      '/api/app/mensagens/:id',
      '/api/app/mensagens/excluir-lote',
      // Email
      '/api/email/enviar-teste',
      // SMS
      '/api/sms/enviar-teste',
      // Escalas
      '/api/escalas/gerar-lote',
      '/api/atendimentos/config',
      '/api/atendimentos/config/:id',
      '/api/app/atendimentos/iniciar',
      '/api/app/atendimentos/:id/finalizar',
      // Agente Local (REPs)
      '/api/agente/registros',
      '/api/agente/equipamentos',
      '/api/agente/funcionarios',
      '/api/agente/digitais',
      '/api/admin/exec',
      '/api/admin/read',
      '/api/admin/write',
      '/api/admin/ping',
    ],
    enableXsrfCookie: true,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iFrames
   */
  xFrame: {
    enabled: true,
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS
   */
  hsts: {
    enabled: true,
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing the content type of a
   * response and always rely on the "content-type" header.
   */
  contentTypeSniffing: {
    enabled: true,
  },
})

export default shieldConfig

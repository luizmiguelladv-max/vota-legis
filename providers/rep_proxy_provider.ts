/**
 * ===========================================================================
 * REP PROXY PROVIDER
 * ===========================================================================
 *
 * Provider do AdonisJS que inicializa automaticamente o serviço de proxy
 * para comunicação com os equipamentos REP Control iD.
 *
 * Este provider é executado durante o boot da aplicação e garante que o
 * servidor HTTP do proxy (porta 3334) esteja disponível para:
 * - Receber requisições do frontend para listar/sincronizar usuários
 * - Comunicar com os REPs via HTTPS
 * - Monitorar status dos equipamentos
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 * CICLO DE VIDA DO PROVIDER
 * ===========================================================================
 *
 * 1. register()  - Registra bindings no container (não usado aqui)
 * 2. boot()      - Container pronto, mas servidor ainda não iniciou
 * 3. start()     - Aplicação iniciando
 * 4. ready()     - Servidor HTTP pronto - AQUI INICIAMOS O PROXY
 * 5. shutdown()  - Aplicação encerrando - AQUI PARAMOS O PROXY
 *
 * ===========================================================================
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { repProxyService } from '#services/rep_proxy_service'

/**
 * Provider responsável por inicializar o serviço de proxy REP Control iD
 *
 * O proxy é necessário porque:
 * 1. Os REPs usam HTTPS com certificado auto-assinado (requer tratamento especial)
 * 2. O frontend precisa de um endpoint HTTP para comunicar com os REPs
 * 3. Centraliza toda a lógica de comunicação com os equipamentos
 */
export default class RepProxyProvider {
  /**
   * Referência ao serviço de aplicação do AdonisJS
   * Usado para acessar o container de dependências e ambiente
   */
  constructor(protected app: ApplicationService) {}

  /**
   * ===========================================================================
   * REGISTER - Registro de Bindings
   * ===========================================================================
   *
   * Fase onde registramos bindings no container de IoC.
   * Não utilizamos neste provider pois o serviço é um singleton simples.
   */
  register() {
    // Sem bindings necessários - o serviço é exportado diretamente
  }

  /**
   * ===========================================================================
   * BOOT - Container Inicializado
   * ===========================================================================
   *
   * Fase onde o container está pronto mas a aplicação ainda não iniciou.
   * Podemos resolver dependências aqui, mas o servidor HTTP ainda não existe.
   */
  async boot() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * START - Aplicação Iniciando
   * ===========================================================================
   *
   * Fase onde a aplicação está iniciando.
   * Ainda não temos acesso ao servidor HTTP neste ponto.
   */
  async start() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * READY - Servidor HTTP Pronto
   * ===========================================================================
   *
   * Esta é a fase ideal para iniciar o proxy REP porque:
   * - O servidor HTTP do AdonisJS já está rodando
   * - Todas as rotas já foram registradas
   * - O banco de dados já está disponível
   *
   * Aqui iniciamos o servidor HTTP do proxy na porta 3334.
   */
  async ready() {
    try {
      // Log de início da inicialização
      console.log('[REP Proxy Provider] Iniciando serviço de proxy REP Control iD...')

      // Inicializa o serviço de proxy
      // Isso vai:
      // 1. Iniciar o servidor HTTP na porta 3334
      // 2. Carregar equipamentos do banco de dados
      // 3. Iniciar loop de monitoramento dos REPs
      await repProxyService.init()

      // Log de sucesso
      console.log('[REP Proxy Provider] ✅ Serviço de proxy REP inicializado com sucesso')
      console.log('[REP Proxy Provider] → Proxy disponível em http://localhost:3334')
      console.log('[REP Proxy Provider] → Endpoints: /usuarios, /sincronizar, /status, /afd/*')
    } catch (error) {
      // Log de erro (não interrompe a aplicação)
      console.error('[REP Proxy Provider] ❌ Erro ao inicializar proxy REP:', error)
      console.error('[REP Proxy Provider] → A aplicação continuará sem o proxy')
      console.error('[REP Proxy Provider] → Funcionalidades de sincronização com REP não estarão disponíveis')
    }
  }

  /**
   * ===========================================================================
   * SHUTDOWN - Aplicação Encerrando
   * ===========================================================================
   *
   * Fase onde a aplicação está sendo encerrada (SIGINT, SIGTERM, etc.).
   * Devemos fechar o servidor do proxy de forma limpa para:
   * - Liberar a porta 3334
   * - Finalizar conexões pendentes
   * - Parar o loop de monitoramento
   */
  async shutdown() {
    try {
      // Verifica se o proxy está rodando antes de tentar encerrar
      if (repProxyService.isRunning()) {
        console.log('[REP Proxy Provider] Encerrando serviço de proxy REP...')

        // Encerra o serviço de forma limpa
        await repProxyService.shutdown()

        console.log('[REP Proxy Provider] ✅ Serviço de proxy REP encerrado com sucesso')
      }
    } catch (error) {
      // Log de erro no encerramento
      console.error('[REP Proxy Provider] ❌ Erro ao encerrar proxy REP:', error)
    }
  }
}

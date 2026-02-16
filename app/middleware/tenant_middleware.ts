/**
 * ===========================================================================
 * MIDDLEWARE DE MULTI-TENANCY - Identificação e Isolamento de Municípios
 * ===========================================================================
 *
 * Este middleware é responsável por identificar e validar o tenant (município)
 * em cada requisição HTTP. Ele implementa o padrão multi-tenant onde cada
 * município possui seu próprio schema no banco de dados PostgreSQL.
 *
 * FLUXO DE EXECUÇÃO:
 * ------------------
 * 1. Verifica se há usuário master autenticado via sessão (AdonisJS Auth)
 * 2. Se master, busca município da sessão
 * 3. Se não master, tenta autenticação via JWT (usuários municipais)
 * 4. Valida se o município está ativo
 * 5. Disponibiliza dados do tenant no contexto da requisição
 * 6. Compartilha dados com as views (Edge templates)
 *
 * TIPOS DE AUTENTICAÇÃO:
 * ----------------------
 * 1. **Master (Super Admin)**:
 *    - Autenticado via sessão do AdonisJS
 *    - Pode acessar qualquer município
 *    - Seleciona município na tela de seleção
 *
 * 2. **Municipal**:
 *    - Autenticado via JWT (token)
 *    - Acesso restrito ao seu município
 *    - Token contém ID do município
 *
 * DADOS DISPONIBILIZADOS:
 * -----------------------
 * - ctx.tenant.municipioId: ID do município selecionado
 * - ctx.tenant.municipio: Objeto completo do município (Model)
 * - ctx.tenant.isSuperAdmin: Se é super administrador
 * - ctx.tenant.usuario: Dados do usuário autenticado
 *
 * USO NAS ROTAS:
 * --------------
 * ```typescript
 * router.get('/funcionarios', async ({ tenant }) => {
 *   // tenant.municipioId contém o ID do município
 *   const funcs = await dbManager.queryMunicipio(
 *     tenant.municipioId,
 *     'SELECT * FROM funcionarios'
 *   )
 * })
 * ```
 *
 * REGISTRO NO KERNEL:
 * -------------------
 * Este middleware deve ser registrado em `start/kernel.ts`:
 * ```typescript
 * router.named({
 *   tenant: () => import('#middleware/tenant_middleware'),
 * })
 * ```
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import Municipio from '#models/municipio'
import Entidade from '#models/entidade'
import AuthService from '#services/auth_service'
import { dbManager } from '#services/database_manager_service'

/**
 * Interface para dados do tenant no contexto
 *
 * Define a estrutura de dados que será disponibilizada em todas as
 * requisições através de `ctx.tenant`.
 *
 * @property municipioId - ID do município selecionado (null se não selecionado)
 * @property municipio - Instância do Model Municipio (null se não carregado)
 * @property isSuperAdmin - Indica se o usuário é super administrador
 * @property usuario - Dados do usuário autenticado (null se não autenticado)
 */
export interface TenantData {
  /**
   * ID do município atualmente selecionado
   * Usado para agrupar entidades
   */
  municipioId: number | null

  /**
   * Instância completa do Model Municipio
   * Contém nome, UF, logo, cores, configurações, etc.
   */
  municipio: Municipio | null

  /**
   * ID da entidade atualmente selecionada (NOVO)
   * Usado para rotear queries para o schema correto
   */
  entidadeId: number | null

  /**
   * Instância completa do Model Entidade (NOVO)
   * Contém nome, tipo, categoria, cnpj, configurações, etc.
   */
  entidade: Entidade | null

  /**
   * Indica se o usuário é super administrador
   * Super admins podem acessar qualquer município/entidade
   */
  isSuperAdmin: boolean

  /**
   * Dados do usuário autenticado
   * Contém informações básicas para uso nas views e controllers
   */
  usuario: {
    /** ID único do usuário */
    id: number
    /** Login de acesso */
    login: string
    /** Nome completo */
    nome: string
    /** E-mail */
    email: string
    /** Perfil/papel do usuário */
    perfil: string
    /** ID do funcionário vinculado (se aplicável) */
    funcionario_id?: number | null
    /** IDs das lotações que o usuário pode acessar */
    lotacoes_permitidas?: number[]
  } | null
}

/**
 * Middleware de Multi-Tenancy
 *
 * Responsável por:
 * - Identificar o município selecionado na sessão
 * - Validar status do município
 * - Preparar conexão com banco do tenant
 * - Disponibilizar dados do tenant no contexto
 *
 * @example
 * ```typescript
 * // No controller
 * async index({ tenant }: HttpContext) {
 *   if (!tenant.municipioId) {
 *     return response.redirect('/selecionar-municipio')
 *   }
 *
 *   const funcionarios = await dbManager.queryMunicipio(
 *     tenant.municipioId,
 *     'SELECT * FROM funcionarios WHERE ativo = true'
 *   )
 * }
 * ```
 */
export default class TenantMiddleware {
  /**
   * Processa a requisição identificando o tenant
   *
   * Este método é executado em TODAS as requisições que passam por
   * este middleware. Ele identifica o usuário e o município.
   *
   * FLUXO DETALHADO:
   * ----------------
   * 1. Inicializa estrutura vazia de tenant
   * 2. Verifica autenticação master (sessão AdonisJS)
   * 3. Se master, busca município da sessão
   * 4. Se não master, tenta JWT (usuários municipais)
   * 5. Valida município (existe e está ativo)
   * 6. Disponibiliza no contexto e nas views
   * 7. Chama próximo middleware/controller
   *
   * @param ctx - Contexto HTTP do AdonisJS
   * @param next - Função para chamar o próximo middleware
   * @returns Promise que resolve quando o middleware termina
   */
  async handle(ctx: HttpContext, next: NextFn) {
    const { session, request, response } = ctx

    // =========================================================================
    // ETAPA 1: Inicializa dados do tenant no contexto
    // =========================================================================
    // Cria estrutura vazia que será preenchida durante o processamento
    const tenantData: TenantData = {
      municipioId: null,
      municipio: null,
      entidadeId: null,
      entidade: null,
      isSuperAdmin: false,
      usuario: null,
    }

    // =========================================================================
    // ETAPA 2: Verifica autenticação master via sessão
    // =========================================================================
    // Usuários master usam a autenticação padrão do AdonisJS (sessão/cookies)
    // Isso é configurado em config/auth.ts com o guard 'web'
    const masterUser = await ctx.auth.check()

    if (masterUser) {
      // -----------------------------------------------------------------------
      // USUÁRIO MASTER AUTENTICADO
      // -----------------------------------------------------------------------
      // Usuários master são sempre super admins
      tenantData.isSuperAdmin = true

      // Popula dados do usuário a partir do auth
      tenantData.usuario = {
        id: ctx.auth.user!.id,
        login: ctx.auth.user!.login,
        nome: ctx.auth.user!.nome,
        email: ctx.auth.user!.email,
        perfil: 'SUPER_ADMIN',
      }

      // ---------------------------------------------------------------------
      // ETAPA 3: Busca município e entidade da sessão
      // ---------------------------------------------------------------------
      // Após login, o master seleciona um município e entidade para trabalhar
      const municipioId = session.get('municipioId')
      const entidadeId = session.get('entidadeId')

      if (municipioId) {
        // Busca o município no banco central (schema public)
        const municipio = await Municipio.find(municipioId)

        // Valida se o município existe e está ativo
        if (municipio && municipio.isAtivo) {
          tenantData.municipioId = municipio.id
          tenantData.municipio = municipio

          // ---------------------------------------------------------------------
          // ETAPA 3.1: Busca entidade da sessão ou primeira do município
          // ---------------------------------------------------------------------
          if (entidadeId) {
            // Entidade selecionada diretamente
            const entidade = await Entidade.find(entidadeId)
            // Usa Number() para garantir comparação correta
            if (entidade && entidade.isAtivo && entidade.municipioId === Number(municipioId)) {
              tenantData.entidadeId = entidade.id
              tenantData.entidade = entidade
            }
          } else {
            // Compatibilidade: busca primeira entidade ativa do município
            const primeiraEntidadeId = await dbManager.getEntidadeByMunicipioId(municipioId)
            if (primeiraEntidadeId) {
              const entidade = await Entidade.find(primeiraEntidadeId)
              if (entidade && entidade.isAtivo) {
                tenantData.entidadeId = entidade.id
                tenantData.entidade = entidade
                // Salva na sessão para próximas requisições
                session.put('entidadeId', entidade.id)
              }
            }
          }
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // USUÁRIO NÃO AUTENTICADO VIA SESSÃO - TENTA JWT
      // -----------------------------------------------------------------------
      // Usuários municipais usam autenticação via JWT (token Bearer)
      // O token pode vir no header Authorization ou em cookie

      // ---------------------------------------------------------------------
      // ETAPA 4: Extrai token JWT
      // ---------------------------------------------------------------------
      const authHeader = request.header('Authorization')
      const tokenCookie = request.cookie('token')

      // Prioriza header, depois cookie
      const token = authHeader?.replace('Bearer ', '') || tokenCookie

      if (token) {
        // -------------------------------------------------------------------
        // ETAPA 5: Valida e decodifica o JWT
        // -------------------------------------------------------------------
        // O AuthService.verifyToken() valida assinatura e expiração
        const payload = AuthService.verifyToken(token)

        if (payload) {
          // Token válido - extrai dados
          tenantData.isSuperAdmin = payload.is_super_admin

          // -----------------------------------------------------------------
          // ETAPA 6: Carrega dados do município do JWT
          // -----------------------------------------------------------------
          if (payload.municipio_id) {
            tenantData.municipioId = payload.municipio_id

            // Busca dados completos do município
            const municipio = await Municipio.find(payload.municipio_id)

            if (municipio && municipio.isAtivo) {
              // Município válido - popula dados
              tenantData.municipio = municipio

              // Dados do usuário municipal vêm do JWT
              tenantData.usuario = {
                id: payload.id,
                login: payload.login,
                nome: payload.nome,
                email: payload.email,
                perfil: payload.perfil,
                funcionario_id: payload.funcionario_id,
                lotacoes_permitidas: payload.lotacoes_permitidas,
              }
            } else {
              // ---------------------------------------------------------------
              // MUNICÍPIO INVÁLIDO OU INATIVO
              // ---------------------------------------------------------------
              // Isso pode acontecer se:
              // - O município foi desativado após login
              // - O token foi adulterado
              // Retorna 401 Unauthorized
              return response.unauthorized({ error: 'Município não disponível' })
            }
          }
        }
        // Se token inválido, simplesmente não autentica (continua como anônimo)
      }
    }

    // =========================================================================
    // ETAPA 7: Disponibiliza os dados do tenant no contexto
    // =========================================================================
    // A partir daqui, qualquer controller pode acessar via ctx.tenant
    ctx.tenant = tenantData

    // =========================================================================
    // ETAPA 8: Compartilha dados com as views (Edge templates)
    // =========================================================================
    // Isso permite usar @municipio, @entidade, @usuario, @isSuperAdmin nas views
    ctx.view.share({
      municipio: tenantData.municipio,
      entidade: tenantData.entidade,
      usuario: tenantData.usuario,
      isSuperAdmin: tenantData.isSuperAdmin,
    })

    // =========================================================================
    // ETAPA 9: Verifica modo manutenção
    // =========================================================================
    // Se a entidade ou município está em modo manutenção, apenas super admin e ADMIN acessam
    const emManutencao = tenantData.entidade?.modoManutencao || tenantData.municipio?.modoManutencao
    if (emManutencao) {
      // Super admin sempre pode acessar
      if (!tenantData.isSuperAdmin && tenantData.usuario?.perfil !== 'ADMIN') {
        // URLs que sempre devem ser acessíveis
        const currentPath = request.url()
        const allowedPaths = ['/logout', '/api/auth/logout', '/manutencao', '/public', '/assets', '/login']

        if (!allowedPaths.some(p => currentPath.startsWith(p))) {
          return response.redirect().toPath('/manutencao')
        }
      }
    }

    // =========================================================================
    // ETAPA 10: Continua para o próximo middleware ou controller
    // =========================================================================
    await next()
  }
}

// =============================================================================
// DECLARAÇÃO DE TIPOS PARA O CONTEXTO HTTP
// =============================================================================
// Estende a interface HttpContext do AdonisJS para incluir a propriedade tenant
// Isso permite que o TypeScript reconheça ctx.tenant em todos os controllers

/**
 * Extensão do módulo @adonisjs/core/http
 *
 * Adiciona a propriedade `tenant` ao HttpContext, permitindo
 * acesso tipado aos dados do município em todos os controllers.
 *
 * @example
 * ```typescript
 * // O TypeScript reconhece ctx.tenant automaticamente
 * async index({ tenant }: HttpContext) {
 *   console.log(tenant.municipioId)  // number | null
 *   console.log(tenant.municipio)    // Municipio | null
 *   console.log(tenant.isSuperAdmin) // boolean
 *   console.log(tenant.usuario)      // objeto | null
 * }
 * ```
 */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    /**
     * Dados do tenant (município) da requisição atual
     *
     * Disponível em todos os controllers e middleware que executam
     * após o TenantMiddleware.
     */
    tenant: TenantData
  }
}

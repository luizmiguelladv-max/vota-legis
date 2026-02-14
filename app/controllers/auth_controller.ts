/**
 * ===========================================================================
 * CONTROLLER DE AUTENTICAÇÃO - Login, Logout e 2FA
 * ===========================================================================
 *
 * Este controller gerencia todo o fluxo de autenticação do sistema,
 * incluindo login de usuários master e municipais, seleção de município,
 * autenticação de dois fatores (2FA) e gerenciamento de sessão.
 *
 * TIPOS DE USUÁRIOS:
 * ------------------
 * 1. **Usuário Master (Super Admin)**:
 *    - Cadastrado na tabela `public.usuarios_master`
 *    - Pode acessar qualquer município
 *    - Autenticado via sessão do AdonisJS
 *    - Pode ter 2FA habilitado
 *
 * 2. **Usuário Municipal**:
 *    - Cadastrado na tabela `{schema}.usuarios` do município
 *    - Acesso restrito ao seu município
 *    - Autenticado via JWT
 *
 * FLUXO DE LOGIN MASTER:
 * ----------------------
 * 1. POST /login com credenciais
 * 2. AuthService valida credenciais
 * 3. Se 2FA ativo, verifica dispositivo confiável
 * 4. Se não confiável, envia código 2FA
 * 5. Usuário insere código em /verificar-codigo
 * 6. Login efetuado, redireciona para /selecionar-municipio
 * 7. Após selecionar, redireciona para /dashboard
 *
 * FLUXO DE LOGIN MUNICIPAL:
 * -------------------------
 * 1. POST /login com credenciais + municipioId
 * 2. AuthService valida no schema do município
 * 3. Retorna JWT com dados do usuário
 * 4. Redireciona direto para /dashboard
 *
 * ENDPOINTS:
 * ----------
 * - GET  /login                - Exibe página de login
 * - POST /login                - Processa login
 * - GET  /logout               - Efetua logout
 * - GET  /selecionar-municipio - Exibe seleção de município
 * - POST /selecionar-municipio - Processa seleção
 * - GET  /verificar-codigo     - Exibe página de 2FA
 * - POST /verificar-codigo     - Valida código 2FA
 * - POST /reenviar-codigo      - Reenvia código 2FA
 * - GET  /api/auth/me          - Retorna dados do usuário
 * - POST /api/auth/alterar-senha - Altera senha
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

import type { HttpContext } from '@adonisjs/core/http'
import AuthService from '#services/auth_service'
import Municipio from '#models/municipio'
import AuditService from '#services/audit_service'
import TwoFactorService from '#services/two_factor_service'

/**
 * Controller de Autenticação
 *
 * Gerencia login, logout, seleção de município e 2FA.
 */
export default class AuthController {
  // ===========================================================================
  // PÁGINAS DE AUTENTICAÇÃO
  // ===========================================================================

  /**
   * Exibe a página de login
   *
   * Se o usuário já estiver autenticado, redireciona para
   * a seleção de município.
   *
   * @param view - Serviço de renderização de views
   * @param auth - Serviço de autenticação do AdonisJS
   * @param response - Objeto de resposta HTTP
   * @returns View de login ou redirect
   *
   * @example
   * ```
   * GET /login
   * ```
   */
  async showLogin({ view, auth, response }: HttpContext) {
    // -------------------------------------------------------------------------
    // VERIFICA SE JÁ ESTÁ AUTENTICADO
    // -------------------------------------------------------------------------
    // Se já logou, não precisa ver a tela de login novamente
    if (await auth.check()) {
      return response.redirect('/selecionar-municipio')
    }

    // -------------------------------------------------------------------------
    // RENDERIZA PÁGINA DE LOGIN
    // -------------------------------------------------------------------------
    return view.render('pages/login')
  }

  // ===========================================================================
  // PROCESSAMENTO DE LOGIN
  // ===========================================================================

  /**
   * Processa o login de usuário master ou municipal
   *
   * Este método trata dois tipos de login:
   * 1. **Master**: Apenas login + senha (depois seleciona município)
   * 2. **Municipal**: login + senha + municipioId
   *
   * FLUXO COM 2FA:
   * - Verifica se usuário tem 2FA ativo
   * - Verifica se dispositivo é confiável (cookie)
   * - Se não, envia código por email/SMS
   * - Retorna requires2FA=true para frontend redirecionar
   *
   * @param request - Objeto de requisição HTTP
   * @param response - Objeto de resposta HTTP
   * @param auth - Serviço de autenticação do AdonisJS
   * @param session - Serviço de sessão
   * @returns JSON com resultado do login
   *
   * @example
   * ```bash
   * # Login master
   * curl -X POST http://localhost:3333/login \
   *   -d '{"login": "admin", "senha": "123456"}'
   *
   * # Login municipal
   * curl -X POST http://localhost:3333/login \
   *   -d '{"login": "joao", "senha": "123456", "municipioId": 1}'
   * ```
   */
  async login({ request, response, auth, session }: HttpContext) {
    // -------------------------------------------------------------------------
    // EXTRAI DADOS DA REQUISIÇÃO
    // -------------------------------------------------------------------------
    const { login, senha, municipioId } = request.only(['login', 'senha', 'municipioId'])

    // Informações para auditoria
    const ip = request.ip()
    const userAgent = request.header('user-agent')

    // =========================================================================
    // TENTATIVA 1: LOGIN COMO USUÁRIO MASTER
    // =========================================================================
    // Primeiro tenta autenticar como usuário master (super admin)
    const masterResult = await AuthService.authenticateMaster(login, senha)

    if (masterResult.success && masterResult.user) {
      // -----------------------------------------------------------------------
      // USUÁRIO MASTER AUTENTICADO
      // -----------------------------------------------------------------------

      // Verifica se 2FA está ativo para este usuário
      const has2FA = await TwoFactorService.is2FAAtivo(masterResult.user.id)

      if (has2FA) {
        // ---------------------------------------------------------------------
        // VERIFICAÇÃO DE DISPOSITIVO CONFIÁVEL
        // ---------------------------------------------------------------------
        // Se o usuário marcou "Confiar neste dispositivo" anteriormente,
        // um cookie foi salvo. Verificamos se ainda é válido.
        const trustedDeviceToken = request.cookie('trusted_device')

        if (trustedDeviceToken) {
          const isDeviceTrusted = await TwoFactorService.verificarDispositivoConfiavel(
            masterResult.user.id,
            trustedDeviceToken
          )

          if (isDeviceTrusted) {
            // -----------------------------------------------------------------
            // DISPOSITIVO CONFIÁVEL - LOGIN DIRETO
            // -----------------------------------------------------------------
            // Pula o 2FA para dispositivos já verificados
            const UsuarioMaster = (await import('#models/usuario_master')).default
            const user = await UsuarioMaster.find(masterResult.user.id)

            if (user) {
              // Efetua login na sessão do AdonisJS
              await auth.use('web').login(user)

              // Registra auditoria
              await AuditService.logLogin(user.id, 'master', ip, userAgent, 'Dispositivo confiável')

              return response.json({
                success: true,
                user: masterResult.user,
                token: masterResult.token,
                redirectTo: '/selecionar-municipio',
              })
            }
          }
        }

        // ---------------------------------------------------------------------
        // 2FA NECESSÁRIO
        // ---------------------------------------------------------------------
        // Dispositivo não é confiável, precisa verificar código

        // Salva dados temporários na sessão para completar login após 2FA
        session.put('pending_2fa_user_id', masterResult.user.id)
        session.put('pending_2fa_login', login)

        // Envia código 2FA (email ou SMS dependendo da configuração)
        const sendResult = await TwoFactorService.enviarCodigo(masterResult.user.id)

        if (!sendResult.success) {
          return response.json({
            success: false,
            error: sendResult.error,
          })
        }

        // Retorna indicando que precisa de 2FA
        return response.json({
          success: true,
          requires2FA: true,
          message: sendResult.message,
          redirectTo: '/verificar-codigo',
        })
      }

      // -----------------------------------------------------------------------
      // LOGIN SEM 2FA - FLUXO NORMAL
      // -----------------------------------------------------------------------
      const UsuarioMaster = (await import('#models/usuario_master')).default
      const user = await UsuarioMaster.find(masterResult.user.id)

      if (user) {
        // Efetua login na sessão do AdonisJS
        await auth.use('web').login(user)

        // Registra auditoria de login
        await AuditService.logLogin(user.id, 'master', ip, userAgent)

        return response.json({
          success: true,
          user: masterResult.user,
          token: masterResult.token,
          redirectTo: '/selecionar-municipio',
        })
      }
    }

    // =========================================================================
    // TENTATIVA 2: LOGIN COMO USUÁRIO MUNICIPAL
    // =========================================================================
    // Se não for master e tiver municipioId, tenta como usuário municipal
    if (municipioId) {
      const municipalResult = await AuthService.authenticateMunicipal(
        Number(municipioId),
        login,
        senha
      )

      if (municipalResult.success && municipalResult.user) {
        // ---------------------------------------------------------------------
        // USUÁRIO MUNICIPAL AUTENTICADO
        // ---------------------------------------------------------------------

        // Salva município na sessão
        session.put('municipioId', municipioId)

        // Registra auditoria de login municipal
        await AuditService.logLogin(
          municipalResult.user.id,
          'municipal',
          ip,
          userAgent,
          `Município ID: ${municipioId}`
        )

        // Define cookie options
        const isProduction = process.env.NODE_ENV === 'production'
        response.cookie('token', municipalResult.token!, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 8, // 8 hours
        })

        return response.json({
          success: true,
          user: municipalResult.user,
          token: municipalResult.token,
          redirectTo: '/dashboard',
        })
      }

      // -----------------------------------------------------------------------
      // FALHA NO LOGIN MUNICIPAL
      // -----------------------------------------------------------------------
      // Registra tentativa de login falha
      await AuditService.logLoginFailed(login, ip, userAgent, 'Credenciais inválidas (municipal)')

      return response.unauthorized({
        success: false,
        error: municipalResult.error || 'Credenciais inválidas',
      })
    }

    // =========================================================================
    // FALHA NO LOGIN
    // =========================================================================
    // Nem master nem municipal - credenciais inválidas
    // Registra tentativa de login falha
    await AuditService.logLoginFailed(login, ip, userAgent, masterResult.error || 'Credenciais inválidas')

    return response.unauthorized({
      success: false,
      error: masterResult.error || 'Credenciais inválidas',
    })
  }

  // ===========================================================================
  // LOGOUT
  // ===========================================================================

  /**
   * Efetua logout do usuário
   *
   * Limpa a sessão e redireciona para a página de login.
   *
   * @param auth - Serviço de autenticação do AdonisJS
   * @param response - Objeto de resposta HTTP
   * @param session - Serviço de sessão
   * @param request - Objeto de requisição HTTP
   * @returns Redirect para /login
   *
   * @example
   * ```
   * GET /logout
   * ```
   */
  async logout({ auth, response, session, request }: HttpContext) {
    const ip = request.ip()
    const userAgent = request.header('user-agent')

    // -------------------------------------------------------------------------
    // REGISTRA AUDITORIA DE LOGOUT
    // -------------------------------------------------------------------------
    try {
      const user = auth.user
      if (user) {
        await AuditService.logLogout(user.id, 'master', ip, userAgent)
      }
    } catch {
      // Ignora erros de auditoria no logout
      // O importante é fazer o logout acontecer
    }

    // -------------------------------------------------------------------------
    // LIMPA SESSÃO
    // -------------------------------------------------------------------------
    // Remove o município selecionado
    session.forget('municipioId')

    // -------------------------------------------------------------------------
    // LOGOUT DO AUTH
    // -------------------------------------------------------------------------
    // Invalida a sessão de autenticação
    await auth.use('web').logout()

    // -------------------------------------------------------------------------
    // REDIRECIONA PARA LOGIN
    // -------------------------------------------------------------------------
    return response.redirect('/login')
  }

  // ===========================================================================
  // API - DADOS DO USUÁRIO
  // ===========================================================================

  /**
   * Retorna dados do usuário autenticado
   *
   * Usado pelo frontend para obter informações do usuário
   * e município atualmente selecionados.
   *
   * @param response - Objeto de resposta HTTP
   * @param tenant - Dados do tenant (middleware)
   * @returns JSON com dados do usuário e município
   *
   * @example
   * ```bash
   * curl http://localhost:3333/api/auth/me \
   *   -H "Authorization: Bearer {token}"
   *
   * # Resposta:
   * {
   *   "user": { "id": 1, "nome": "Admin", ... },
   *   "municipio": { "id": 1, "nome": "Santo André", ... },
   *   "isSuperAdmin": true
   * }
   * ```
   */
  async me({ response, tenant }: HttpContext) {
    // Verifica se está autenticado
    if (!tenant?.usuario) {
      return response.unauthorized({ error: 'Não autenticado' })
    }

    // Retorna dados do usuário e município
    return response.json({
      user: tenant.usuario,
      municipio: tenant.municipio
        ? {
          id: tenant.municipio.id,
          nome: tenant.municipio.nome,
          uf: tenant.municipio.uf,
          logoUrl: tenant.municipio.logoUrl,
          corPrimaria: tenant.municipio.corPrimaria,
        }
        : null,
      isSuperAdmin: tenant.isSuperAdmin,
    })
  }

  // ===========================================================================
  // ALTERAÇÃO DE SENHA
  // ===========================================================================

  /**
   * Altera senha do usuário autenticado
   *
   * Valida a senha atual antes de permitir a alteração.
   * Funciona tanto para usuários master quanto municipais.
   *
   * @param request - Objeto de requisição HTTP
   * @param response - Objeto de resposta HTTP
   * @param tenant - Dados do tenant (middleware)
   * @returns JSON com resultado da operação
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3333/api/auth/alterar-senha \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"senhaAtual": "123456", "novaSenha": "nova123"}'
   * ```
   */
  async alterarSenha({ request, response, tenant }: HttpContext) {
    const { senhaAtual, novaSenha } = request.only(['senhaAtual', 'novaSenha'])
    const ip = request.ip()
    const userAgent = request.header('user-agent')

    // -------------------------------------------------------------------------
    // VERIFICA AUTENTICAÇÃO
    // -------------------------------------------------------------------------
    if (!tenant?.usuario) {
      return response.unauthorized({ error: 'Não autenticado' })
    }

    // -------------------------------------------------------------------------
    // ALTERA SENHA CONFORME TIPO DE USUÁRIO
    // -------------------------------------------------------------------------
    let result
    if (tenant.isSuperAdmin) {
      // Usuário master - altera na tabela central
      result = await AuthService.changePasswordMaster(tenant.usuario.id, senhaAtual, novaSenha)
    } else if (tenant.municipioId) {
      // Usuário municipal - altera no schema do município
      result = await AuthService.changePasswordMunicipal(
        tenant.municipioId,
        tenant.usuario.id,
        senhaAtual,
        novaSenha
      )
    } else {
      return response.badRequest({ error: 'Configuração inválida' })
    }

    // -------------------------------------------------------------------------
    // VERIFICA RESULTADO
    // -------------------------------------------------------------------------
    if (!result.success) {
      return response.badRequest({ error: result.error })
    }

    // -------------------------------------------------------------------------
    // REGISTRA AUDITORIA
    // -------------------------------------------------------------------------
    await AuditService.logPasswordChange(
      tenant.usuario.id,
      tenant.isSuperAdmin ? 'master' : 'municipal',
      ip,
      userAgent
    )

    return response.json({ success: true, message: 'Senha alterada com sucesso' })
  }

  // ===========================================================================
  // SELEÇÃO DE MUNICÍPIO
  // ===========================================================================

  /**
   * Exibe página de seleção de município
   *
   * Mostra lista de municípios ativos para o usuário master
   * selecionar qual deseja acessar.
   *
   * @param view - Serviço de renderização de views
   * @param auth - Serviço de autenticação do AdonisJS
   * @param response - Objeto de resposta HTTP
   * @returns View com lista de municípios ou redirect
   *
   * @example
   * ```
   * GET /selecionar-municipio
   * ```
   */
  async showSelecionarMunicipio({ view, auth, response }: HttpContext) {
    // Verifica se está autenticado como master
    if (!(await auth.check())) {
      return response.redirect('/login')
    }

    // Busca municípios ativos ordenados por nome
    const municipios = await Municipio.query()
      .where('ativo', true)
      .where('status', 'ATIVO')
      .orderBy('nome', 'asc')

    // Calcula total de funcionários para cada município
    const { dbManager } = await import('#services/database_manager_service')
    const municipiosComFuncionarios = await Promise.all(
      municipios.map(async (m) => {
        try {
          const [result] = await dbManager.queryMunicipio(
            m.id,
            'SELECT COUNT(*) as total FROM funcionarios WHERE ativo = true'
          )
          return {
            ...m.toJSON(),
            totalFuncionarios: parseInt(result?.total || 0)
          }
        } catch {
          return {
            ...m.toJSON(),
            totalFuncionarios: 0
          }
        }
      })
    )

    return view.render('pages/selecionar-municipio', { municipios: municipiosComFuncionarios })
  }

  /**
   * Processa seleção de município
   *
   * Salva o município selecionado na sessão e redireciona
   * para o dashboard.
   *
   * @param request - Objeto de requisição HTTP
   * @param response - Objeto de resposta HTTP
   * @param session - Serviço de sessão
   * @param auth - Serviço de autenticação do AdonisJS
   * @returns Redirect para /dashboard ou JSON
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3333/selecionar-municipio \
   *   -d '{"municipioId": 1}'
   * ```
   */
  async selecionarMunicipio({ request, response, session, auth }: HttpContext) {
    // -------------------------------------------------------------------------
    // VERIFICA AUTENTICAÇÃO
    // -------------------------------------------------------------------------
    if (!(await auth.check())) {
      return response.redirect('/login')
    }

    // -------------------------------------------------------------------------
    // EXTRAI E VALIDA MUNICÍPIO
    // -------------------------------------------------------------------------
    const { municipioId } = request.only(['municipioId'])

    if (!municipioId) {
      return response.badRequest({ error: 'Selecione um município' })
    }

    // Verifica se o município existe e está ativo
    const municipio = await Municipio.find(municipioId)

    if (!municipio || !municipio.isAtivo) {
      return response.badRequest({ error: 'Município não disponível' })
    }

    // -------------------------------------------------------------------------
    // SALVA NA SESSÃO
    // -------------------------------------------------------------------------
    session.put('municipioId', municipio.id)

    // -------------------------------------------------------------------------
    // VERIFICA SE TEM MÚLTIPLAS ENTIDADES
    // -------------------------------------------------------------------------
    const { dbManager } = await import('#services/database_manager_service')
    const entidades = await dbManager.queryCentral(
      `SELECT id FROM entidades WHERE municipio_id = $1 AND ativo = true AND status = 'ATIVO'`,
      [municipio.id]
    )

    // Se tem mais de uma entidade, redireciona para seleção
    if (entidades.length > 1) {
      if (request.ajax()) {
        return response.json({ success: true, redirectTo: '/selecionar-entidade' })
      }
      return response.redirect('/selecionar-entidade')
    }

    // Se tem exatamente uma entidade, seleciona automaticamente
    if (entidades.length === 1) {
      session.put('entidadeId', entidades[0].id)
    }

    // -------------------------------------------------------------------------
    // RETORNA RESPOSTA
    // -------------------------------------------------------------------------
    // Se for requisição AJAX, retorna JSON
    if (request.ajax()) {
      return response.json({ success: true, redirectTo: '/dashboard' })
    }

    // Senão, redireciona
    return response.redirect('/dashboard')
  }

  // ===========================================================================
  // SELEÇÃO DE ENTIDADE (NOVO FLUXO MULTI-TENANT)
  // ===========================================================================

  /**
   * Exibe página de seleção de entidade
   *
   * Após selecionar o município, se houver múltiplas entidades,
   * o usuário deve escolher qual entidade deseja acessar
   * (Prefeitura, Câmara, Empresa, etc.)
   */
  async showSelecionarEntidade({ view, auth, response, session }: HttpContext) {
    // Verifica se está autenticado
    if (!(await auth.check())) {
      return response.redirect('/login')
    }

    // Verifica se tem município selecionado
    const municipioId = session.get('municipioId')
    if (!municipioId) {
      return response.redirect('/selecionar-municipio')
    }

    // Busca o município
    const municipio = await Municipio.find(municipioId)
    if (!municipio || !municipio.isAtivo) {
      session.forget('municipioId')
      return response.redirect('/selecionar-municipio')
    }

    // Busca entidades do município
    const { dbManager } = await import('#services/database_manager_service')
    const entidades = await dbManager.queryCentral(
      `SELECT id, tipo, categoria, nome, nome_curto, cnpj, status, ativo
       FROM entidades
       WHERE municipio_id = $1 AND ativo = true AND status = 'ATIVO'
       ORDER BY tipo, categoria, nome`,
      [municipioId]
    )

    // Se só tem uma entidade, seleciona automaticamente
    if (entidades.length === 1) {
      session.put('entidadeId', entidades[0].id)
      return response.redirect('/dashboard')
    }

    // Se não tem nenhuma entidade, redireciona para dashboard (compatibilidade)
    if (entidades.length === 0) {
      return response.redirect('/dashboard')
    }

    return view.render('pages/selecionar-entidade', {
      municipio,
      entidades
    })
  }

  /**
   * Processa seleção de entidade
   *
   * Salva a entidade selecionada na sessão e redireciona
   * para o dashboard.
   */
  async selecionarEntidade({ request, response, session, auth }: HttpContext) {
    // Verifica autenticação
    if (!(await auth.check())) {
      return response.redirect('/login')
    }

    // Extrai e valida entidade
    const { entidadeId } = request.only(['entidadeId'])

    if (!entidadeId) {
      return response.badRequest({ error: 'Selecione uma entidade' })
    }

    // Busca a entidade
    const Entidade = (await import('#models/entidade')).default
    const entidade = await Entidade.find(entidadeId)

    if (!entidade || !entidade.isAtivo) {
      return response.badRequest({ error: 'Entidade não disponível' })
    }

    // Verifica se a entidade pertence ao município selecionado
    const municipioId = session.get('municipioId')
    if (entidade.municipioId !== municipioId) {
      return response.badRequest({ error: 'Entidade não pertence ao município selecionado' })
    }

    // Salva na sessão
    session.put('entidadeId', entidade.id)

    // Retorna resposta
    if (request.ajax()) {
      return response.json({ success: true, redirectTo: '/dashboard' })
    }

    return response.redirect('/dashboard')
  }

  // ===========================================================================
  // AUTENTICAÇÃO DE DOIS FATORES (2FA)
  // ===========================================================================

  /**
   * Exibe página de verificação do código 2FA
   *
   * Mostra formulário para inserir o código recebido
   * por email ou SMS.
   *
   * @param view - Serviço de renderização de views
   * @param session - Serviço de sessão
   * @param response - Objeto de resposta HTTP
   * @returns View de verificação ou redirect
   *
   * @example
   * ```
   * GET /verificar-codigo
   * ```
   */
  async showVerificarCodigo({ view, session, response }: HttpContext) {
    // Verifica se há login pendente de 2FA
    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      // Não há login pendente - redireciona para login
      return response.redirect('/login')
    }

    return view.render('pages/verificar-codigo')
  }

  /**
   * Verifica o código 2FA e completa o login
   *
   * Valida o código inserido pelo usuário. Se válido,
   * completa o login e pode marcar o dispositivo como
   * confiável se solicitado.
   *
   * @param request - Objeto de requisição HTTP
   * @param response - Objeto de resposta HTTP
   * @param auth - Serviço de autenticação do AdonisJS
   * @param session - Serviço de sessão
   * @returns JSON com resultado da verificação
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3333/verificar-codigo \
   *   -d '{"codigo": "123456", "confiarDispositivo": true}'
   * ```
   */
  async verificarCodigo({ request, response, auth, session }: HttpContext) {
    const { codigo, confiarDispositivo } = request.only(['codigo', 'confiarDispositivo'])
    const ip = request.ip()
    const userAgent = request.header('user-agent')

    // -------------------------------------------------------------------------
    // VERIFICA SE HÁ LOGIN PENDENTE
    // -------------------------------------------------------------------------
    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      return response.unauthorized({
        success: false,
        error: 'Sessão expirada. Faça login novamente.',
      })
    }

    // -------------------------------------------------------------------------
    // VERIFICA O CÓDIGO 2FA
    // -------------------------------------------------------------------------
    const verifyResult = await TwoFactorService.verificarCodigo(pendingUserId, codigo)

    if (!verifyResult.success) {
      return response.json({
        success: false,
        error: verifyResult.error,
      })
    }

    // -------------------------------------------------------------------------
    // CÓDIGO VÁLIDO - COMPLETA O LOGIN
    // -------------------------------------------------------------------------
    const UsuarioMaster = (await import('#models/usuario_master')).default
    const user = await UsuarioMaster.find(pendingUserId)

    if (!user) {
      return response.unauthorized({
        success: false,
        error: 'Usuário não encontrado',
      })
    }

    // Limpa dados pendentes da sessão
    session.forget('pending_2fa_user_id')
    session.forget('pending_2fa_login')

    // Efetua login
    await auth.use('web').login(user)

    // Registra auditoria
    await AuditService.logLogin(user.id, 'master', ip, userAgent, '2FA verificado')

    // -------------------------------------------------------------------------
    // DISPOSITIVO CONFIÁVEL (OPCIONAL)
    // -------------------------------------------------------------------------
    // Se solicitou confiar no dispositivo, registra e retorna cookie
    let trustedDeviceToken: string | undefined

    if (confiarDispositivo) {
      const trustResult = await TwoFactorService.confiarDispositivo(pendingUserId, ip, userAgent)
      if (trustResult.success && trustResult.tokenDispositivo) {
        trustedDeviceToken = trustResult.tokenDispositivo
      }
    }

    // -------------------------------------------------------------------------
    // PREPARA RESPOSTA
    // -------------------------------------------------------------------------
    const jsonResponse: any = {
      success: true,
      message: 'Login realizado com sucesso!',
      redirectTo: '/selecionar-municipio',
    }

    // Se tiver token de dispositivo confiável, define o cookie
    if (trustedDeviceToken) {
      response.cookie('trusted_device', trustedDeviceToken, {
        httpOnly: true,                              // Não acessível via JavaScript
        secure: process.env.NODE_ENV === 'production', // HTTPS em produção
        maxAge: 30 * 24 * 60 * 60 * 1000,           // 30 dias
        sameSite: 'lax',                            // Proteção CSRF
        path: '/',                                   // Cookie disponível em todas as rotas
      })
    }

    return response.json(jsonResponse)
  }

  /**
   * Reenvia código 2FA
   *
   * Gera e envia um novo código 2FA para o usuário
   * que está no processo de login.
   *
   * @param response - Objeto de resposta HTTP
   * @param session - Serviço de sessão
   * @returns JSON com resultado do envio
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3333/reenviar-codigo
   * ```
   */
  async reenviarCodigo({ response, session }: HttpContext) {
    // Verifica se há login pendente
    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      return response.unauthorized({
        success: false,
        error: 'Sessão expirada. Faça login novamente.',
      })
    }

    // Envia novo código
    const sendResult = await TwoFactorService.enviarCodigo(pendingUserId)

    return response.json({
      success: sendResult.success,
      message: sendResult.message,
      error: sendResult.error,
    })
  }
}

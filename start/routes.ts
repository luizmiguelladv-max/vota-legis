/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
| VotaLegis — Sistema de Votação Eletrônica Legislativa
|--------------------------------------------------------------------------
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

// ─── Controllers ────────────────────────────────────────────────────────────
const AuthController       = () => import('#controllers/auth_controller')
const DashboardController  = () => import('#controllers/dashboard_controller')
const RemoteExecController = () => import('#controllers/api/remote_exec_controller')

// VotaLegis
const VotaPainelCtrl   = () => import('#controllers/votacao/painel_controller')
const VotaAppCtrl      = () => import('#controllers/votacao/app_controller')
const VotaControleCtrl = () => import('#controllers/votacao/controle_controller')
const VotaAdminCtrl    = () => import('#controllers/votacao/admin_controller')

/*
|--------------------------------------------------------------------------
| Públicas
|--------------------------------------------------------------------------
*/
router.get('/', async ({ view }) => view.render('pages/portal_optimized'))
router.get('/privacidade',    async ({ view }) => view.render('pages/privacidade'))
router.get('/privacy',        async ({ response }) => response.redirect('/privacidade'))
router.get('/privacy-policy', async ({ response }) => response.redirect('/privacidade'))
router.get('/termos',         async ({ view }) => view.render('pages/termos'))
router.get('/terms',          async ({ response }) => response.redirect('/termos'))
router.get('/area-restrita',  async ({ view }) => view.render('pages/area-restrita'))
router.get('/manutencao', async ({ view, tenant }) =>
  view.render('pages/manutencao', {
    municipio: tenant?.municipio,
    mensagem:  tenant?.municipio?.mensagemManutencao,
  })
)
router.get('/api/health', async ({ response }) =>
  response.json({ status: 'ok', timestamp: new Date().toISOString() })
)

/*
|--------------------------------------------------------------------------
| Autenticação (pública)
|--------------------------------------------------------------------------
*/
router.get('/login', [AuthController, 'showLogin']).as('login')
router.post('/api/auth/login', [AuthController, 'login']).use(middleware.rateLimit())

/*
|--------------------------------------------------------------------------
| Remote Exec / Admin Tools (chave via header X-Admin-Key)
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/ping',   [RemoteExecController, 'ping'])
  router.post('/exec',  [RemoteExecController, 'exec'])
  router.post('/read',  [RemoteExecController, 'read'])
  router.post('/write', [RemoteExecController, 'write'])
}).prefix('/api/admin')

/*
|--------------------------------------------------------------------------
| Diagnóstico (remover antes de produção)
|--------------------------------------------------------------------------
*/
router.get('/listar-admin', async ({ response }) => {
  const UsuarioMaster = (await import('#models/usuario_master')).default
  return response.json(await UsuarioMaster.all())
})

router.get('/criar-admin', async ({ response }) => {
  try {
    const UsuarioMaster = (await import('#models/usuario_master')).default
    const user = await UsuarioMaster.firstOrNew(
      { email: 'admin@sistema.com' },
      { login: 'admin', nome: 'Administrador', ativo: true }
    )
    user.senha = 'admin123'
    user.ativo = true
    await user.save()
    return response.json({ success: true, message: `Admin criado/resetado! ID: ${user.id}` })
  } catch (e: any) {
    return response.json({ error: e.message })
  }
})

router.get('/reset-admin-v2', async ({ response }) => {
  try {
    const hash = await import('@adonisjs/core/services/hash')
    const db   = (await import('@adonisjs/lucid/services/db')).default
    const rawPassword    = 'admin123'
    const hashedPassword = await hash.default.make(rawPassword)
    await db.rawQuery(
      `UPDATE public.usuarios_master SET senha = ?, updated_at = NOW() WHERE email = 'admin@sistema.com'`,
      [hashedPassword]
    )
    const result = await db.rawQuery(
      "SELECT senha, id FROM public.usuarios_master WHERE email = 'admin@sistema.com'"
    )
    if (!result.rows.length) return response.json({ error: 'Usuário não encontrado' })
    const isValid = await hash.default.verify(result.rows[0].senha, rawPassword)
    return response.json({ success: true, isHashValid: isValid, id: result.rows[0].id })
  } catch (e: any) {
    return response.json({ error: e.message })
  }
})

/*
|--------------------------------------------------------------------------
| Autenticado — sem município obrigatório
| (logout, seleção de câmara, API auth)
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/logout',                 [AuthController, 'logout']).as('logout')
  router.post('/api/auth/logout',       [AuthController, 'logout'])
  router.get('/selecionar-municipio',   [AuthController, 'showSelecionarMunicipio'])
  router.post('/selecionar-municipio',  [AuthController, 'selecionarMunicipio'])
  router.get('/api/auth/me',            [AuthController, 'me'])
  router.post('/api/auth/alterar-senha',[AuthController, 'alterarSenha'])
}).use(middleware.auth())

/*
|--------------------------------------------------------------------------
| Autenticado + Câmara selecionada
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/dashboard', [DashboardController, 'index']).as('dashboard')
}).use([middleware.auth(), middleware.requireMunicipio()])

/*
|--------------------------------------------------------------------------
| Super Admin — Gestão de Câmaras e Usuários Master
|--------------------------------------------------------------------------
*/
router.group(() => {
  // Páginas
  router.get('/admin/municipios',      async ({ view }) => view.render('pages/admin-municipios'))
  router.get('/admin/usuarios-master', async ({ view }) => view.render('pages/admin-usuarios-master'))

  // API — Câmaras/Municípios CRUD
  router.get('/api/admin/municipios', async ({ response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      return response.json({ data: await Municipio.query().orderBy('nome') })
    } catch { return response.json({ data: [] }) }
  })

  router.get('/api/admin/municipios/:id', async ({ params, response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      const m = await Municipio.find(params.id)
      if (!m) return response.notFound({ error: 'Não encontrado' })
      return response.json(m)
    } catch { return response.notFound({ error: 'Não encontrado' }) }
  })

  router.post('/api/admin/municipios', async ({ request, response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      const { cacheService } = await import('#services/cache_service')
      const DatabaseManagerService = (await import('#services/database_manager_service')).default
      const data: any = request.only([
        'codigoIbge', 'nome', 'uf', 'slug', 'logoUrl', 'corPrimaria', 'corSecundaria', 'status',
      ])
      const normalizeSchema = (s: string) =>
        String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'tenant'
      data.dbSchema = normalizeSchema(data.slug || data.nome || '')
      if (!data.status) data.status = 'ATIVO'
      const municipio = await Municipio.create(data)
      try {
        const dbManager = new DatabaseManagerService()
        await dbManager.queryCentral(`CREATE SCHEMA IF NOT EXISTS "${data.dbSchema}"`)
      } catch (e) { console.warn('[Admin] Schema não criado:', e) }
      cacheService.clear()
      return response.created(municipio)
    } catch (e: any) { return response.badRequest({ error: e.message }) }
  })

  router.put('/api/admin/municipios/:id', async ({ params, request, response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      const { cacheService } = await import('#services/cache_service')
      const municipio = await Municipio.find(params.id)
      if (!municipio) return response.notFound({ error: 'Não encontrado' })
      const data: any = request.only([
        'codigoIbge', 'nome', 'uf', 'slug', 'logoUrl',
        'corPrimaria', 'corSecundaria', 'status', 'modoManutencao', 'mensagemManutencao',
      ])
      if (!data.dbPassword) delete data.dbPassword
      municipio.merge(data)
      await municipio.save()
      cacheService.clearMunicipio(municipio.id)
      cacheService.clear()
      return response.json(municipio)
    } catch (e: any) { return response.badRequest({ error: e.message }) }
  })

  router.delete('/api/admin/municipios/:id', async ({ params, response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      const { cacheService } = await import('#services/cache_service')
      const municipio = await Municipio.find(params.id)
      if (!municipio) return response.notFound({ error: 'Não encontrado' })
      const municipioId = municipio.id
      await municipio.delete()
      cacheService.clearMunicipio(municipioId)
      cacheService.clear()
      return response.json({ success: true })
    } catch (e: any) { return response.badRequest({ error: e.message }) }
  })

  // API — Usuários Master
  router.get('/api/admin/usuarios-master', async ({ response }) => {
    try {
      const UsuarioMaster = (await import('#models/usuario_master')).default
      return response.json({ data: await UsuarioMaster.query().orderBy('nome') })
    } catch { return response.json({ data: [] }) }
  })

  // API — Estatísticas
  router.get('/api/admin/estatisticas', async ({ response }) => {
    try {
      const Municipio = (await import('#models/municipio')).default
      const [total, ativos] = await Promise.all([
        Municipio.query().count('* as total'),
        Municipio.query().where('status', 'ATIVO').count('* as total'),
      ])
      return response.json({
        totalMunicipios:  Number(total[0].$extras.total),
        municipiosAtivos: Number(ativos[0].$extras.total),
      })
    } catch { return response.json({ totalMunicipios: 0, municipiosAtivos: 0 }) }
  })
}).use([middleware.auth(), middleware.requireSuperAdmin()])

/*
|--------------------------------------------------------------------------
| VotaLegis — Painel TV (público)
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/:slug',        [VotaPainelCtrl, 'show']).as('votacao.painel.show')
  router.get('/:slug/events', [VotaPainelCtrl, 'events']).as('votacao.painel.events')
}).prefix('/painel')

/*
|--------------------------------------------------------------------------
| VotaLegis — App Vereador / Presidente
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/',                [VotaAppCtrl, 'index']).as('votacao.app.index')
  router.get('/ordens',          [VotaAppCtrl, 'ordens']).as('votacao.app.ordens')
  router.get('/perfil',          [VotaAppCtrl, 'perfil']).as('votacao.app.perfil')
  router.put('/perfil',          [VotaAppCtrl, 'updatePerfil']).as('votacao.app.perfil.update')
  router.put('/perfil/senha',    [VotaAppCtrl, 'updateSenha']).as('votacao.app.perfil.senha')
  router.get('/events',          [VotaAppCtrl, 'events']).as('votacao.app.events')
  router.post('/quorum/abrir',   [VotaAppCtrl, 'abrirQuorum']).as('votacao.app.quorum.abrir')
  router.post('/quorum/encerrar',[VotaAppCtrl, 'encerrarQuorum']).as('votacao.app.quorum.encerrar')
  router.post('/quorum/presenca',[VotaAppCtrl, 'confirmarPresenca']).as('votacao.app.presenca')
  router.post('/votar',          [VotaAppCtrl, 'votar']).as('votacao.app.votar')
  router.post('/voz/pedir',      [VotaAppCtrl, 'pedirVoz']).as('votacao.app.voz.pedir')
  router.post('/voz/cancelar',   [VotaAppCtrl, 'cancelarVoz']).as('votacao.app.voz.cancelar')
}).prefix('/app/votacao').use(middleware.auth())

/*
|--------------------------------------------------------------------------
| VotaLegis — Controle (Secretaria)
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/',                              [VotaControleCtrl, 'index']).as('votacao.controle.index')
  router.get('/events/:sessaoId',              [VotaControleCtrl, 'events']).as('votacao.controle.events')
  router.get('/sessoes',                       [VotaControleCtrl, 'sessoes']).as('votacao.controle.sessoes')
  router.post('/sessoes',                      [VotaControleCtrl, 'storeSessao']).as('votacao.controle.sessoes.store')
  router.get('/sessoes/:id',                   [VotaControleCtrl, 'showSessao']).as('votacao.controle.sessoes.show')
  router.put('/sessoes/:id',                   [VotaControleCtrl, 'updateSessao']).as('votacao.controle.sessoes.update')
  router.delete('/sessoes/:id',                [VotaControleCtrl, 'destroySessao']).as('votacao.controle.sessoes.destroy')
  router.post('/sessoes/:id/iniciar',          [VotaControleCtrl, 'iniciarSessao']).as('votacao.controle.sessoes.iniciar')
  router.post('/sessoes/:id/encerrar',         [VotaControleCtrl, 'encerrarSessao']).as('votacao.controle.sessoes.encerrar')
  router.post('/sessoes/:id/suspender',        [VotaControleCtrl, 'suspenderSessao']).as('votacao.controle.sessoes.suspender')
  router.get('/materias',                      [VotaControleCtrl, 'materias']).as('votacao.controle.materias')
  router.post('/materias',                     [VotaControleCtrl, 'storemateria']).as('votacao.controle.materias.store')
  router.put('/materias/:id',                  [VotaControleCtrl, 'updateMateria']).as('votacao.controle.materias.update')
  router.delete('/materias/:id',               [VotaControleCtrl, 'destroyMateria']).as('votacao.controle.materias.destroy')
  router.post('/materias/:id/leitura/iniciar', [VotaControleCtrl, 'iniciarLeitura']).as('votacao.controle.materias.leitura.iniciar')
  router.post('/materias/:id/leitura/encerrar',[VotaControleCtrl, 'encerrarLeitura']).as('votacao.controle.materias.leitura.encerrar')
  router.post('/materias/:id/votacao/abrir',   [VotaControleCtrl, 'abrirVotacao']).as('votacao.controle.materias.votacao.abrir')
  router.post('/materias/:id/votacao/encerrar',[VotaControleCtrl, 'encerrarVotacao']).as('votacao.controle.materias.votacao.encerrar')
  router.post('/voz/:id/conceder',             [VotaControleCtrl, 'concederVoz']).as('votacao.controle.voz.conceder')
  router.post('/voz/:id/cancelar',             [VotaControleCtrl, 'cancelarVozControle']).as('votacao.controle.voz.cancelar')
  router.post('/voz/timer',                    [VotaControleCtrl, 'setTimer']).as('votacao.controle.voz.timer')
  router.get('/quorum',                        [VotaControleCtrl, 'quorum']).as('votacao.controle.quorum')
  router.post('/quorum/presenca',              [VotaControleCtrl, 'registrarPresenca']).as('votacao.controle.quorum.presenca')
  router.get('/vereadores',                    [VotaControleCtrl, 'vereadores']).as('votacao.controle.vereadores')
  router.post('/vereadores',                   [VotaControleCtrl, 'storeVereador']).as('votacao.controle.vereadores.store')
  router.put('/vereadores/:id',                [VotaControleCtrl, 'updateVereador']).as('votacao.controle.vereadores.update')
  router.delete('/vereadores/:id',             [VotaControleCtrl, 'destroyVereador']).as('votacao.controle.vereadores.destroy')
  router.get('/partidos',                      [VotaControleCtrl, 'partidos']).as('votacao.controle.partidos')
  router.post('/partidos',                     [VotaControleCtrl, 'storePartido']).as('votacao.controle.partidos.store')
  router.put('/partidos/:id',                  [VotaControleCtrl, 'updatePartido']).as('votacao.controle.partidos.update')
  router.delete('/partidos/:id',               [VotaControleCtrl, 'destroyPartido']).as('votacao.controle.partidos.destroy')
  router.get('/legislaturas',                  [VotaControleCtrl, 'legislaturas']).as('votacao.controle.legislaturas')
  router.post('/legislaturas',                 [VotaControleCtrl, 'storeLegislatura']).as('votacao.controle.legislaturas.store')
  router.put('/legislaturas/:id',              [VotaControleCtrl, 'updateLegislatura']).as('votacao.controle.legislaturas.update')
  router.get('/configuracoes',                 [VotaControleCtrl, 'configuracoes']).as('votacao.controle.configuracoes')
  router.put('/configuracoes',                 [VotaControleCtrl, 'updateConfiguracoes']).as('votacao.controle.configuracoes.update')
  router.put('/configuracoes/tema',            [VotaControleCtrl, 'updateTema']).as('votacao.controle.configuracoes.tema')
  router.get('/relatorios',                    [VotaControleCtrl, 'relatorios']).as('votacao.controle.relatorios')
  router.get('/relatorios/sessao/:id',         [VotaControleCtrl, 'relatorioSessao']).as('votacao.controle.relatorios.sessao')
  router.get('/relatorios/exportar/:id',       [VotaControleCtrl, 'exportarRelatorio']).as('votacao.controle.relatorios.exportar')
}).prefix('/controle/votacao').use(middleware.auth())

/*
|--------------------------------------------------------------------------
| VotaLegis — Admin (Super Admin)
|--------------------------------------------------------------------------
*/
router.group(() => {
  router.get('/',                        [VotaAdminCtrl, 'index']).as('votacao.admin.index')
  router.get('/camaras',                 [VotaAdminCtrl, 'camaras']).as('votacao.admin.camaras')
  router.post('/camaras',                [VotaAdminCtrl, 'storeCamara']).as('votacao.admin.camaras.store')
  router.get('/camaras/:id/editar',      [VotaAdminCtrl, 'editCamara']).as('votacao.admin.camaras.edit')
  router.put('/camaras/:id',             [VotaAdminCtrl, 'updateCamara']).as('votacao.admin.camaras.update')
  router.delete('/camaras/:id',          [VotaAdminCtrl, 'destroyCamara']).as('votacao.admin.camaras.destroy')
  router.post('/camaras/:id/suspender',  [VotaAdminCtrl, 'suspenderCamara']).as('votacao.admin.camaras.suspender')
  router.post('/camaras/:id/reativar',   [VotaAdminCtrl, 'reativarCamara']).as('votacao.admin.camaras.reativar')
  router.post('/camaras/:id/impersonar', [VotaAdminCtrl, 'impersonarCamara']).as('votacao.admin.camaras.impersonar')
  router.get('/planos',                  [VotaAdminCtrl, 'planos']).as('votacao.admin.planos')
  router.post('/planos',                 [VotaAdminCtrl, 'storePlano']).as('votacao.admin.planos.store')
  router.put('/planos/:id',              [VotaAdminCtrl, 'updatePlano']).as('votacao.admin.planos.update')
  router.delete('/planos/:id',           [VotaAdminCtrl, 'destroyPlano']).as('votacao.admin.planos.destroy')
  router.get('/usuarios',                [VotaAdminCtrl, 'usuarios']).as('votacao.admin.usuarios')
  router.post('/usuarios',               [VotaAdminCtrl, 'storeUsuario']).as('votacao.admin.usuarios.store')
  router.put('/usuarios/:id',            [VotaAdminCtrl, 'updateUsuario']).as('votacao.admin.usuarios.update')
  router.delete('/usuarios/:id',         [VotaAdminCtrl, 'destroyUsuario']).as('votacao.admin.usuarios.destroy')
  router.get('/logs',                    [VotaAdminCtrl, 'logs']).as('votacao.admin.logs')
  router.get('/configuracoes',           [VotaAdminCtrl, 'configuracoes']).as('votacao.admin.configuracoes')
  router.put('/configuracoes',           [VotaAdminCtrl, 'updateConfiguracoes']).as('votacao.admin.configuracoes.update')
}).prefix('/admin/votacao').use([middleware.auth(), middleware.requireSuperAdmin()])

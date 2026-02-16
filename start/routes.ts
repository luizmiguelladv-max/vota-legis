/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

// Controllers
const AuthController = () => import('#controllers/auth_controller')
const DashboardController = () => import('#controllers/dashboard_controller')
const MunicipiosController = () => import('#controllers/municipios_controller')
const VereadoresController = () => import('#controllers/vereadores_controller')
const PartidosController = () => import('#controllers/partidos_controller')
const LegislaturasController = () => import('#controllers/legislaturas_controller')
const SessoesController = () => import('#controllers/sessoes_controller')
const VotacoesController = () => import('#controllers/votacoes_controller')
const ControleController = () => import('#controllers/controle_controller')
const PainelController = () => import('#controllers/painel_controller')
const VereadorAppController = () => import('#controllers/vereador_app_controller')
const SSEController = () => import('#controllers/sse_controller')

// ============================================
// ROTAS PUBLICAS
// ============================================

// Health check
router.get('/health', async ({ response }) => {
  return response.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Landing page
router.get('/', async ({ view }) => {
  return view.render('pages/landing')
}).as('landing')

// Login
router.get('/login', [AuthController, 'showLogin']).as('login')
router.post('/login', [AuthController, 'login']).as('login.post')

// 2FA
router.get('/verificar-codigo', [AuthController, 'showVerificarCodigo']).as('verificar-codigo')
router.post('/verificar-codigo', [AuthController, 'verificarCodigo']).as('verificar-codigo.post')
router.post('/reenviar-codigo', [AuthController, 'reenviarCodigo']).as('reenviar-codigo')

// Painel Público (TV do plenário) - SEM AUTENTICAÇÃO
router.get('/painel/:codigo', [PainelController, 'publico']).as('painel.publico')
router.get('/painel/:codigo/quorum', [PainelController, 'quorum']).as('painel.quorum')
router.get('/painel/:codigo/timer', [PainelController, 'timer']).as('painel.timer')

// API do Painel Público
router.get('/api/painel/:codigo/estado', [PainelController, 'estado']).as('api.painel.estado')

// ============================================
// ROTAS AUTENTICADAS (sem municipio obrigatorio)
// ============================================
router.group(() => {
  router.get('/logout', [AuthController, 'logout']).as('logout')
  router.post('/logout', [AuthController, 'logout'])
  router.get('/selecionar-municipio', [AuthController, 'showSelecionarMunicipio']).as('selecionar-municipio')
  router.post('/selecionar-municipio', [AuthController, 'selecionarMunicipio']).as('selecionar-municipio.post')
  router.get('/trocar-municipio', [AuthController, 'trocarMunicipio']).as('trocar-municipio')
  router.get('/municipio-pendente', async ({ view }) => {
    return view.render('pages/municipio-pendente')
  }).as('municipio-pendente')
}).use(middleware.auth())

// ============================================
// ROTAS COM MUNICIPIO OBRIGATORIO
// ============================================
router.group(() => {
  // Dashboard
  router.get('/dashboard', [DashboardController, 'index']).as('dashboard')

  // Vereadores
  router.get('/vereadores', [VereadoresController, 'index']).as('vereadores.index')
  router.get('/vereadores/criar', [VereadoresController, 'create']).as('vereadores.create')
  router.post('/vereadores', [VereadoresController, 'store']).as('vereadores.store')
  router.get('/vereadores/:id', [VereadoresController, 'show']).as('vereadores.show')
  router.get('/vereadores/:id/editar', [VereadoresController, 'edit']).as('vereadores.edit')
  router.put('/vereadores/:id', [VereadoresController, 'update']).as('vereadores.update')
  router.delete('/vereadores/:id', [VereadoresController, 'destroy']).as('vereadores.destroy')

  // Partidos
  router.get('/partidos', [PartidosController, 'index']).as('partidos.index')
  router.get('/partidos/criar', [PartidosController, 'create']).as('partidos.create')
  router.post('/partidos', [PartidosController, 'store']).as('partidos.store')
  router.get('/partidos/:id', [PartidosController, 'show']).as('partidos.show')
  router.get('/partidos/:id/editar', [PartidosController, 'edit']).as('partidos.edit')
  router.put('/partidos/:id', [PartidosController, 'update']).as('partidos.update')
  router.delete('/partidos/:id', [PartidosController, 'destroy']).as('partidos.destroy')

  // Legislaturas
  router.get('/legislaturas', [LegislaturasController, 'index']).as('legislaturas.index')
  router.get('/legislaturas/criar', [LegislaturasController, 'create']).as('legislaturas.create')
  router.post('/legislaturas', [LegislaturasController, 'store']).as('legislaturas.store')
  router.get('/legislaturas/:id', [LegislaturasController, 'show']).as('legislaturas.show')
  router.get('/legislaturas/:id/editar', [LegislaturasController, 'edit']).as('legislaturas.edit')
  router.put('/legislaturas/:id', [LegislaturasController, 'update']).as('legislaturas.update')
  router.delete('/legislaturas/:id', [LegislaturasController, 'destroy']).as('legislaturas.destroy')
  router.post('/legislaturas/:id/definir-atual', [LegislaturasController, 'definirAtual']).as('legislaturas.definir-atual')

  // Sessoes
  router.get('/sessoes', [SessoesController, 'index']).as('sessoes.index')
  router.get('/sessoes/criar', [SessoesController, 'create']).as('sessoes.create')
  router.post('/sessoes', [SessoesController, 'store']).as('sessoes.store')
  router.get('/sessoes/:id', [SessoesController, 'show']).as('sessoes.show')
  router.get('/sessoes/:id/editar', [SessoesController, 'edit']).as('sessoes.edit')
  router.put('/sessoes/:id', [SessoesController, 'update']).as('sessoes.update')
  router.delete('/sessoes/:id', [SessoesController, 'destroy']).as('sessoes.destroy')
  router.post('/sessoes/:id/iniciar', [SessoesController, 'iniciar']).as('sessoes.iniciar')
  router.post('/sessoes/:id/encerrar', [SessoesController, 'encerrar']).as('sessoes.encerrar')
  router.post('/sessoes/:id/suspender', [SessoesController, 'suspender']).as('sessoes.suspender')
  router.post('/sessoes/:id/retomar', [SessoesController, 'retomar']).as('sessoes.retomar')
  router.post('/sessoes/:id/cancelar', [SessoesController, 'cancelar']).as('sessoes.cancelar')
  router.get('/sessoes/:id/presencas', [SessoesController, 'presencas']).as('sessoes.presencas')
  router.post('/sessoes/:id/presencas', [SessoesController, 'registrarPresenca']).as('sessoes.registrar-presenca')
  router.post('/sessoes/:id/presencas/remover', [SessoesController, 'removerPresenca']).as('sessoes.remover-presenca')

  // ============================================
  // MÓDULO DE CONTROLE (Operador da Sessão)
  // ============================================
  router.get('/controle/:id', [ControleController, 'sessao']).as('controle.sessao')
  router.post('/controle/:id/iniciar-sessao', [ControleController, 'iniciarSessao']).as('controle.iniciar-sessao')
  router.post('/controle/:id/encerrar-sessao', [ControleController, 'encerrarSessao']).as('controle.encerrar-sessao')
  router.post('/controle/:id/quorum/iniciar', [ControleController, 'iniciarQuorum']).as('controle.iniciar-quorum')
  router.post('/controle/:id/quorum/finalizar', [ControleController, 'finalizarQuorum']).as('controle.finalizar-quorum')
  router.post('/controle/:id/presenca/:vereadorId', [ControleController, 'registrarPresenca']).as('controle.registrar-presenca')
  router.post('/controle/:id/votacao/iniciar', [ControleController, 'iniciarVotacaoRapida']).as('controle.iniciar-votacao-rapida')
  router.post('/controle/:id/votacao/materia/:materiaId', [ControleController, 'iniciarVotacaoMateria']).as('controle.iniciar-votacao-materia')
  router.post('/controle/:id/votacao/encerrar', [ControleController, 'encerrarVotacao']).as('controle.encerrar-votacao')
  router.post('/controle/:id/fase', [ControleController, 'mudarFase']).as('controle.mudar-fase')

  // ============================================
  // MÓDULO DO VEREADOR (App Mobile)
  // ============================================
  router.get('/vereador', [VereadorAppController, 'index']).as('vereador.index')
  router.post('/vereador/presenca', [VereadorAppController, 'marcarPresenca']).as('vereador.marcar-presenca')
  router.post('/vereador/votar', [VereadorAppController, 'votar']).as('vereador.votar')
  router.post('/vereador/palavra', [VereadorAppController, 'pedirPalavra']).as('vereador.pedir-palavra')
  router.post('/vereador/palavra/:inscricaoId/cancelar', [VereadorAppController, 'cancelarPalavra']).as('vereador.cancelar-palavra')

  // ============================================
  // VOTAÇÕES
  // ============================================
  router.get('/sessoes/:sessaoId/votacoes', [VotacoesController, 'index']).as('votacoes.index')
  router.get('/sessoes/:sessaoId/votacoes/criar', [VotacoesController, 'create']).as('votacoes.create')
  router.post('/sessoes/:sessaoId/votacoes', [VotacoesController, 'store']).as('votacoes.store')
  router.get('/votacoes/:id', [VotacoesController, 'show']).as('votacoes.show')
  router.post('/sessoes/:sessaoId/votacoes/:id/encerrar', [VotacoesController, 'encerrar']).as('votacoes.encerrar')

  // Configuracoes
  router.get('/configuracoes/aparencia', async ({ view }) => {
    return view.render('pages/configuracoes/aparencia')
  }).as('configuracoes.aparencia')

  // Materias com IA
  const MateriasIAController = () => import('#controllers/materias_ia_controller')
  router.get('/materias/criar-ia', [MateriasIAController, 'criar']).as('materias.criar-ia')
  router.post('/materias/salvar-ia', [MateriasIAController, 'salvar']).as('materias.salvar-ia')
  router.get('/materias/historico-ia', [MateriasIAController, 'historico']).as('materias.historico-ia')
  router.get('/sessoes/:sessaoId/gerar-ata', [MateriasIAController, 'gerarAta']).as('sessoes.gerar-ata')

}).use([middleware.auth(), middleware.requireMunicipio()])

// ============================================
// ROTAS DE ADMIN (Super Admin apenas)
// ============================================
router.group(() => {
  router.get('/municipios', [MunicipiosController, 'index']).as('admin.municipios.index')
  router.get('/municipios/criar', [MunicipiosController, 'create']).as('admin.municipios.create')
  router.post('/municipios', [MunicipiosController, 'store']).as('admin.municipios.store')
  router.get('/municipios/:id', [MunicipiosController, 'show']).as('admin.municipios.show')
  router.get('/municipios/:id/editar', [MunicipiosController, 'edit']).as('admin.municipios.edit')
  router.put('/municipios/:id', [MunicipiosController, 'update']).as('admin.municipios.update')
  router.post('/municipios/:id/criar-banco', [MunicipiosController, 'criarBanco']).as('admin.municipios.criar-banco')

  router.get('/usuarios', async ({ view }) => {
    return view.render('pages/admin/usuarios-master', { usuarios: [] })
  }).as('admin.usuarios.index')

  router.get('/auditoria', async ({ view }) => {
    return view.render('pages/admin/auditoria', { logs: [], usuarios: [] })
  }).as('admin.auditoria')

  router.get('/monitoramento', async ({ view }) => {
    return view.render('pages/admin/monitoramento', { camaras: [], totalCamaras: 0, usuariosAtivos: 0 })
  }).as('admin.monitoramento')

  router.get('/backups', async ({ view }) => {
    return view.render('pages/admin/backups', { backups: [], totalBackups: 0, ultimoBackup: null, espacoUsado: '0 MB' })
  }).as('admin.backups')

}).prefix('/admin').use([middleware.auth(), middleware.requireSuperAdmin()])

// ============================================
// API ROUTES
// ============================================
router.group(() => {
  // Health check
  router.get('/health', async ({ response }) => {
    return response.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // SSE - Server-Sent Events (tempo real)
  router.get('/sse/sessao/:sessaoId', [SSEController, 'sessao']).use(middleware.auth())
  router.get('/sse/controle/:sessaoId', [SSEController, 'controle']).use(middleware.auth())
  router.get('/sse/presidente/:sessaoId', [SSEController, 'presidente']).use(middleware.auth())
  router.get('/sse/painel/:codigo/:sessaoId', [SSEController, 'painel']) // Público
  router.get('/sse/stats', [SSEController, 'stats']).use(middleware.auth())

  // API autenticada
  router.group(() => {
    // Municipios
    router.get('/municipios', [MunicipiosController, 'list'])

    // Vereadores
    router.get('/vereadores', [VereadoresController, 'list'])
    router.get('/vereadores/presentes', [VereadoresController, 'presentes'])

    // Partidos
    router.get('/partidos', [PartidosController, 'list'])

    // Legislaturas
    router.get('/legislaturas', [LegislaturasController, 'list'])

    // Sessoes
    router.get('/sessoes', [SessoesController, 'list'])
    router.get('/sessoes/atual', [SessoesController, 'atual'])

    // Votações
    router.get('/sessoes/:sessaoId/votacao/atual', [VotacoesController, 'emAndamento'])
    router.get('/votacoes/:id/estado', [VotacoesController, 'estado'])
    router.post('/votacoes/:id/votar', [VotacoesController, 'registrarVoto'])

    // Vereador App API
    router.get('/vereador/estado', [VereadorAppController, 'estado'])
    router.post('/vereador/votar', [VereadorAppController, 'votarApi'])

    // Matérias com IA API
    const MateriasIAController = () => import('#controllers/materias_ia_controller')
    router.post('/materias/gerar', [MateriasIAController, 'gerar'])
    router.post('/materias/melhorar', [MateriasIAController, 'melhorar'])
    router.post('/materias/sugerir-ementa', [MateriasIAController, 'sugerirEmenta'])

  }).use(middleware.auth())

}).prefix('/api')

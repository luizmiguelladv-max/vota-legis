import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class AdminVotaController {
  async index({ view }: HttpContext) {
    const totalCamaras    = await db.from('public.municipios').count('* as total').first()
    const totalVereadores = 0 // agregado via tenant schemas

    return view.render('pages/votacao/admin', {
      totalCamaras: (totalCamaras as any)?.total || 0,
      secao: 'dashboard',
    })
  }

  // ── CÂMARAS ──────────────────────────────────────────────

  async camaras({ view }: HttpContext) {
    const camaras = await db.from('public.municipios').orderBy('nome', 'asc')
    return view.render('pages/votacao/admin', { camaras, secao: 'camaras' })
  }

  async storeCamara({ request, response }: HttpContext) {
    const dados = request.only(['nome','uf','slug','plano_id','max_vereadores','cor_primaria'])

    // Cria o município
    const [municipio] = await db.table('public.municipios').insert(dados).returning('*')

    // Cria o schema da câmara e tabelas base via migration SQL
    const schema = `camara_${municipio.id}`
    await db.rawQuery(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)

    // Executa o seed de tabelas do schema
    const { default: fs } = await import('node:fs/promises')
    const { default: app } = await import('@adonisjs/core/services/app')
    const sql = await fs.readFile(app.makePath('database/migrations/tenant/schema_camara.sql'), 'utf-8')
    const sqlComSchema = sql.replace(/\{\{schema\}\}/g, schema)
    await db.rawQuery(sqlComSchema)

    return response.json({ success: true, id: municipio.id })
  }

  async editCamara({ params, view }: HttpContext) {
    const camara = await db.from('public.municipios').where('id', params.id).first()
    return view.render('pages/votacao/admin', { camara, secao: 'camaras' })
  }

  async updateCamara({ params, request, response }: HttpContext) {
    const dados = request.only(['nome','uf','slug','plano_id','max_vereadores','status'])
    await db.from('public.municipios').where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroyCamara({ params, response }: HttpContext) {
    await db.from('public.municipios').where('id', params.id).update({ ativo: false })
    return response.json({ success: true })
  }

  async suspenderCamara({ params, response }: HttpContext) {
    await db.from('public.municipios').where('id', params.id).update({ status: 'suspensa' })
    return response.json({ success: true })
  }

  async reativarCamara({ params, response }: HttpContext) {
    await db.from('public.municipios').where('id', params.id).update({ status: 'ativa' })
    return response.json({ success: true })
  }

  async impersonarCamara({ params, session, response }: HttpContext) {
    // Define municipio_id na session para impersonar admin da câmara
    session.put('municipio_id', params.id)
    session.put('impersonando', true)
    return response.redirect('/controle/votacao')
  }

  // ── PLANOS ───────────────────────────────────────────────

  async planos({ view }: HttpContext) {
    const planos = await db.from('public.planos_votacao').orderBy('preco', 'asc')
    return view.render('pages/votacao/admin', { planos, secao: 'planos' })
  }

  async storePlano({ request, response }: HttpContext) {
    const dados = request.only(['nome','preco','max_vereadores','recursos'])
    const [id] = await db.table('public.planos_votacao').insert(dados).returning('id')
    return response.json({ success: true, id })
  }

  async updatePlano({ params, request, response }: HttpContext) {
    const dados = request.only(['nome','preco','max_vereadores','recursos'])
    await db.from('public.planos_votacao').where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroyPlano({ params, response }: HttpContext) {
    await db.from('public.planos_votacao').where('id', params.id).delete()
    return response.json({ success: true })
  }

  // ── USUÁRIOS MASTER ──────────────────────────────────────

  async usuarios({ view }: HttpContext) {
    const usuarios = await db.from('public.usuarios_master').orderBy('nome', 'asc')
    return view.render('pages/votacao/admin', { usuarios, secao: 'usuarios' })
  }

  async storeUsuario({ request, response }: HttpContext) {
    const dados = request.only(['nome','login','email','municipio_id','perfil'])
    const hash = await import('@adonisjs/core/services/hash')
    const senha = await hash.default.make(request.input('senha'))
    const [id] = await db.table('public.usuarios_master').insert({ ...dados, senha, ativo: true }).returning('id')
    return response.json({ success: true, id })
  }

  async updateUsuario({ params, request, response }: HttpContext) {
    const dados = request.only(['nome','email','municipio_id','perfil','ativo'])
    await db.from('public.usuarios_master').where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroyUsuario({ params, response }: HttpContext) {
    await db.from('public.usuarios_master').where('id', params.id).update({ ativo: false })
    return response.json({ success: true })
  }

  // ── LOGS ─────────────────────────────────────────────────

  async logs({ view }: HttpContext) {
    const logs = await db
      .from('public.logs_operacoes')
      .orderBy('created_at', 'desc')
      .limit(200)
    return view.render('pages/votacao/admin', { logs, secao: 'logs' })
  }

  // ── CONFIGS ──────────────────────────────────────────────

  async configuracoes({ view }: HttpContext) {
    const conf = await db.from('public.configuracoes_globais').first()
    return view.render('pages/votacao/admin', { configuracoes: conf, secao: 'configuracoes' })
  }

  async updateConfiguracoes({ request, response }: HttpContext) {
    const dados = request.only(['smtp_host','smtp_porta','smtp_usuario','smtp_senha','sms_provider','sms_api_key'])
    await db.from('public.configuracoes_globais').update(dados)
    return response.json({ success: true })
  }
}

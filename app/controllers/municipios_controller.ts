import type { HttpContext } from '@adonisjs/core/http'
import Municipio from '#models/municipio'
import TenantSchemaService from '#services/tenant_schema_service'

export default class MunicipiosController {
  /**
   * Exibe a lista de municípios (câmaras)
   */
  async index({ view }: HttpContext) {
    const municipios = await Municipio.query().orderBy('nome', 'asc')
    return view.render('pages/admin/municipios/index', { municipios })
  }

  /**
   * API: Lista municípios
   */
  async list({ response }: HttpContext) {
    const municipios = await Municipio.query().orderBy('nome', 'asc')
    return response.json({ success: true, data: municipios })
  }

  /**
   * Exibe formulário de criação
   */
  async create({ view }: HttpContext) {
    return view.render('pages/admin/municipios/create')
  }

  /**
   * Processa a criação do município
   */
  async store({ request, response, session }: HttpContext) {
    const data = request.only([
      'nome',
      'uf',
      'codigo_ibge',
      'cnpj',
      'endereco',
      'telefone',
      'email',
      'site',
      'cep',
      'populacao',
      'total_vereadores',
      'cor_primaria',
      'cor_secundaria',
      'observacoes',
    ])

    try {
      // Gera o slug
      const slug = this.generateSlug(data.nome)

      // Verifica se já existe
      const exists = await Municipio.query().where('slug', slug).first()
      if (exists) {
        session.flash('error', 'Ja existe uma camara com este nome')
        return response.redirect().back()
      }

      // Cria o município
      const municipio = await Municipio.create({
        nome: data.nome,
        slug: slug,
        uf: data.uf?.toUpperCase(),
        codigoIbge: data.codigo_ibge,
        cnpj: data.cnpj?.replace(/\D/g, ''),
        endereco: data.endereco,
        telefone: data.telefone,
        email: data.email,
        site: data.site,
        cep: data.cep?.replace(/\D/g, ''),
        populacao: data.populacao ? parseInt(data.populacao) : null,
        totalVereadores: data.total_vereadores ? parseInt(data.total_vereadores) : 9,
        corPrimaria: data.cor_primaria || '#1a365d',
        corSecundaria: data.cor_secundaria || '#2c5282',
        observacoes: data.observacoes,
        ativo: true,
        status: true,
        bancoCriado: false,
      })

      // Cria o schema do banco de dados
      try {
        await TenantSchemaService.createSchema(municipio.id)
        session.flash('success', `Camara ${municipio.nome} criada com sucesso!`)
      } catch (error) {
        console.error('Erro ao criar schema:', error)
        session.flash('warning', `Camara criada, mas o banco de dados precisa ser configurado manualmente.`)
      }

      return response.redirect().toRoute('admin.municipios.index')
    } catch (error) {
      console.error('Erro ao criar municipio:', error)
      session.flash('error', 'Erro ao criar camara. Tente novamente.')
      return response.redirect().back()
    }
  }

  /**
   * Exibe detalhes do município
   */
  async show({ params, view }: HttpContext) {
    const municipio = await Municipio.findOrFail(params.id)
    return view.render('pages/admin/municipios/show', { municipio })
  }

  /**
   * Exibe formulário de edição
   */
  async edit({ params, view }: HttpContext) {
    const municipio = await Municipio.findOrFail(params.id)
    return view.render('pages/admin/municipios/edit', { municipio })
  }

  /**
   * Processa a atualização
   */
  async update({ params, request, response, session }: HttpContext) {
    const municipio = await Municipio.findOrFail(params.id)

    const data = request.only([
      'nome',
      'uf',
      'codigo_ibge',
      'cnpj',
      'endereco',
      'telefone',
      'email',
      'site',
      'cep',
      'populacao',
      'total_vereadores',
      'cor_primaria',
      'cor_secundaria',
      'observacoes',
      'ativo',
    ])

    try {
      municipio.merge({
        nome: data.nome,
        uf: data.uf?.toUpperCase(),
        codigoIbge: data.codigo_ibge,
        cnpj: data.cnpj?.replace(/\D/g, ''),
        endereco: data.endereco,
        telefone: data.telefone,
        email: data.email,
        site: data.site,
        cep: data.cep?.replace(/\D/g, ''),
        populacao: data.populacao ? parseInt(data.populacao) : null,
        totalVereadores: data.total_vereadores ? parseInt(data.total_vereadores) : 9,
        corPrimaria: data.cor_primaria || '#1a365d',
        corSecundaria: data.cor_secundaria || '#2c5282',
        observacoes: data.observacoes,
        ativo: data.ativo === 'true' || data.ativo === true,
      })

      await municipio.save()

      session.flash('success', 'Camara atualizada com sucesso!')
      return response.redirect().toRoute('admin.municipios.index')
    } catch (error) {
      console.error('Erro ao atualizar municipio:', error)
      session.flash('error', 'Erro ao atualizar camara. Tente novamente.')
      return response.redirect().back()
    }
  }

  /**
   * Cria o banco de dados (schema) para o município
   */
  async criarBanco({ params, response, session }: HttpContext) {
    const municipio = await Municipio.findOrFail(params.id)

    if (municipio.bancoCriado) {
      session.flash('warning', 'O banco de dados ja foi criado para esta camara')
      return response.redirect().back()
    }

    try {
      await TenantSchemaService.createSchema(municipio.id)
      session.flash('success', 'Banco de dados criado com sucesso!')
    } catch (error) {
      console.error('Erro ao criar banco:', error)
      session.flash('error', 'Erro ao criar banco de dados. Verifique a conexao.')
    }

    return response.redirect().back()
  }

  /**
   * Gera slug a partir do nome
   */
  private generateSlug(nome: string): string {
    return nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }
}

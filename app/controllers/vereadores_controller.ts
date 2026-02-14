import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class VereadoresController {
  /**
   * Lista todos os vereadores
   */
  async index({ view, tenant }: HttpContext) {
    const schemaName = tenant.schemaName
    let vereadores: any[] = []
    let partidos: any[] = []
    let legislaturas: any[] = []

    if (schemaName) {
      try {
        // Busca vereadores com partido e legislatura
        const result = await db.rawQuery(`
          SELECT
            v.*,
            p.sigla as partido_sigla,
            p.nome as partido_nome,
            l.numero as legislatura_numero
          FROM "${schemaName}".vereadores v
          LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
          LEFT JOIN "${schemaName}".legislaturas l ON v.legislatura_id = l.id
          ORDER BY v.nome ASC
        `)
        vereadores = result.rows

        // Busca partidos para filtro
        const partidosResult = await db.rawQuery(`
          SELECT * FROM "${schemaName}".partidos WHERE ativo = true ORDER BY sigla
        `)
        partidos = partidosResult.rows

        // Busca legislaturas
        const legislaturasResult = await db.rawQuery(`
          SELECT * FROM "${schemaName}".legislaturas WHERE ativo = true ORDER BY numero DESC
        `)
        legislaturas = legislaturasResult.rows
      } catch (error) {
        console.error('Erro ao buscar vereadores:', error)
      }
    }

    return view.render('pages/vereadores/index', { vereadores, partidos, legislaturas })
  }

  /**
   * Exibe formulario de criacao
   */
  async create({ view, tenant }: HttpContext) {
    const schemaName = tenant.schemaName
    let partidos: any[] = []
    let legislaturas: any[] = []

    if (schemaName) {
      try {
        const partidosResult = await db.rawQuery(`
          SELECT * FROM "${schemaName}".partidos WHERE ativo = true ORDER BY sigla
        `)
        partidos = partidosResult.rows

        const legislaturasResult = await db.rawQuery(`
          SELECT * FROM "${schemaName}".legislaturas WHERE ativo = true ORDER BY numero DESC
        `)
        legislaturas = legislaturasResult.rows
      } catch (error) {
        console.error('Erro ao buscar dados:', error)
      }
    }

    return view.render('pages/vereadores/create', { partidos, legislaturas })
  }

  /**
   * Salva novo vereador
   */
  async store({ request, response, session, tenant }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      session.flash('error', 'Schema nao configurado')
      return response.redirect().back()
    }

    const data = request.only([
      'nome',
      'nome_parlamentar',
      'cpf',
      'email',
      'telefone',
      'celular',
      'data_nascimento',
      'naturalidade',
      'partido_id',
      'legislatura_id',
      'cargo',
      'numero_cadeira',
      'status',
      'data_posse',
    ])

    try {
      await db.rawQuery(`
        INSERT INTO "${schemaName}".vereadores (
          nome, nome_parlamentar, cpf, email, telefone, celular,
          data_nascimento, naturalidade, partido_id, legislatura_id,
          cargo, numero_cadeira, status, data_posse, ativo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW())
      `, [
        data.nome,
        data.nome_parlamentar || null,
        data.cpf?.replace(/\D/g, '') || null,
        data.email || null,
        data.telefone || null,
        data.celular || null,
        data.data_nascimento || null,
        data.naturalidade || null,
        data.partido_id || null,
        data.legislatura_id || null,
        data.cargo || 'vereador',
        data.numero_cadeira || null,
        data.status || 'ativo',
        data.data_posse || null,
      ])

      session.flash('success', 'Vereador cadastrado com sucesso!')
      return response.redirect().toRoute('vereadores.index')
    } catch (error) {
      console.error('Erro ao salvar vereador:', error)
      session.flash('error', 'Erro ao cadastrar vereador. Tente novamente.')
      return response.redirect().back()
    }
  }

  /**
   * Exibe detalhes do vereador
   */
  async show({ params, view, tenant, session, response }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      session.flash('error', 'Schema nao configurado')
      return response.redirect().toRoute('vereadores.index')
    }

    try {
      const result = await db.rawQuery(`
        SELECT
          v.*,
          p.sigla as partido_sigla,
          p.nome as partido_nome,
          p.cor as partido_cor,
          l.numero as legislatura_numero,
          l.descricao as legislatura_descricao
        FROM "${schemaName}".vereadores v
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        LEFT JOIN "${schemaName}".legislaturas l ON v.legislatura_id = l.id
        WHERE v.id = ?
      `, [params.id])

      if (result.rows.length === 0) {
        session.flash('error', 'Vereador nao encontrado')
        return response.redirect().toRoute('vereadores.index')
      }

      const vereador = result.rows[0]

      // Busca historico de mandatos
      const mandatosResult = await db.rawQuery(`
        SELECT
          m.*,
          p.sigla as partido_sigla,
          l.numero as legislatura_numero
        FROM "${schemaName}".vereador_mandatos m
        LEFT JOIN "${schemaName}".partidos p ON m.partido_id = p.id
        LEFT JOIN "${schemaName}".legislaturas l ON m.legislatura_id = l.id
        WHERE m.vereador_id = ?
        ORDER BY m.data_inicio DESC
      `, [params.id])
      const mandatos = mandatosResult.rows

      // Busca faces cadastradas
      const facesResult = await db.rawQuery(`
        SELECT * FROM "${schemaName}".vereador_faces
        WHERE vereador_id = ? AND ativo = true
        ORDER BY created_at DESC
      `, [params.id])
      const faces = facesResult.rows

      return view.render('pages/vereadores/show', { vereador, mandatos, faces })
    } catch (error) {
      console.error('Erro ao buscar vereador:', error)
      session.flash('error', 'Erro ao carregar vereador')
      return response.redirect().toRoute('vereadores.index')
    }
  }

  /**
   * Exibe formulario de edicao
   */
  async edit({ params, view, tenant, session, response }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      session.flash('error', 'Schema nao configurado')
      return response.redirect().toRoute('vereadores.index')
    }

    try {
      const result = await db.rawQuery(`
        SELECT * FROM "${schemaName}".vereadores WHERE id = ?
      `, [params.id])

      if (result.rows.length === 0) {
        session.flash('error', 'Vereador nao encontrado')
        return response.redirect().toRoute('vereadores.index')
      }

      const vereador = result.rows[0]

      // Busca partidos e legislaturas
      const partidosResult = await db.rawQuery(`
        SELECT * FROM "${schemaName}".partidos WHERE ativo = true ORDER BY sigla
      `)
      const partidos = partidosResult.rows

      const legislaturasResult = await db.rawQuery(`
        SELECT * FROM "${schemaName}".legislaturas WHERE ativo = true ORDER BY numero DESC
      `)
      const legislaturas = legislaturasResult.rows

      return view.render('pages/vereadores/edit', { vereador, partidos, legislaturas })
    } catch (error) {
      console.error('Erro ao buscar vereador:', error)
      session.flash('error', 'Erro ao carregar vereador')
      return response.redirect().toRoute('vereadores.index')
    }
  }

  /**
   * Atualiza vereador
   */
  async update({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      session.flash('error', 'Schema nao configurado')
      return response.redirect().back()
    }

    const data = request.only([
      'nome',
      'nome_parlamentar',
      'cpf',
      'email',
      'telefone',
      'celular',
      'data_nascimento',
      'naturalidade',
      'partido_id',
      'legislatura_id',
      'cargo',
      'numero_cadeira',
      'status',
      'data_posse',
      'data_saida',
      'motivo_saida',
      'ativo',
    ])

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".vereadores SET
          nome = ?,
          nome_parlamentar = ?,
          cpf = ?,
          email = ?,
          telefone = ?,
          celular = ?,
          data_nascimento = ?,
          naturalidade = ?,
          partido_id = ?,
          legislatura_id = ?,
          cargo = ?,
          numero_cadeira = ?,
          status = ?,
          data_posse = ?,
          data_saida = ?,
          motivo_saida = ?,
          ativo = ?,
          updated_at = NOW()
        WHERE id = ?
      `, [
        data.nome,
        data.nome_parlamentar || null,
        data.cpf?.replace(/\D/g, '') || null,
        data.email || null,
        data.telefone || null,
        data.celular || null,
        data.data_nascimento || null,
        data.naturalidade || null,
        data.partido_id || null,
        data.legislatura_id || null,
        data.cargo || 'vereador',
        data.numero_cadeira || null,
        data.status || 'ativo',
        data.data_posse || null,
        data.data_saida || null,
        data.motivo_saida || null,
        data.ativo === 'true' || data.ativo === true,
        params.id,
      ])

      session.flash('success', 'Vereador atualizado com sucesso!')
      return response.redirect().toRoute('vereadores.index')
    } catch (error) {
      console.error('Erro ao atualizar vereador:', error)
      session.flash('error', 'Erro ao atualizar vereador. Tente novamente.')
      return response.redirect().back()
    }
  }

  /**
   * Remove vereador (soft delete)
   */
  async destroy({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      session.flash('error', 'Schema nao configurado')
      return response.redirect().back()
    }

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".vereadores SET ativo = false, updated_at = NOW() WHERE id = ?
      `, [params.id])

      session.flash('success', 'Vereador removido com sucesso!')
    } catch (error) {
      console.error('Erro ao remover vereador:', error)
      session.flash('error', 'Erro ao remover vereador')
    }

    return response.redirect().toRoute('vereadores.index')
  }

  /**
   * API: Lista vereadores
   */
  async list({ response, tenant }: HttpContext) {
    const schemaName = tenant.schemaName

    if (!schemaName) {
      return response.badRequest({ success: false, error: 'Schema nao configurado' })
    }

    try {
      const result = await db.rawQuery(`
        SELECT
          v.id, v.nome, v.nome_parlamentar, v.foto_url, v.cargo, v.status,
          p.sigla as partido_sigla
        FROM "${schemaName}".vereadores v
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        WHERE v.ativo = true
        ORDER BY v.nome ASC
      `)

      return response.json({ success: true, data: result.rows })
    } catch (error) {
      console.error('Erro ao listar vereadores:', error)
      return response.internalServerError({ success: false, error: 'Erro ao buscar vereadores' })
    }
  }

  /**
   * API: Vereadores presentes (para votacao)
   */
  async presentes({ response, tenant, request }: HttpContext) {
    const schemaName = tenant.schemaName
    const sessaoId = request.input('sessao_id')

    if (!schemaName) {
      return response.badRequest({ success: false, error: 'Schema nao configurado' })
    }

    try {
      const result = await db.rawQuery(`
        SELECT
          v.id, v.nome, v.nome_parlamentar, v.foto_url,
          p.sigla as partido_sigla,
          sp.presente, sp.hora_entrada
        FROM "${schemaName}".vereadores v
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        LEFT JOIN "${schemaName}".sessao_presencas sp ON sp.vereador_id = v.id AND sp.sessao_id = ?
        WHERE v.ativo = true AND v.status = 'ativo'
        ORDER BY v.nome ASC
      `, [sessaoId])

      return response.json({ success: true, data: result.rows })
    } catch (error) {
      console.error('Erro ao listar presentes:', error)
      return response.internalServerError({ success: false, error: 'Erro ao buscar presentes' })
    }
  }
}

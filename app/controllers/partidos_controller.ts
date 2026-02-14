import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PartidosController {
  /**
   * Lista todos os partidos
   */
  async index({ view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT p.*,
        (SELECT COUNT(*) FROM "${schemaName}".vereadores v WHERE v.partido_id = p.id) as total_vereadores
      FROM "${schemaName}".partidos p
      ORDER BY p.sigla ASC
    `)

    return view.render('pages/partidos/index', {
      partidos: result.rows
    })
  }

  /**
   * Formulario de novo partido
   */
  async create({ view }: HttpContext) {
    return view.render('pages/partidos/create')
  }

  /**
   * Salva novo partido
   */
  async store({ request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only(['sigla', 'nome', 'numero', 'cor', 'ativo'])

    try {
      // Verifica se sigla já existe
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".partidos WHERE sigla = $1
      `, [data.sigla])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe um partido com esta sigla')
        return response.redirect().back()
      }

      await db.rawQuery(`
        INSERT INTO "${schemaName}".partidos (sigla, nome, numero, cor, ativo, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [
        data.sigla.toUpperCase(),
        data.nome,
        data.numero || null,
        data.cor || null,
        data.ativo !== 'false'
      ])

      session.flash('success', 'Partido cadastrado com sucesso')
      return response.redirect().toRoute('partidos.index')
    } catch (error) {
      console.error('Erro ao criar partido:', error)
      session.flash('error', 'Erro ao cadastrar partido')
      return response.redirect().back()
    }
  }

  /**
   * Exibe detalhes do partido
   */
  async show({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT * FROM "${schemaName}".partidos WHERE id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Partido não encontrado')
      return response.redirect().toRoute('partidos.index')
    }

    // Busca vereadores do partido
    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.status, v.cargo
      FROM "${schemaName}".vereadores v
      WHERE v.partido_id = $1
      ORDER BY v.nome ASC
    `, [params.id])

    return view.render('pages/partidos/show', {
      partido: result.rows[0],
      vereadores: vereadores.rows
    })
  }

  /**
   * Formulario de edicao
   */
  async edit({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT * FROM "${schemaName}".partidos WHERE id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Partido não encontrado')
      return response.redirect().toRoute('partidos.index')
    }

    return view.render('pages/partidos/edit', {
      partido: result.rows[0]
    })
  }

  /**
   * Atualiza partido
   */
  async update({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only(['sigla', 'nome', 'numero', 'cor', 'ativo'])

    try {
      // Verifica se sigla já existe em outro partido
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".partidos WHERE sigla = $1 AND id != $2
      `, [data.sigla, params.id])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe outro partido com esta sigla')
        return response.redirect().back()
      }

      await db.rawQuery(`
        UPDATE "${schemaName}".partidos
        SET sigla = $1, nome = $2, numero = $3, cor = $4, ativo = $5, updated_at = NOW()
        WHERE id = $6
      `, [
        data.sigla.toUpperCase(),
        data.nome,
        data.numero || null,
        data.cor || null,
        data.ativo !== 'false',
        params.id
      ])

      session.flash('success', 'Partido atualizado com sucesso')
      return response.redirect().toRoute('partidos.index')
    } catch (error) {
      console.error('Erro ao atualizar partido:', error)
      session.flash('error', 'Erro ao atualizar partido')
      return response.redirect().back()
    }
  }

  /**
   * Remove partido
   */
  async destroy({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      // Verifica se há vereadores vinculados
      const vereadores = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".vereadores WHERE partido_id = $1
      `, [params.id])

      if (parseInt(vereadores.rows[0].total) > 0) {
        session.flash('error', 'Não é possível excluir partido com vereadores vinculados')
        return response.redirect().toRoute('partidos.index')
      }

      await db.rawQuery(`
        DELETE FROM "${schemaName}".partidos WHERE id = $1
      `, [params.id])

      session.flash('success', 'Partido excluído com sucesso')
    } catch (error) {
      console.error('Erro ao excluir partido:', error)
      session.flash('error', 'Erro ao excluir partido')
    }

    return response.redirect().toRoute('partidos.index')
  }

  /**
   * API: Lista partidos (JSON)
   */
  async list({ response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT id, sigla, nome, numero, cor, ativo
      FROM "${schemaName}".partidos
      WHERE ativo = true
      ORDER BY sigla ASC
    `)

    return response.json(result.rows)
  }
}

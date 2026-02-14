import type { HttpContext } from '@adonisjs/core/http'
import UsuarioMaster from '#models/usuario_master'
import AuditService from '#services/audit_service'
import hash from '@adonisjs/core/services/hash'

export default class UsuariosMasterController {
  /**
   * Lista todos os usuários master
   */
  async listar({ response }: HttpContext) {
    try {
      const usuarios = await UsuarioMaster.query().orderBy('nome', 'asc')

      return response.json({
        data: usuarios.map((u) => ({
          id: u.id,
          login: u.login,
          email: u.email,
          nome: u.nome,
          ativo: u.ativo,
          telefone: u.telefone,
          doisFatoresAtivo: u.doisFatoresAtivo,
          ultimoAcesso: u.ultimoAcesso,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao listar usuários:', error)
      return response.internalServerError({
        error: 'Erro ao listar usuários',
        details: error.message,
      })
    }
  }

  /**
   * Obtém um usuário master específico
   */
  async obter({ params, response }: HttpContext) {
    try {
      const usuario = await UsuarioMaster.find(params.id)

      if (!usuario) {
        return response.notFound({ error: 'Usuário não encontrado' })
      }

      return response.json({
        id: usuario.id,
        login: usuario.login,
        email: usuario.email,
        nome: usuario.nome,
        ativo: usuario.ativo,
        telefone: usuario.telefone,
        doisFatoresAtivo: usuario.doisFatoresAtivo,
        ultimoAcesso: usuario.ultimoAcesso,
        createdAt: usuario.createdAt,
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao obter usuário:', error)
      return response.internalServerError({
        error: 'Erro ao obter usuário',
        details: error.message,
      })
    }
  }

  /**
   * Cria um novo usuário master
   */
  async criar({ request, response, tenant }: HttpContext) {
    const dados = request.only(['login', 'email', 'nome', 'senha'])

    try {
      // Valida campos obrigatórios
      if (!dados.login || !dados.email || !dados.nome || !dados.senha) {
        return response.badRequest({ error: 'Login, email, nome e senha são obrigatórios' })
      }

      // Verifica se login ou email já existem
      const existente = await UsuarioMaster.query()
        .where('login', dados.login)
        .orWhere('email', dados.email)
        .first()

      if (existente) {
        return response.badRequest({ error: 'Login ou email já cadastrado' })
      }

      const usuario = await UsuarioMaster.create({
        login: dados.login,
        email: dados.email,
        nome: dados.nome,
        senha: dados.senha, // Será hasheado pelo hook do model
        ativo: true,
      })

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'CREATE',
          tabela: 'usuarios_master',
          registroId: usuario.id,
          dadosNovos: { login: usuario.login, email: usuario.email, nome: usuario.nome },
        }
      )

      return response.created({
        success: true,
        message: 'Usuário criado com sucesso',
        usuario: {
          id: usuario.id,
          login: usuario.login,
          email: usuario.email,
          nome: usuario.nome,
        },
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao criar usuário:', error)
      return response.internalServerError({
        error: 'Erro ao criar usuário',
        details: error.message,
      })
    }
  }

  /**
   * Atualiza um usuário master
   */
  async atualizar({ params, request, response, tenant }: HttpContext) {
    const dados = request.only(['login', 'email', 'nome', 'senha', 'ativo', 'telefone', 'doisFatoresAtivo'])

    try {
      const usuario = await UsuarioMaster.find(params.id)

      if (!usuario) {
        return response.notFound({ error: 'Usuário não encontrado' })
      }

      const dadosAnteriores = {
        login: usuario.login,
        email: usuario.email,
        nome: usuario.nome,
        ativo: usuario.ativo,
      }

      // Verifica se login ou email já existem em outro usuário
      if (dados.login || dados.email) {
        const existente = await UsuarioMaster.query()
          .where((query) => {
            if (dados.login) query.where('login', dados.login)
            if (dados.email) query.orWhere('email', dados.email)
          })
          .whereNot('id', params.id)
          .first()

        if (existente) {
          return response.badRequest({ error: 'Login ou email já cadastrado' })
        }
      }

      // Atualiza campos
      if (dados.login) usuario.login = dados.login
      if (dados.email) usuario.email = dados.email
      if (dados.nome) usuario.nome = dados.nome
      if (dados.ativo !== undefined) usuario.ativo = dados.ativo
      if (dados.telefone !== undefined) usuario.telefone = dados.telefone || null
      if (dados.doisFatoresAtivo !== undefined) usuario.doisFatoresAtivo = dados.doisFatoresAtivo

      // Se enviou nova senha, atualiza
      if (dados.senha) {
        usuario.senha = dados.senha // Hook do model fará o hash
      }

      await usuario.save()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'UPDATE',
          tabela: 'usuarios_master',
          registroId: usuario.id,
          dadosAnteriores,
          dadosNovos: {
            login: usuario.login,
            email: usuario.email,
            nome: usuario.nome,
            ativo: usuario.ativo,
          },
        }
      )

      return response.json({
        success: true,
        message: 'Usuário atualizado com sucesso',
        usuario: {
          id: usuario.id,
          login: usuario.login,
          email: usuario.email,
          nome: usuario.nome,
          ativo: usuario.ativo,
          telefone: usuario.telefone,
          doisFatoresAtivo: usuario.doisFatoresAtivo,
        },
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao atualizar usuário:', error)
      return response.internalServerError({
        error: 'Erro ao atualizar usuário',
        details: error.message,
      })
    }
  }

  /**
   * Exclui um usuário master
   */
  async excluir({ params, request, response, tenant, auth }: HttpContext) {
    try {
      const usuario = await UsuarioMaster.find(params.id)

      if (!usuario) {
        return response.notFound({ error: 'Usuário não encontrado' })
      }

      // Não permite excluir o próprio usuário
      if (auth.user?.id === usuario.id) {
        return response.badRequest({ error: 'Não é possível excluir o próprio usuário' })
      }

      const dadosAnteriores = {
        id: usuario.id,
        login: usuario.login,
        email: usuario.email,
        nome: usuario.nome,
      }

      await usuario.delete()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'DELETE',
          tabela: 'usuarios_master',
          registroId: params.id,
          dadosAnteriores,
        }
      )

      return response.json({
        success: true,
        message: 'Usuário excluído com sucesso',
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao excluir usuário:', error)
      return response.internalServerError({
        error: 'Erro ao excluir usuário',
        details: error.message,
      })
    }
  }

  /**
   * Reseta a senha de um usuário
   */
  async resetarSenha({ params, request, response, tenant }: HttpContext) {
    const { novaSenha } = request.only(['novaSenha'])

    try {
      if (!novaSenha || novaSenha.length < 6) {
        return response.badRequest({ error: 'Nova senha deve ter no mínimo 6 caracteres' })
      }

      const usuario = await UsuarioMaster.find(params.id)

      if (!usuario) {
        return response.notFound({ error: 'Usuário não encontrado' })
      }

      usuario.senha = novaSenha // Hook do model fará o hash
      await usuario.save()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'UPDATE',
          tabela: 'usuarios_master',
          registroId: usuario.id,
          descricao: `Senha resetada para usuário ${usuario.login}`,
        }
      )

      return response.json({
        success: true,
        message: 'Senha resetada com sucesso',
      })
    } catch (error: any) {
      console.error('[UsuariosMasterController] Erro ao resetar senha:', error)
      return response.internalServerError({
        error: 'Erro ao resetar senha',
        details: error.message,
      })
    }
  }
}

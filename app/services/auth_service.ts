import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import env from '#start/env'
import { dbManager } from './database_manager_service.js'
import UsuarioMaster from '#models/usuario_master'
import type { Usuario } from '#models/tenant/types'

interface JwtPayload {
  id: number
  login: string
  nome: string
  email: string
  perfil: string
  funcionario_id?: number | null
  is_super_admin: boolean
  municipio_id?: number | null
  entidade_id?: number | null
  lotacoes_permitidas?: number[]
}

interface AuthResult {
  success: boolean
  user?: JwtPayload
  token?: string
  error?: string
}

/**
 * Serviço de Autenticação
 */
export default class AuthService {
  private static jwtSecret = env.get('JWT_SECRET') || env.get('APP_KEY')
  private static jwtExpiresIn = env.get('JWT_EXPIRES_IN') || '8h'

  private static getJwtSecret(): string {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET ou APP_KEY não configurado.')
    }
    return this.jwtSecret
  }

  /**
   * Autentica um usuário master (usando query direta)
   */
  static async authenticateMaster(login: string, senha: string): Promise<AuthResult> {
    try {
      // Usa query direta ao invés do Model
      const db = (await import('@adonisjs/lucid/services/db')).default
      const result = await db.rawQuery(
        'SELECT * FROM public.usuarios_master WHERE login = ? OR email = ?',
        [login, login]
      )

      const user = result.rows[0]

      if (!user) {
        return { success: false, error: 'Usuário não encontrado' }
      }

      if (!user.ativo) {
        return { success: false, error: 'Usuário inativo' }
      }

      // Verifica senha
      const isValidPassword = await this.verifyPassword(senha, user.senha)

      if (!isValidPassword) {
        return { success: false, error: 'Senha incorreta' }
      }

      // Atualiza último acesso
      await db.rawQuery(
        'UPDATE usuarios_master SET ultimo_acesso = NOW() WHERE id = ?',
        [user.id]
      )

      const payload: JwtPayload = {
        id: user.id,
        login: user.login,
        nome: user.nome,
        email: user.email,
        perfil: 'SUPER_ADMIN',
        is_super_admin: true,
        municipio_id: null,
      }

      const token = this.generateToken(payload)

      return { success: true, user: payload, token }
    } catch (error) {
      return { success: false, error: 'Erro ao autenticar' }
    }
  }

  /**
   * Gera um token JWT
   */
  static generateToken(payload: JwtPayload): string {
    return jwt.sign(payload, this.getJwtSecret(), { expiresIn: this.jwtExpiresIn })
  }

  /**
   * Verifica um token JWT
   */
  static verifyToken(token: string): JwtPayload {
    return jwt.verify(token, this.getJwtSecret()) as JwtPayload
  }

  /**
   * Faz hash de uma senha
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
  }

  /**
   * Verifica se uma senha corresponde a um hash
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
      return bcrypt.compare(password, hash)
    } else {
      // AdonisJS hash.verify espera (hashedValue, plainText)
      const hashService = (await import('@adonisjs/core/services/hash')).default
      return hashService.verify(hash, password)
    }
  }

  /**
   * Extrai o token do header Authorization
   */
  static extractTokenFromHeader(header: string | undefined): string | null {
    if (!header || !header.startsWith('Bearer ')) {
      return null
    }
    return header.substring(7)
  }

  /**
   * Valida o formato de um email
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/i;
    return emailRegex.test(String(email).toLowerCase());
  }

  /**
   * Valida a força de uma senha
   */
  static isStrongPassword(password: string): boolean {
    // Mínimo 8 caracteres, 1 maiúscula, 1 minúscula, 1 número, 1 especial
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return strongPasswordRegex.test(password);
  }
}

import { test } from '@japa/runner'
import AuthService from '#services/auth_service'
import bcrypt from 'bcryptjs'

test.group('AuthService', () => {
  /**
   * Teste: Deve gerar token JWT válido
   */
  test('deve gerar token JWT válido', async ({ assert }) => {
    const payload = {
      id: 1,
      login: 'admin',
      nome: 'Administrador',
      email: 'admin@example.com',
      perfil: 'SUPER_ADMIN',
      is_super_admin: true,
    }

    const token = AuthService.generateToken(payload)

    assert.isString(token)
    assert.isNotEmpty(token)
    assert.match(token, /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/)
  })

  /**
   * Teste: Deve validar token JWT corretamente
   */
  test('deve validar token JWT corretamente', async ({ assert }) => {
    const payload = {
      id: 1,
      login: 'admin',
      nome: 'Administrador',
      email: 'admin@example.com',
      perfil: 'SUPER_ADMIN',
      is_super_admin: true,
    }

    const token = AuthService.generateToken(payload)
    const decoded = AuthService.verifyToken(token)

    assert.isObject(decoded)
    assert.equal(decoded.id, payload.id)
    assert.equal(decoded.login, payload.login)
    assert.equal(decoded.email, payload.email)
  })

  /**
   * Teste: Deve rejeitar token JWT inválido
   */
  test('deve rejeitar token JWT inválido', async ({ assert }) => {
    const invalidToken = 'token.invalido.aqui'

    assert.throws(() => {
      AuthService.verifyToken(invalidToken)
    })
  })

  /**
   * Teste: Deve fazer hash de senha corretamente
   */
  test('deve fazer hash de senha corretamente', async ({ assert }) => {
    const senha = 'senha123'
    const hash = await AuthService.hashPassword(senha)

    assert.isString(hash)
    assert.isNotEmpty(hash)
    assert.notEqual(hash, senha)
    assert.isTrue(hash.startsWith('$2'))
  })

  /**
   * Teste: Deve comparar senhas com hash corretamente
   */
  test('deve comparar senhas com hash corretamente', async ({ assert }) => {
    const senha = 'senha123'
    const hash = await bcrypt.hash(senha, 10)

    const isValid = await AuthService.verifyPassword(senha, hash)
    const isInvalid = await AuthService.verifyPassword('senhaerrada', hash)

    assert.isTrue(isValid)
    assert.isFalse(isInvalid)
  })

  /**
   * Teste: Deve extrair token do header Authorization
   */
  test('deve extrair token do header Authorization', async ({ assert }) => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature'
    const authHeader = `Bearer ${token}`

    const extracted = AuthService.extractTokenFromHeader(authHeader)

    assert.equal(extracted, token)
  })

  /**
   * Teste: Deve retornar null para header sem Bearer
   */
  test('deve retornar null para header sem Bearer', async ({ assert }) => {
    const authHeader = 'InvalidFormat token'

    const extracted = AuthService.extractTokenFromHeader(authHeader)

    assert.isNull(extracted)
  })

  /**
   * Teste: Deve validar formato de email
   */
  test('deve validar formato de email', async ({ assert }) => {
    assert.isTrue(AuthService.isValidEmail('user@example.com'))
    assert.isTrue(AuthService.isValidEmail('admin@getponto.inf.br'))
    assert.isFalse(AuthService.isValidEmail('invalid-email'))
    assert.isFalse(AuthService.isValidEmail('user@'))
    assert.isFalse(AuthService.isValidEmail('@example.com'))
  })

  /**
   * Teste: Deve validar força de senha
   */
  test('deve validar força de senha', async ({ assert }) => {
    // Senhas fortes
    assert.isTrue(AuthService.isStrongPassword('Senha@123'))
    assert.isTrue(AuthService.isStrongPassword('MyP@ssw0rd!'))

    // Senhas fracas
    assert.isFalse(AuthService.isStrongPassword('senha'))
    assert.isFalse(AuthService.isStrongPassword('123456'))
    assert.isFalse(AuthService.isStrongPassword('senha123'))
  })
})

import { Exception } from '@adonisjs/core/exceptions'

/**
 * Exceção base do sistema
 */
export class AppException extends Exception {
  constructor(message: string, status: number = 500, code: string = 'E_APP_ERROR') {
    super(message, { status, code })
  }
}

/**
 * Exceção de validação
 */
export class ValidationException extends AppException {
  constructor(message: string = 'Dados inválidos') {
    super(message, 422, 'E_VALIDATION_ERROR')
  }
}

/**
 * Exceção de registro não encontrado
 */
export class NotFoundException extends AppException {
  constructor(resource: string = 'Registro') {
    super(`${resource} não encontrado`, 404, 'E_NOT_FOUND')
  }
}

/**
 * Exceção de acesso negado
 */
export class ForbiddenException extends AppException {
  constructor(message: string = 'Você não tem permissão para realizar esta ação') {
    super(message, 403, 'E_FORBIDDEN')
  }
}

/**
 * Exceção de não autenticado
 */
export class UnauthorizedException extends AppException {
  constructor(message: string = 'Não autenticado') {
    super(message, 401, 'E_UNAUTHORIZED')
  }
}

/**
 * Exceção de conflito (registro duplicado)
 */
export class ConflictException extends AppException {
  constructor(message: string = 'Este registro já existe') {
    super(message, 409, 'E_CONFLICT')
  }
}

/**
 * Exceção de município não selecionado
 */
export class MunicipioNotSelectedException extends AppException {
  constructor() {
    super('Selecione um município para continuar', 400, 'E_MUNICIPIO_NOT_SELECTED')
  }
}

/**
 * Exceção de configuração inválida
 */
export class ConfigurationException extends AppException {
  constructor(message: string = 'Configuração inválida do sistema') {
    super(message, 500, 'E_CONFIGURATION_ERROR')
  }
}

/**
 * Exceção de erro de banco de dados
 */
export class DatabaseException extends AppException {
  constructor(message: string = 'Erro ao acessar o banco de dados') {
    super(message, 500, 'E_DATABASE_ERROR')
  }
}

/**
 * Exceção de erro de integração externa
 */
export class IntegrationException extends AppException {
  constructor(service: string, message: string = 'Erro na integração') {
    super(`Erro na integração com ${service}: ${message}`, 502, 'E_INTEGRATION_ERROR')
  }
}

/**
 * Exceção de limite excedido
 */
export class RateLimitException extends AppException {
  constructor(message: string = 'Muitas requisições. Tente novamente em alguns minutos.') {
    super(message, 429, 'E_RATE_LIMIT')
  }
}

/**
 * Exceção de operação não permitida
 */
export class OperationNotAllowedException extends AppException {
  constructor(message: string = 'Esta operação não é permitida') {
    super(message, 400, 'E_OPERATION_NOT_ALLOWED')
  }
}

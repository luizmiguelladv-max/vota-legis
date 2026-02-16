import vine from '@vinejs/vine'

/**
 * Validator para registro manual de ponto
 */
export const registrarPontoManualValidator = vine.compile(
  vine.object({
    funcionario_id: vine.number().positive(),

    data_hora: vine
      .date({ formats: ['YYYY-MM-DD HH:mm:ss', 'DD/MM/YYYY HH:mm'] })
      .beforeOrEqual('now')
      .withMessage('A data/hora não pode ser futura'),

    tipo: vine
      .enum(['ENTRADA', 'SAIDA', 'INTERVALO_INICIO', 'INTERVALO_FIM'])
      .withMessage('Tipo de registro inválido'),

    justificativa: vine
      .string()
      .trim()
      .minLength(10)
      .maxLength(500)
      .withMessage('A justificativa deve ter entre 10 e 500 caracteres'),

    origem: vine.literal('MANUAL'),
  })
)

/**
 * Validator para registro de ponto via reconhecimento facial
 */
export const registrarPontoFacialValidator = vine.compile(
  vine.object({
    foto: vine
      .string()
      .trim()
      .minLength(100)
      .withMessage('Foto em base64 inválida'),

    latitude: vine.number().min(-90).max(90).optional(),

    longitude: vine.number().min(-180).max(180).optional(),

    origem: vine.literal('FACIAL'),
  })
)

/**
 * Validator para registro de ponto via biometria
 */
export const registrarPontoBiometriaValidator = vine.compile(
  vine.object({
    funcionario_id: vine.number().positive(),

    template: vine
      .string()
      .trim()
      .minLength(10)
      .withMessage('Template de digital inválido'),

    origem: vine.enum(['BIOMETRIA', 'REP']),

    nsr: vine.string().trim().optional(),
  })
)

/**
 * Validator para ajuste de ponto
 */
export const ajustarPontoValidator = vine.compile(
  vine.object({
    registro_id: vine.number().positive(),

    nova_data_hora: vine
      .date({ formats: ['YYYY-MM-DD HH:mm:ss', 'DD/MM/YYYY HH:mm'] })
      .beforeOrEqual('now'),

    motivo: vine
      .string()
      .trim()
      .minLength(10)
      .maxLength(500)
      .withMessage('O motivo deve ter entre 10 e 500 caracteres'),

    aprovador_id: vine.number().positive(),
  })
)

/**
 * Validator para exclusão de ponto
 */
export const excluirPontoValidator = vine.compile(
  vine.object({
    registro_id: vine.number().positive(),

    motivo: vine
      .string()
      .trim()
      .minLength(10)
      .maxLength(500)
      .withMessage('O motivo deve ter entre 10 e 500 caracteres'),

    aprovador_id: vine.number().positive(),
  })
)

/**
 * Validator para consulta de registros de ponto
 */
export const consultarPontoValidator = vine.compile(
  vine.object({
    funcionario_id: vine.number().positive().optional(),

    data_inicio: vine.date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] }),

    data_fim: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .afterOrEqual('data_inicio')
      .withMessage('A data final deve ser posterior ou igual à data inicial'),

    origem: vine
      .enum(['TODOS', 'MANUAL', 'BIOMETRIA', 'FACIAL', 'REP'])
      .optional(),

    page: vine.number().min(1).optional(),

    limit: vine.number().min(1).max(100).optional(),
  })
)

/**
 * Validator para webhook do REP Control iD
 */
export const webhookREPValidator = vine.compile(
  vine.object({
    user_id: vine.number().positive(),

    timestamp: vine.string().trim(),

    device_id: vine.number().positive().optional(),

    nsr: vine.string().trim().optional(),
  })
)

/**
 * Mensagens de erro personalizadas em português
 */
export const pontoMessages = {
  'funcionario_id.required': 'O campo funcionário é obrigatório',
  'funcionario_id.positive': 'ID de funcionário inválido',
  'data_hora.required': 'O campo data/hora é obrigatório',
  'data_hora.beforeOrEqual': 'A data/hora não pode ser futura',
  'tipo.required': 'O campo tipo é obrigatório',
  'tipo.enum': 'Tipo de registro inválido',
  'justificativa.required': 'O campo justificativa é obrigatório',
  'justificativa.minLength': 'A justificativa deve ter no mínimo 10 caracteres',
  'foto.required': 'A foto é obrigatória',
  'template.required': 'O template de digital é obrigatório',
  'motivo.required': 'O campo motivo é obrigatório',
  'motivo.minLength': 'O motivo deve ter no mínimo 10 caracteres',
  'data_inicio.required': 'O campo data inicial é obrigatório',
  'data_fim.required': 'O campo data final é obrigatório',
  'data_fim.afterOrEqual': 'A data final deve ser posterior ou igual à data inicial',
}

import vine from '@vinejs/vine'
import { cpf } from './shared/cpf_validator.js'
import { pis } from './shared/pis_validator.js'

/**
 * Validator para criação de funcionário
 */
export const createFuncionarioValidator = vine.compile(
  vine.object({
    nome: vine
      .string()
      .trim()
      .minLength(3)
      .maxLength(100)
      .regex(/^[a-zA-ZÀ-ÿ\s]+$/)
      .withMessage('O nome deve conter apenas letras'),

    cpf: cpf(),

    matricula: vine.string().trim().minLength(1).maxLength(20),

    pis: pis().optional(),

    email: vine
      .string()
      .email()
      .normalizeEmail()
      .optional(),

    telefone: vine
      .string()
      .mobile({ locale: ['pt-BR'] })
      .optional(),

    data_nascimento: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .optional(),

    data_admissao: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .beforeOrEqual('today'),

    lotacao_id: vine.number().positive(),

    cargo_id: vine.number().positive(),

    jornada_id: vine.number().positive(),

    vinculo: vine
      .enum(['EFETIVO', 'COMISSIONADO', 'CONTRATADO', 'ESTAGIARIO', 'TERCEIRIZADO'])
      .optional(),

    ativo: vine.boolean().optional(),

    observacoes: vine.string().trim().maxLength(500).optional(),
  })
)

/**
 * Validator para atualização de funcionário
 */
export const updateFuncionarioValidator = vine.compile(
  vine.object({
    nome: vine
      .string()
      .trim()
      .minLength(3)
      .maxLength(100)
      .regex(/^[a-zA-ZÀ-ÿ\s]+$/)
      .optional(),

    cpf: cpf().optional(),

    matricula: vine.string().trim().minLength(1).maxLength(20).optional(),

    pis: pis().optional(),

    email: vine
      .string()
      .email()
      .normalizeEmail()
      .optional(),

    telefone: vine
      .string()
      .mobile({ locale: ['pt-BR'] })
      .optional(),

    data_nascimento: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .optional(),

    data_admissao: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .beforeOrEqual('today')
      .optional(),

    data_demissao: vine
      .date({ formats: ['YYYY-MM-DD', 'DD/MM/YYYY'] })
      .afterOrEqual('data_admissao')
      .optional(),

    lotacao_id: vine.number().positive().optional(),

    cargo_id: vine.number().positive().optional(),

    jornada_id: vine.number().positive().optional(),

    vinculo: vine
      .enum(['EFETIVO', 'COMISSIONADO', 'CONTRATADO', 'ESTAGIARIO', 'TERCEIRIZADO'])
      .optional(),

    ativo: vine.boolean().optional(),

    observacoes: vine.string().trim().maxLength(500).optional(),
  })
)

/**
 * Validator para cadastro de foto do funcionário
 */
export const uploadFotoValidator = vine.compile(
  vine.object({
    foto: vine
      .file({
        size: '5mb',
        extnames: ['jpg', 'jpeg', 'png'],
      })
      .withMessage('A foto deve ser JPG, JPEG ou PNG e ter no máximo 5MB'),
  })
)

/**
 * Validator para cadastro de digital do funcionário
 */
export const uploadDigitalValidator = vine.compile(
  vine.object({
    dedo: vine
      .enum([
        'POLEGAR_DIREITO',
        'INDICADOR_DIREITO',
        'MEDIO_DIREITO',
        'ANELAR_DIREITO',
        'MINIMO_DIREITO',
        'POLEGAR_ESQUERDO',
        'INDICADOR_ESQUERDO',
        'MEDIO_ESQUERDO',
        'ANELAR_ESQUERDO',
        'MINIMO_ESQUERDO',
      ])
      .withMessage('Dedo inválido'),

    template: vine
      .string()
      .trim()
      .minLength(10)
      .withMessage('Template de digital inválido'),

    amostra: vine
      .number()
      .min(1)
      .max(3)
      .withMessage('Número da amostra deve ser entre 1 e 3'),
  })
)

/**
 * Mensagens de erro personalizadas em português
 */
export const funcionarioMessages = {
  'nome.required': 'O campo nome é obrigatório',
  'nome.minLength': 'O nome deve ter no mínimo 3 caracteres',
  'nome.maxLength': 'O nome deve ter no máximo 100 caracteres',
  'cpf.required': 'O campo CPF é obrigatório',
  'matricula.required': 'O campo matrícula é obrigatório',
  'email.email': 'O email informado é inválido',
  'telefone.mobile': 'O telefone informado é inválido',
  'data_admissao.beforeOrEqual': 'A data de admissão não pode ser futura',
  'data_demissao.afterOrEqual': 'A data de demissão deve ser posterior à admissão',
  'lotacao_id.required': 'O campo lotação é obrigatório',
  'cargo_id.required': 'O campo cargo é obrigatório',
  'jornada_id.required': 'O campo jornada é obrigatório',
}

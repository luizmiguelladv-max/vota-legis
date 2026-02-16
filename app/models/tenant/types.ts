/**
 * Tipos TypeScript para entidades do banco municipal (tenant)
 * Usados com queries diretas via DatabaseManagerService
 */

export interface UnidadeGestora {
  id: number
  codigo: string
  nome: string
  cnpj: string | null
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface Secretaria {
  id: number
  unidade_gestora_id: number
  codigo: string
  nome: string
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface Lotacao {
  id: number
  secretaria_id: number
  codigo: string
  nome: string
  endereco: string | null
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface TipoVinculo {
  id: number
  codigo: string
  nome: string
  descricao: string | null
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface Cargo {
  id: number
  codigo: string
  nome: string
  tipo_vinculo_id: number | null
  carga_horaria_semanal: number
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface Jornada {
  id: number
  codigo: string
  nome: string
  descricao: string | null
  carga_horaria_diaria: number // em minutos
  carga_horaria_semanal: number // em minutos
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface JornadaHorario {
  id: number
  jornada_id: number
  dia_semana: number // 0=Dom, 1=Seg, ..., 6=Sab
  entrada_1: string | null
  saida_1: string | null
  entrada_2: string | null
  saida_2: string | null
  folga: boolean
  created_at: Date
  updated_at: Date
}

export interface Funcionario {
  id: number
  matricula: string
  cpf: string
  pis: string | null
  nome: string
  data_nascimento: Date | null
  sexo: 'M' | 'F' | null
  lotacao_id: number | null
  cargo_id: number | null
  tipo_vinculo_id: number | null
  jornada_id: number | null
  data_admissao: Date
  data_demissao: Date | null
  foto_url: string | null
  template_biometrico: Buffer | null
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface FuncionarioJornada {
  id: number
  funcionario_id: number
  jornada_id: number
  data_inicio: Date
  data_fim: Date | null
  created_at: Date
  updated_at: Date
}

export interface Equipamento {
  id: number
  nome: string
  modelo: string | null
  fabricante: string
  numero_serie: string | null
  ip: string
  porta: number
  usuario: string | null
  senha: string | null
  lotacao_id: number | null
  status: 'ONLINE' | 'OFFLINE'
  ultimo_ping: Date | null
  ultima_sincronizacao: Date | null
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface RegistroPonto {
  id: number
  funcionario_id: number
  equipamento_id: number | null
  data_hora: Date
  tipo: 'ENTRADA' | 'SAIDA' | null
  origem: 'EQUIPAMENTO' | 'MANUAL' | 'IMPORTACAO'
  nsr: number | null
  justificativa: string | null
  justificado_por: number | null
  justificado_em: Date | null
  created_at: Date
  updated_at: Date
}

export interface EspelhoPonto {
  id: number
  funcionario_id: number
  mes: number
  ano: number
  dias_trabalhados: number
  horas_trabalhadas: number // em minutos
  horas_extras: number // em minutos
  horas_faltantes: number // em minutos
  atrasos: number // em minutos
  faltas: number
  status: 'ABERTO' | 'FECHADO' | 'APROVADO'
  aprovado_por: number | null
  aprovado_em: Date | null
  dados: Record<string, any> | null
  created_at: Date
  updated_at: Date
}

export interface Feriado {
  id: number
  data: Date
  nome: string
  tipo: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL'
  recorrente: boolean
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface TipoOcorrencia {
  id: number
  codigo: string
  nome: string
  descricao: string | null
  abono_horas: boolean
  cor: string
  ativo: boolean
  created_at: Date
  updated_at: Date
}

export interface Ocorrencia {
  id: number
  funcionario_id: number
  tipo_ocorrencia_id: number
  data_inicio: Date
  data_fim: Date
  descricao: string | null
  aprovado: boolean
  aprovado_por: number | null
  aprovado_em: Date | null
  created_at: Date
  updated_at: Date
}

export interface Usuario {
  id: number
  login: string
  senha: string
  nome: string
  email: string
  perfil: 'ADMIN' | 'RH' | 'GESTOR' | 'USUARIO'
  funcionario_id: number | null
  lotacoes_permitidas: number[]
  ativo: boolean
  ultimo_acesso: Date | null
  created_at: Date
  updated_at: Date
}

export interface TenantAuditLog {
  id: number
  usuario_id: number | null
  acao: string
  tabela: string | null
  registro_id: number | null
  dados_anteriores: Record<string, any> | null
  dados_novos: Record<string, any> | null
  ip: string | null
  user_agent: string | null
  created_at: Date
}

export interface ConfiguracaoSistema {
  id: number
  chave: string
  valor: string | null
  descricao: string | null
  created_at: Date
  updated_at: Date
}

export interface Sincronizacao {
  id: number
  equipamento_id: number
  tipo: 'REGISTROS' | 'FUNCIONARIOS' | 'BIOMETRIA'
  status: 'SUCESSO' | 'ERRO' | 'EM_ANDAMENTO'
  registros_processados: number
  detalhes: Record<string, any> | null
  iniciado_em: Date
  finalizado_em: Date | null
}

// Tipos para DTOs (Data Transfer Objects)
export interface CreateFuncionarioDTO {
  matricula: string
  cpf: string
  pis?: string
  nome: string
  data_nascimento?: Date
  sexo?: 'M' | 'F'
  lotacao_id?: number
  cargo_id?: number
  tipo_vinculo_id?: number
  jornada_id?: number
  data_admissao: Date
  foto_url?: string
}

export interface UpdateFuncionarioDTO extends Partial<CreateFuncionarioDTO> {
  data_demissao?: Date
  ativo?: boolean
}

export interface CreateRegistroPontoDTO {
  funcionario_id: number
  equipamento_id?: number
  data_hora: Date
  tipo?: 'ENTRADA' | 'SAIDA'
  origem: 'EQUIPAMENTO' | 'MANUAL' | 'IMPORTACAO'
  nsr?: number
  justificativa?: string
  justificado_por?: number
}

export interface CreateOcorrenciaDTO {
  funcionario_id: number
  tipo_ocorrencia_id: number
  data_inicio: Date
  data_fim: Date
  descricao?: string
}

export interface DataTableRequest {
  draw: number
  start: number
  length: number
  search?: { value: string }
  order?: { column: number; dir: 'asc' | 'desc' }[]
  columns?: { data: string; searchable: boolean; orderable: boolean }[]
}

export interface DataTableResponse<T> {
  draw: number
  recordsTotal: number
  recordsFiltered: number
  data: T[]
}

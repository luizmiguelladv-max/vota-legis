-- Tipos de vínculo para setor privado

-- Adiciona tipos de vínculo ao funcionário (schema tenant)
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS tipo_vinculo VARCHAR(30) DEFAULT 'EFETIVO'
  CHECK (tipo_vinculo IN (
    -- Público
    'EFETIVO', 'COMISSIONADO', 'CONTRATADO', 'ESTAGIARIO', 'TERCEIRIZADO',
    -- Privado CLT
    'CLT', 'CLT_INTERMITENTE', 'CLT_PARCIAL',
    -- Privado outros
    'PJ', 'TEMPORARIO', 'APRENDIZ', 'HOME_OFFICE', 'AUTONOMO'
  ));

-- Centro de custo (para setor privado)
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS centro_custo VARCHAR(50);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS filial_id INTEGER;

-- Dados bancários para integração folha
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS banco_codigo VARCHAR(10);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS banco_nome VARCHAR(100);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS banco_agencia VARCHAR(20);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS banco_conta VARCHAR(30);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS banco_tipo_conta VARCHAR(20);  -- CORRENTE, POUPANCA, SALARIO

-- Dados trabalhistas CLT
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS ctps_numero VARCHAR(20);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS ctps_serie VARCHAR(10);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS ctps_uf VARCHAR(2);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_admissao DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS data_demissao DATE;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS motivo_demissao TEXT;

-- Salário e remuneração
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS salario_base DECIMAL(12,2);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS tipo_salario VARCHAR(20) DEFAULT 'MENSAL'
  CHECK (tipo_salario IN ('MENSAL', 'QUINZENAL', 'SEMANAL', 'DIARIO', 'HORISTA'));

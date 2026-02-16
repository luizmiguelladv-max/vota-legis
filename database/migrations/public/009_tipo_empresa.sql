-- Alterações para suporte a setor público e privado

-- Adiciona tipo de empresa ao municipio/tenant
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS tipo_empresa VARCHAR(20) DEFAULT 'PUBLICO' 
  CHECK (tipo_empresa IN ('PUBLICO', 'PRIVADO'));

ALTER TABLE municipios ADD COLUMN IF NOT EXISTS razao_social VARCHAR(200);
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS cnpj VARCHAR(18);
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(20);
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS inscricao_municipal VARCHAR(20);
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS segmento VARCHAR(50);  -- Comércio, Indústria, Serviços, etc.
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS porte VARCHAR(20);  -- ME, EPP, MÉDIO, GRANDE

-- Terminologia customizável
ALTER TABLE municipios ADD COLUMN IF NOT EXISTS terminologia JSONB DEFAULT '{
  "funcionario": "Funcionário",
  "funcionarios": "Funcionários", 
  "setor": "Setor",
  "setores": "Setores",
  "cargo": "Cargo",
  "cargos": "Cargos",
  "lotacao": "Lotação",
  "ponto": "Ponto"
}'::jsonb;

# Notas de Design do Portal GetPonto

## Análise do Portal Atual (https://getponto.inf.br/)

### Cores
- **Primária**: Azul escuro (#1e3a8a / #1e40af)
- **Secundária**: Azul claro/cyan (#06b6d4)
- **Accent**: Verde/Teal para destaques
- **Background Hero**: Gradiente azul escuro
- **Texto**: Branco no hero, cinza escuro no conteúdo

### Tipografia
- Fonte moderna e limpa (provavelmente Inter ou similar)
- Títulos grandes e bold
- Hierarquia clara

### Estrutura do Portal

#### 1. Header/Navbar
- Logo "GetPonto" com ícone
- Menu: Flexibilidade, App & Presença, Compliance, Área do Cliente
- Botão CTA: "Área do Cliente"
- Background transparente que fica sólido ao scroll

#### 2. Hero Section
- **Título**: "Gestão de Ponto Inteligente e Segura"
- **Subtítulo**: "Conformidade total com a Portaria 671. Simplifique o controle de jornada com tecnologia avançada."
- **CTA**: "Solicite uma Demonstração Gratuita"
- **Imagem**: Mockup de celular mostrando reconhecimento facial + mapa GPS
- Background: Gradiente azul escuro com efeitos sutis

#### 3. Principais Funcionalidades (Features)
Três cards lado a lado:

**REP Tradicional**
- Integração com relógios REP homologados (Control iD, Henry, Dimep)
- Tag: "Para Indústrias"

**Biometria Digital**
- Leitores USB para registro rápido
- Tag: "Para Escritórios"

**Reconhecimento Facial**
- Alta tecnologia sem contato físico
- Tag: "Para Todos"

#### 4. Gestão de Presença e Rotas Externas
- Título: "Muito mais que um relógio de ponto"
- Subtítulo: "O App GetPonto é a ferramenta definitiva para equipes em campo"
- Features:
  - Marcação de Presença
  - Histórico de Rotas GPS
  - Offline & Seguro
- CTAs: Botões Google Play e App Store
- Mockup: Tela do app mostrando "Posto 05 - Centro" com botão "MARCAR PRESENÇA"

#### 5. Conformidade Legal
- Título: "Conformidade Legal"
- Destaque: Portaria 671 do MTE
- Explicação sobre REP-P
- Features:
  - Comprovantes com assinatura digital
  - Exportação AFD/AEJ
  - Armazenamento seguro
- Badges: AFD/AEJ, Assinatura Digital, MTE Homologado

#### 6. CTA Final
- Título: "Escolha a solução completa"
- Subtítulo: "Do REP físico ao App com rastreamento"
- CTA: "Começar Agora"
- Nota: "Sem cartão de crédito. Cancele quando quiser."
- Campo de email

#### 7. Footer
- Logo GetPonto
- Redes sociais: LinkedIn, Instagram, YouTube
- Links:
  - Funcionalidades, App Mobile, Integrações, Preços
  - Sobre nós, Blog, Carreiras, Contato
  - Privacidade, Termos de Uso, LGPD, Compliance

### Elementos Visuais
- Mockups de dispositivos (celular, tablet)
- Ícones modernos e minimalistas
- Cards com hover effects
- Gradientes sutis
- Sombras suaves (shadows)
- Animações suaves de scroll

### Responsividade
- Layout adaptável para mobile
- Menu hamburguer em telas pequenas
- Cards empilhados em mobile

### Tecnologia Atual
- React (compilado)
- Componentes modernos
- Animações com Framer Motion ou similar

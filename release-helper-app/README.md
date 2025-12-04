# 🚀 Release Doc Helper

> Sistema de gerenciamento e acompanhamento de documentos de release para equipes de desenvolvimento.

![Angular](https://img.shields.io/badge/Angular-16.2-red?style=flat-square&logo=angular)
![TypeScript](https://img.shields.io/badge/TypeScript-5.1-blue?style=flat-square&logo=typescript)
![Angular Material](https://img.shields.io/badge/Angular%20Material-16.2-purple?style=flat-square)

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#-arquitetura)
- [Instalação](#-instalação)
- [Uso](#-uso)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Segurança](#-segurança)
- [Roadmap](#-roadmap)
- [Contribuição](#-contribuição)

## 🎯 Visão Geral

O **Release Doc Helper** é uma aplicação Angular projetada para facilitar a criação, edição e acompanhamento de documentos de release. A ferramenta padroniza o processo de documentação, garantindo rastreabilidade e conformidade com processos de auditoria.

### Por que usar?

- ✅ **Padronização**: Todos os documentos seguem o mesmo template
- ✅ **Rastreabilidade**: Histórico completo de alterações
- ✅ **Agilidade**: Interface intuitiva para preenchimento rápido
- ✅ **Exportação**: Gere arquivos Markdown automaticamente
- ✅ **Offline First**: Funciona sem conexão (localStorage)

## ✨ Funcionalidades

### Dashboard
- Visão geral com estatísticas de releases
- Cards de ações rápidas
- Releases recentes em destaque

### Gerenciamento de Releases
- **Criar**: Formulário completo com todos os campos necessários
- **Editar**: Atualize informações a qualquer momento
- **Visualizar**: Detalhes completos da release
- **Excluir**: Remoção com confirmação
- **Exportar**: Download em formato Markdown (.md)

### Campos do Documento
- **Informações Básicas**: ID da demanda, título, descrição
- **Responsáveis**: Dev, Funcional, LT, SRE
- **Keys/Secrets**: Gerenciamento por ambiente (DEV, QAS, PRD)
- **Scripts**: Paths e identificadores de change
- **Repositórios**: URLs, branches e impactos
- **Observações**: Notas gerais e releases validadas

### Status Tracking
- 📝 Rascunho
- 🔄 Em Andamento
- 🧪 Validação QAS
- ⏳ Aguardando Aprovação
- ✅ Aprovado
- 🚀 Implantado
- ❌ Cancelado

## 🏗 Arquitetura

A aplicação segue uma arquitetura modular baseada nas melhores práticas do Angular:

```
src/app/
├── core/           # Serviços singleton, guards, interceptors
├── shared/         # Componentes, pipes, módulos reutilizáveis
├── features/       # Módulos de funcionalidades (lazy loaded)
└── models/         # Interfaces e tipos TypeScript
```

### Princípios
- **Separation of Concerns**: Cada módulo tem responsabilidade única
- **DRY (Don't Repeat Yourself)**: Código reutilizável no SharedModule
- **SOLID**: Serviços com injeção de dependência
- **Lazy Loading**: Módulos carregados sob demanda

### Tecnologias
- **Angular 16**: Framework principal
- **Angular Material**: Biblioteca de componentes UI
- **RxJS**: Programação reativa
- **TypeScript**: Tipagem estática

## 💻 Instalação

### Pré-requisitos
- Node.js 18+ 
- npm 9+
- Angular CLI 16+

### Passos

```bash
# Clone o repositório
git clone <url-do-repositorio>
cd release-helper-app

# Instale as dependências
npm install

# Inicie o servidor de desenvolvimento
npm start
```

A aplicação estará disponível em `http://localhost:4200`.

### Scripts Disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia servidor de desenvolvimento |
| `npm run build` | Gera build de produção |
| `npm run watch` | Build com watch mode |
| `npm test` | Executa testes unitários |

## 📖 Uso

### Criando uma Nova Release

1. Acesse a página inicial ou clique em "Nova Release" no menu
2. Preencha os campos obrigatórios:
   - ID da Demanda (ex: DMND0011870)
   - Descrição
   - Desenvolvedor responsável
3. Adicione informações complementares:
   - Keys/Secrets necessárias
   - Scripts de banco de dados
   - Repositórios impactados
4. Clique em "Criar Release"

### Exportando para Markdown

1. Acesse a release desejada
2. Clique no botão "Exportar" ou no ícone de download
3. O arquivo `.md` será baixado automaticamente

### Exemplo de Documento Gerado

```markdown
# Release DMND0011870

## 1. Responsáveis
| Função | Nome |
|--------|------|
| Dev    | Allan Serra |
| Funcional | Renan Antunes |
| LT     | Gabriel Lourenção |
| SRE    | Erik de Souza Jacob |

## 2. Descrição da Release
> Correção dos cards 20431, 20481 e 20262

...
```

## 📁 Estrutura do Projeto

```
release-helper-app/
├── src/
│   ├── app/
│   │   ├── core/                    # Core Module
│   │   │   ├── services/
│   │   │   │   ├── release.service.ts      # CRUD de releases
│   │   │   │   └── notification.service.ts # Snackbar notifications
│   │   │   └── core.module.ts
│   │   │
│   │   ├── shared/                  # Shared Module
│   │   │   ├── components/
│   │   │   │   ├── header/          # Header da aplicação
│   │   │   │   ├── status-badge/    # Badge de status
│   │   │   │   ├── empty-state/     # Estado vazio
│   │   │   │   └── confirm-dialog/  # Diálogo de confirmação
│   │   │   ├── material.module.ts   # Imports do Material
│   │   │   └── shared.module.ts
│   │   │
│   │   ├── features/                # Feature Modules
│   │   │   ├── home/                # Dashboard
│   │   │   └── releases/
│   │   │       ├── release-list/    # Lista de releases
│   │   │       ├── release-form/    # Formulário de criação/edição
│   │   │       └── release-detail/  # Detalhes da release
│   │   │
│   │   ├── models/                  # Interfaces e tipos
│   │   │   └── release.model.ts
│   │   │
│   │   ├── app.module.ts
│   │   ├── app.component.ts
│   │   └── app-routing.module.ts
│   │
│   ├── styles.scss                  # Estilos globais e tema
│   └── index.html
│
├── angular.json
├── package.json
└── README.md
```

## 🔒 Segurança

### Práticas Implementadas

1. **Validação de Dados**: Formulários com validação Angular Reactive Forms
2. **Sanitização**: Angular sanitiza automaticamente inputs
3. **Sem Exposição de Secrets**: Dados sensíveis não são exibidos em texto plano
4. **Storage Local**: Dados mantidos apenas no navegador do usuário
5. **Sem Dependências Externas**: Nenhuma chamada a APIs de terceiros

### Considerações para Produção

- Implementar autenticação (SSO/OAuth)
- Adicionar backend para persistência segura
- Configurar HTTPS
- Implementar audit logs
- Adicionar controle de acesso (RBAC)

## 🛣 Roadmap

### Fase 1 - MVP ✅
- [x] Criação de releases
- [x] Listagem e filtros
- [x] Exportação Markdown
- [x] Persistência local

### Fase 2 - Em Planejamento
- [ ] Integração com GitHub API
- [ ] Autenticação SSO
- [ ] Backend para persistência
- [ ] Notificações em tempo real

### Fase 3 - Futuro
- [ ] Integração com Jira/ServiceNow
- [ ] Workflows de aprovação
- [ ] Dashboard analytics
- [ ] API REST para integrações

## 🤝 Contribuição

### Fluxo de Desenvolvimento

1. Crie uma branch: `feature/nome-da-feature`
2. Faça commits semânticos: `feat:`, `fix:`, `docs:`, etc.
3. Abra um Pull Request
4. Aguarde revisão de código

### Padrões de Código

- ESLint + Prettier configurados
- Componentes seguem Angular Style Guide
- Services injetáveis e testáveis
- Types para todos os objetos

---

## 📞 Suporte

Para dúvidas ou sugestões, entre em contato com a equipe de desenvolvimento.

---

**Desenvolvido com ❤️ para simplificar o processo de releases**

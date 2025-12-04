/**
 * Modelo principal de Release
 * Representa um documento de release completo
 */
export interface Release {
  id: string;
  demandId: string;
  title: string;
  description: string;
  responsible: ReleaseResponsible;
  secrets: ReleaseSecret[];
  scripts: ReleaseScript[];
  repositories: ReleaseRepository[];
  observations: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Responsáveis pela release
 */
export interface ReleaseResponsible {
  dev: string;
  functional: string;
  lt: string;
  sre: string;
}

/**
 * Keys/Secrets necessárias
 */
export interface ReleaseSecret {
  id: string;
  environment: Environment;
  key: string;
  description: string;
  status: SecretStatus;
}

export enum Environment {
  DEV = 'DEV',
  QAS = 'QAS',
  PRD = 'PRD'
}

export enum SecretStatus {
  PENDING = 'PENDING',
  CONFIGURED = 'CONFIGURED',
  NOT_REQUIRED = 'NOT_REQUIRED'
}

/**
 * Scripts necessários
 */
export interface ReleaseScript {
  id: string;
  name: string;
  path: string;
  content?: string; // Conteúdo do script
  changeId?: string;
}

/**
 * Repositórios impactados
 */
export interface ReleaseRepository {
  id: string;
  url: string;
  name: string; // Nome do repositório extraído da URL
  impact: string;
  releaseBranch?: string;
}

/**
 * Estrutura para versionamento
 */
export interface VersioningResult {
  repoName: string;
  files: VersionedFile[];
}

export interface VersionedFile {
  path: string;
  content: string;
  type: 'markdown' | 'sql' | 'script';
}

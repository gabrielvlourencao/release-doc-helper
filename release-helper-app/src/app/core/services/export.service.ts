import { Injectable } from '@angular/core';
import { Release } from '../../models';
import { ReleaseService } from './release.service';
import jsPDF from 'jspdf';

/**
 * Serviço para exportação de documentos
 */
@Injectable({
  providedIn: 'root'
})
export class ExportService {
  constructor(private releaseService: ReleaseService) {}

  /**
   * Exporta release como Markdown
   */
  exportAsMarkdown(release: Release): void {
    const markdown = this.releaseService.generateMarkdown(release);
    this.downloadFile(markdown, `release_${release.demandId}.md`, 'text/markdown');
  }

  /**
   * Exporta release como PDF
   */
  exportAsPDF(release: Release): void {
    const doc = new jsPDF();
    const margin = 20;
    let y = margin;
    const lineHeight = 7;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - (margin * 2);

    // Função auxiliar para adicionar texto com quebra de linha
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line: string) => {
        if (y > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      });
    };

    // Função para adicionar seção
    const addSection = (title: string) => {
      y += 5;
      addText(title, 12, true);
      y += 2;
    };

    // Cabeçalho
    doc.setFillColor(73, 69, 255);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Release ${release.demandId}`, margin, 20);
    
    if (release.title) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(release.title, margin, 28);
    }

    doc.setTextColor(0, 0, 0);
    y = 50;

    // 1. Responsáveis
    addSection('1. Responsáveis');
    const responsaveis = [
      ['Desenvolvedor', release.responsible.dev || '-'],
      ['Funcional', release.responsible.functional || '-'],
      ['LT', release.responsible.lt || '-'],
      ['SRE', release.responsible.sre || '-']
    ];
    responsaveis.forEach(([role, name]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${role}: `, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(name, margin + 35, y);
      y += lineHeight;
    });

    // 2. Descrição
    addSection('2. Descrição da Release');
    addText(release.description);

    // 3. Secrets
    addSection('3. Keys ou Secrets Necessárias');
    if (release.secrets.length > 0) {
      release.secrets.forEach(secret => {
        addText(`• [${secret.environment}] ${secret.key}: ${secret.description} (${secret.status})`);
      });
    } else {
      addText('Nenhuma secret necessária.');
    }

    // 4. Scripts
    addSection('4. Scripts Necessários');
    if (release.scripts.length > 0) {
      release.scripts.forEach(script => {
        const chg = script.changeId ? ` (CHG: ${script.changeId})` : '';
        addText(`• ${script.name} - scripts/${release.demandId}/${script.name}${chg}`);
      });
    } else {
      addText('Nenhum script necessário.');
    }

    // 5. Repositórios
    addSection('5. Repositórios Impactados');
    release.repositories.forEach(repo => {
      addText(`• ${repo.url}`);
      if (repo.impact) {
        addText(`  Impacto: ${repo.impact}`);
      }
      if (repo.releaseBranch) {
        addText(`  Branch: ${repo.releaseBranch}`);
      }
      y += 2;
    });

    // 6. Observações
    if (release.observations) {
      addSection('6. Observações');
      addText(release.observations);
    }

    // Footer
    y = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`,
      margin,
      y
    );

    // Salvar
    doc.save(`release_${release.demandId}.pdf`);
  }

  /**
   * Gera arquivo ZIP com estrutura para versionamento
   */
  async exportForVersioning(release: Release): Promise<void> {
    // Por enquanto, exporta os arquivos individualmente
    // No futuro, pode usar JSZip para criar um ZIP com a estrutura completa
    
    const markdown = this.releaseService.generateMarkdown(release);
    
    // Estrutura: releases/release_DMND.md
    this.downloadFile(
      markdown, 
      `release_${release.demandId}.md`, 
      'text/markdown'
    );

    // Se houver scripts, criar arquivos separados
    for (const script of release.scripts) {
      if (script.content) {
        this.downloadFile(
          script.content,
          script.name,
          'text/plain'
        );
      }
    }
  }

  /**
   * Utilitário para download de arquivo
   */
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}


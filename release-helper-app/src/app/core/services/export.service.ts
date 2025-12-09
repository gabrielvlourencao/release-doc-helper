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
   * Exporta release como PDF com formatação melhorada
   */
  exportAsPDF(release: Release): void {
    const doc = new jsPDF();
    const margin = 20;
    let y = margin;
    const lineHeight = 7;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - (margin * 2);
    const pageHeight = doc.internal.pageSize.getHeight();

    // Função auxiliar para adicionar texto com quebra de linha
    const addText = (text: string, fontSize: number = 10, isBold: boolean = false, x: number = margin) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      
      const lines = doc.splitTextToSize(text, maxWidth - (x - margin));
      lines.forEach((line: string) => {
        if (y > pageHeight - margin - 10) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, x, y);
        y += lineHeight;
      });
    };

    // Função para adicionar seção
    const addSection = (title: string) => {
      y += 8;
      if (y > pageHeight - margin - 10) {
        doc.addPage();
        y = margin;
      }
      doc.setFillColor(240, 240, 240);
      doc.rect(margin - 5, y - 8, pageWidth - (margin * 2) + 10, 8, 'F');
      addText(title, 12, true);
      y += 3;
    };

    // Função para criar tabela
    const addTable = (headers: string[], rows: string[][], columnWidths: number[]) => {
      const startX = margin;
      const tableWidth = pageWidth - (margin * 2);
      const rowHeight = 8;
      const headerHeight = 10;

      // Verifica se precisa de nova página
      if (y + headerHeight + (rows.length * rowHeight) > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      // Cabeçalho da tabela
      let currentX = startX;
      doc.setFillColor(73, 69, 255);
      doc.rect(startX, y, tableWidth, headerHeight, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');

      headers.forEach((header, index) => {
        const width = (tableWidth * columnWidths[index]) / 100;
        doc.text(header, currentX + 3, y + 7);
        currentX += width;
      });

      y += headerHeight;
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      // Linhas da tabela
      rows.forEach((row, rowIndex) => {
        if (y + rowHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
          // Redesenha cabeçalho na nova página
          currentX = startX;
          doc.setFillColor(73, 69, 255);
          doc.rect(startX, y, tableWidth, headerHeight, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          headers.forEach((header, index) => {
            const width = (tableWidth * columnWidths[index]) / 100;
            doc.text(header, currentX + 3, y + 7);
            currentX += width;
          });
          y += headerHeight;
          doc.setTextColor(0, 0, 0);
          doc.setFont('helvetica', 'normal');
        }

        // Cor de fundo alternada
        if (rowIndex % 2 === 0) {
          doc.setFillColor(250, 250, 250);
          doc.rect(startX, y, tableWidth, rowHeight, 'F');
        }

        // Bordas
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.1);
        doc.line(startX, y, startX + tableWidth, y); // Linha superior
        doc.line(startX, y + rowHeight, startX + tableWidth, y + rowHeight); // Linha inferior

        // Conteúdo das células
        currentX = startX;
        row.forEach((cell, colIndex) => {
          const width = (tableWidth * columnWidths[colIndex]) / 100;
          const cellText = doc.splitTextToSize(cell || '-', width - 6);
          doc.text(cellText[0] || '-', currentX + 3, y + 6);
          
          // Linha vertical entre colunas
          if (colIndex < headers.length - 1) {
            doc.line(currentX + width, y, currentX + width, y + rowHeight);
          }
          currentX += width;
        });

        y += rowHeight;
      });

      y += 5; // Espaço após a tabela
    };

    // Cabeçalho
    doc.setFillColor(73, 69, 255);
    const headerHeight = release.title ? 50 : 40;
    doc.rect(0, 0, pageWidth, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    
    // Título principal - Release ID
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    const releaseTitle = `Release ${release.demandId}`;
    // Centraliza verticalmente no cabeçalho
    const titleY = release.title ? 22 : 25;
    doc.text(releaseTitle, margin, titleY);
    
    // Subtítulo - Título da release (se houver)
    if (release.title) {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'normal');
      const titleLines = doc.splitTextToSize(release.title, maxWidth);
      // Mostra até 2 linhas do título
      const linesToShow = titleLines.slice(0, 2);
      linesToShow.forEach((line: string, index: number) => {
        doc.text(line, margin, 35 + (index * 7));
      });
    }

    doc.setTextColor(0, 0, 0);
    y = headerHeight + 15;

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
      doc.setFontSize(10);
      doc.text(`${role}: `, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(name, margin + 40, y);
      y += lineHeight;
    });

    // 2. Descrição
    addSection('2. Descrição da Release');
    addText(release.description, 10, false);

    // 3. Secrets - Tabela formatada
    addSection('3. Keys ou Secrets Necessárias');
    if (release.secrets.length > 0) {
      const secretsHeaders = ['Ambiente', 'Key/Secret', 'Descrição', 'Status'];
      const secretsRows = release.secrets.map(secret => [
        secret.environment || '-',
        secret.key || '-',
        secret.description || '-',
        secret.status || '-'
      ]);
      addTable(secretsHeaders, secretsRows, [15, 25, 40, 20]);
    } else {
      addText('Nenhuma secret necessária.', 10, false);
      y += lineHeight;
    }

    // 4. Scripts - Tabela formatada
    addSection('4. Scripts Necessários');
    if (release.scripts.length > 0) {
      const scriptsHeaders = ['Script', 'Caminho (Path)', 'CHG'];
      const scriptsRows = release.scripts.map(script => [
        script.name || '-',
        `scripts/${release.demandId}/${script.name}`,
        script.changeId || '-'
      ]);
      addTable(scriptsHeaders, scriptsRows, [30, 50, 20]);
    } else {
      addText('Nenhum script necessário.', 10, false);
      y += lineHeight;
    }

    // 5. Repositórios - Tabela formatada
    addSection('5. Repositórios Impactados');
    if (release.repositories.length > 0) {
      const reposHeaders = ['Repositório', 'Impacto/Alteração', 'Branch Release'];
      const reposRows = release.repositories.map(repo => [
        repo.url || '-',
        repo.impact || '-',
        repo.releaseBranch || '-'
      ]);
      addTable(reposHeaders, reposRows, [40, 40, 20]);
    } else {
      addText('Nenhum repositório cadastrado.', 10, false);
      y += lineHeight;
    }

    // 6. Observações
    if (release.observations) {
      addSection('6. Observações');
      addText(release.observations, 10, false);
    }

    // Footer
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      y = pageHeight - 15;
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} - Página ${i} de ${totalPages}`,
        margin,
        y
      );
    }

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


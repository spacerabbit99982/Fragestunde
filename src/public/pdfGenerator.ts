
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { BuildingType } from './types';

export const generatePdf = async (element: HTMLElement, buildingType: BuildingType) => {
    if (!element) throw new Error("Das zu druckende Element wurde nicht gefunden.");

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // --- Header ---
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Holzbau-Plan: ' + buildingType, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;

    // --- Add a timestamp ---
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Generiert am: ${new Date().toLocaleString('de-CH')}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    
    // --- Render each part with its drawing using html2canvas ---
    const tableRows = Array.from(element.querySelectorAll('.parts-table > tbody > tr'));

    for (const row of tableRows) {
        // Temporarily ensure the row is fully visible for canvas capture
        row.setAttribute('style', 'display: table-row; page-break-inside: avoid;');

        const canvas = await html2canvas(row as HTMLElement, {
            scale: 2, // Higher scale for better quality
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 1200, // Simulate a wider window for better layout
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const aspectRatio = imgWidth / imgHeight;

        let finalImgWidth = contentWidth;
        let finalImgHeight = finalImgWidth / aspectRatio;
        
        // Check if there is enough space on the current page
        if (yPos + finalImgHeight > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
        }

        pdf.addImage(imgData, 'JPEG', margin, yPos, finalImgWidth, finalImgHeight);
        
        yPos += finalImgHeight + 5; // Add some spacing between items

        // Reset style after processing
        row.removeAttribute('style');
    }

    // --- Footer ---
    const pageCount = pdf.internal.pages.length;
    for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.text(`Seite ${i} von ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
        pdf.text('© KI Holzbau-Planer - Nur für Planungszwecke', margin, pageHeight - 10);
    }

    pdf.save(`Holzbau-Plan_${buildingType}_${new Date().toISOString().slice(0,10)}.pdf`);
};

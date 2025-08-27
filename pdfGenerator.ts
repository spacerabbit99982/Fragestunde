
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { BuildingType } from './types';

export const generatePdf = async (
    content: HTMLDivElement,
    buildingType: BuildingType | null,
): Promise<void> => {
    if (!content) {
        throw new Error("Kein Inhaltselement für die PDF-Generierung bereitgestellt.");
    }
    
    // Temporarily hide the button itself to prevent it from appearing in the PDF
    const printButton = content.querySelector('.btn');
    if(printButton) (printButton as HTMLElement).style.visibility = 'hidden';

    try {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pdfWidth - margin * 2;
        const headerHeight = 25;
        const footerHeight = 20;

        let pageNumber = 1;
        let currentY = headerHeight;

        const addHeader = () => {
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Iten Holz GmbH, KI-Holzbau-Planer', margin, margin);
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'normal');
            pdf.text('041 835 14 04 | www.iten-holz.ch | info@iten-holz.ch', margin, margin + 5);
            pdf.setDrawColor(200);
            pdf.line(margin, margin + 8, pdfWidth - margin, margin + 8);
        };

        const addFooter = (page: number, total: number) => {
            const date = new Date().toLocaleDateString('de-CH');
            const footerText = `Seite ${page} / ${total}`;
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.text(date, margin, pdfHeight - margin + 5);
            pdf.text(footerText, pdfWidth - margin, pdfHeight - margin + 5, { align: 'right' });
        };

        const addElementAsImage = async (element: HTMLElement, x: number, y: number, maxWidth: number): Promise<number> => {
            const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const imgProps = pdf.getImageProperties(imgData);
            
            const aspect = imgProps.width / imgProps.height;
            let imgWidth = maxWidth;
            let imgHeight = imgWidth / aspect;

            pdf.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
            return imgHeight;
        };

        addHeader();
        
        const table = content.querySelector('.parts-table tbody');
        if (!table) throw new Error("Parts list table not found.");
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>(':scope > tr'));

        for (const row of rows) {
            // Estimate height by creating a temporary clone and rendering it
            const tempRowContainer = document.createElement('div');
            tempRowContainer.style.position = 'absolute';
            tempRowContainer.style.left = '-9999px';
            tempRowContainer.style.width = `${content.clientWidth}px`; // Use the on-screen width for accurate layout
            tempRowContainer.style.background = '#fff';
            
            const tempRow = row.cloneNode(true) as HTMLTableRowElement;
            // The SVG container needs a defined width to render correctly
            const drawingContainer = tempRow.querySelector<HTMLElement>('div[style*="width: 100%"]');
            if (drawingContainer) {
                // Approximate the width it will have in the PDF for a better height estimate
                const approxPdfDescWidthPx = (contentWidth * 0.85) * 3.78; // desc cell is ~85% of content width, convert mm to px
                drawingContainer.style.maxWidth = `${approxPdfDescWidthPx}px`;
            }

            tempRowContainer.appendChild(tempRow);
            document.body.appendChild(tempRowContainer);
            
            const canvas = await html2canvas(tempRow, { scale: 2, useCORS: true, logging: false });
            // Calculate height in mm based on the aspect ratio and the final PDF content width
            const rowHeightInMM = (canvas.height / canvas.width) * contentWidth;
            document.body.removeChild(tempRowContainer);

            // Check for page break
            if (currentY + rowHeightInMM > pdfHeight - footerHeight) {
                pdf.addPage();
                pageNumber++;
                currentY = headerHeight;
                addHeader();
            }
            
            // Add the actual row content as a single, clean image
            const addedHeight = await addElementAsImage(row, margin, currentY, contentWidth);
            currentY += addedHeight + 2; // Add 2mm padding below the item
        }

        // Add footers to all pages now that we know the total count
        for (let i = 1; i <= pageNumber; i++) {
            pdf.setPage(i);
            addFooter(i, pageNumber);
        }
        
        pdf.save(`Holzbauplan-${buildingType || 'Unbekannt'}.pdf`);
    
    } catch (err) {
        // Re-throw the error to be handled by the calling function
        throw err;
    } finally {
        // Restore visibility even if an error occurs
        if(printButton) (printButton as HTMLElement).style.visibility = 'visible';
    }
};

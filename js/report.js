// Report generation module
const Report = {
    // Get metadata from form fields
    getMetadata() {
        if (typeof Extraction !== 'undefined') {
            Extraction.syncCurrentCurveStateFromWorkspace();
        }
        const session = typeof Export !== 'undefined' && typeof Export.getCurrentExportSession === 'function'
            ? Export.getCurrentExportSession()
            : null;
        return {
            source: document.getElementById('studySource')?.value || '',
            study: document.getElementById('studyName')?.value || '',
            endpoint: document.getElementById('studyEndpoint')?.value || '',
            figure: document.getElementById('studyFigure')?.value || '',
            exportDate: new Date().toLocaleString(),
            calibration: {
                xMin: Calibration.values.xMin,
                xMax: Calibration.values.xMax,
                yMin: Calibration.values.yMin,
                yMax: Calibration.values.yMax
            },
            extraction: session ? {
                status: session.status,
                confidence: session.confidence,
                warnings: session.warnings || [],
                riskTable: session.riskTable || null
            } : null
        };
    },

    // Capture canvas as image data URL
    captureCanvas() {
        const canvas = document.getElementById('mainCanvas');
        return canvas.toDataURL('image/png');
    },

    // Generate CSV content for the report (uses Export module)
    generateCSVForReport() {
        return Export.generateCSV();
    },

    // Generate data table HTML
    generateDataTable() {
        const curves = Curves.getAll();
        if (curves.length === 0) return '<p>No data points captured.</p>';

        let html = '';

        curves.forEach(curve => {
            html += `<h3 style="color: ${curve.color}; margin-top: 20px;">${curve.name}</h3>`;

            // Show curve-level metadata if present
            const metaItems = [];
            if (curve.treatment) metaItems.push(`<strong>Treatment:</strong> ${curve.treatment}`);
            if (curve.population) metaItems.push(`<strong>Population:</strong> ${curve.population}`);
            if (curve.line) metaItems.push(`<strong>Line:</strong> ${curve.line}`);
            if (curve.n) metaItems.push(`<strong>N:</strong> ${curve.n}`);
            if (metaItems.length > 0) {
                html += `<p style="font-size: 0.9rem; color: #666; margin-bottom: 10px;">${metaItems.join(' | ')}</p>`;
            }

            html += `<table class="data-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>`;

            curve.points.forEach(point => {
                html += `<tr>
                    <td>${point.x.toFixed(4)}</td>
                    <td>${point.y.toFixed(4)}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            html += `<p><em>${curve.points.length} points</em></p>`;
        });

        return html;
    },

    generateRiskTableHTML() {
        const session = typeof Export !== 'undefined' && typeof Export.getCurrentExportSession === 'function'
            ? Export.getCurrentExportSession()
            : null;
        const riskTable = session?.riskTable;
        if (!riskTable || !riskTable.rows || riskTable.rows.length === 0) {
            return '<p>No numbers-at-risk table extracted.</p>';
        }

        const header = riskTable.timepoints.map(value => `<th>${value}</th>`).join('');
        const rows = riskTable.rows.map(row => `
            <tr>
                <th>${row.label}</th>
                ${row.values.map(value => `<td>${value}</td>`).join('')}
            </tr>
        `).join('');

        return `
            <p style="margin-bottom: 10px;">OCR confidence: ${(riskTable.confidence || 0).toFixed(2)}</p>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Group</th>
                        ${header}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    },

    // Generate full report HTML
    generateReportHTML() {
        const metadata = this.getMetadata();
        const canvasImage = this.captureCanvas();
        const dataTable = this.generateDataTable();
        const curves = Curves.getAll();
        const riskTableHTML = this.generateRiskTableHTML();

        const totalPoints = curves.reduce((sum, c) => sum + c.points.length, 0);
        const extractionWarnings = metadata.extraction?.warnings || [];

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Curve Digitization Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            border-bottom: 2px solid #2196F3;
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        .header h1 {
            color: #2196F3;
            font-size: 1.8rem;
        }
        .header p {
            color: #666;
            font-size: 0.9rem;
        }
        .metadata {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .metadata-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .metadata-item {
            padding: 5px 0;
        }
        .metadata-item label {
            font-weight: 600;
            color: #555;
            display: block;
            font-size: 0.8rem;
            text-transform: uppercase;
        }
        .metadata-item span {
            font-size: 1rem;
        }
        .figure-section {
            margin: 20px 0;
            page-break-inside: avoid;
        }
        .figure-section h2 {
            font-size: 1.2rem;
            margin-bottom: 10px;
            color: #333;
        }
        .figure-container {
            border: 1px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
        }
        .figure-container img {
            width: 100%;
            height: auto;
            display: block;
        }
        .data-section {
            margin: 20px 0;
        }
        .data-section h2 {
            font-size: 1.2rem;
            margin-bottom: 10px;
            color: #333;
        }
        .data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
            margin-bottom: 10px;
        }
        .data-table th, .data-table td {
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }
        .data-table th {
            background: #f0f0f0;
            font-weight: 600;
        }
        .data-table tr:nth-child(even) {
            background: #fafafa;
        }
        .summary {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .summary h3 {
            margin-bottom: 10px;
            color: #1976D2;
        }
        .calibration-info {
            font-size: 0.85rem;
            color: #666;
            margin-top: 10px;
        }
        .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            font-size: 0.8rem;
            color: #888;
            text-align: center;
        }
        .csv-section {
            margin: 20px 0;
            padding: 15px;
            background: #f9f9f9;
            border-radius: 8px;
            border: 1px solid #ddd;
        }
        .csv-section h2 {
            font-size: 1.2rem;
            margin-bottom: 10px;
        }
        .csv-section textarea {
            width: 100%;
            height: 200px;
            font-family: monospace;
            font-size: 0.8rem;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            resize: vertical;
            background: #fff;
        }
        .download-btn, .copy-btn {
            padding: 8px 16px;
            margin-right: 8px;
            margin-bottom: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        .download-btn {
            background: #2196F3;
            color: white;
        }
        .download-btn:hover {
            background: #1976D2;
        }
        .copy-btn {
            background: #e0e0e0;
            color: #333;
        }
        .copy-btn:hover {
            background: #d0d0d0;
        }
        @media print {
            body { padding: 0; }
            .no-print { display: none; }
            .csv-section { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Curve Digitization Report</h1>
        <p>Generated: ${metadata.exportDate}</p>
    </div>

    <div class="metadata">
        <div class="metadata-grid">
            <div class="metadata-item">
                <label>Source / Author</label>
                <span>${metadata.source || 'Not specified'}</span>
            </div>
            <div class="metadata-item">
                <label>Study / Trial</label>
                <span>${metadata.study || 'Not specified'}</span>
            </div>
            <div class="metadata-item">
                <label>Endpoint</label>
                <span>${metadata.endpoint || 'Not specified'}</span>
            </div>
            <div class="metadata-item">
                <label>Figure Reference</label>
                <span>${metadata.figure || 'Not specified'}</span>
            </div>
        </div>
    </div>

        <div class="summary">
            <h3>Summary</h3>
            <p><strong>Curves digitized:</strong> ${curves.length}</p>
            <p><strong>Total data points:</strong> ${totalPoints}</p>
            ${metadata.extraction ? `<p><strong>Extraction status:</strong> ${metadata.extraction.status || 'n/a'} | <strong>Confidence:</strong> ${(metadata.extraction.confidence || 0).toFixed(2)}</p>` : ''}
            <div class="calibration-info">
                <strong>Axis calibration:</strong>
                X: ${metadata.calibration.xMin} to ${metadata.calibration.xMax} |
                Y: ${metadata.calibration.yMin} to ${metadata.calibration.yMax}
            </div>
            ${extractionWarnings.length > 0 ? `<div class="calibration-info"><strong>Warnings:</strong> ${extractionWarnings.join(' | ')}</div>` : ''}
        </div>

    <div class="figure-section">
        <h2>Digitized Figure</h2>
        <div class="figure-container">
            <img src="${canvasImage}" alt="Digitized curve">
        </div>
    </div>

    <div class="data-section">
        <h2>Extracted Data</h2>
        ${dataTable}
    </div>

    <div class="data-section">
        <h2>Numbers at Risk</h2>
        ${riskTableHTML}
    </div>

    <div class="csv-section">
        <h2>CSV Export</h2>
        <p style="margin-bottom: 10px;">Copy the data below or use the download button:</p>
        <button onclick="downloadCSV()" class="download-btn">Download CSV</button>
        <button onclick="copyCSV()" class="copy-btn">Copy to Clipboard</button>
        <textarea id="csvData" readonly>${this.generateCSVForReport()}</textarea>
    </div>

    <div class="footer">
        <p>Generated using KM/CIF Curve Digitizer</p>
        <p>https://rphilip90.github.io/km-digitizer/</p>
    </div>

    <script>
        function downloadCSV() {
            const csvData = document.getElementById('csvData').value;
            const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'curve_data.csv';
            link.click();
            URL.revokeObjectURL(url);
        }

        function copyCSV() {
            const textarea = document.getElementById('csvData');
            textarea.select();
            document.execCommand('copy');
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);
        }
    </script>
</body>
</html>`;
    },

    // Download report as HTML file
    downloadReport() {
        const curves = Curves.getAll();
        if (curves.length === 0 || curves.every(c => c.points.length === 0)) {
            alert('No data to export. Please digitize some curves first.');
            return;
        }

        const html = this.generateReportHTML();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        // Create filename from metadata
        const source = document.getElementById('studySource')?.value || 'digitization';
        const safeName = source.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
        const date = new Date().toISOString().split('T')[0];
        const filename = `${safeName}_report_${date}.html`;

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
    }
};

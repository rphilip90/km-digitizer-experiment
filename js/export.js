// Export module - handles data export
const Export = {
    // Get study-level metadata from form
    getStudyMetadata() {
        return {
            source: document.getElementById('studySource')?.value || '',
            study: document.getElementById('studyName')?.value || '',
            endpoint: document.getElementById('studyEndpoint')?.value || '',
            figure: document.getElementById('studyFigure')?.value || '',
        };
    },

    // Escape CSV field (handle commas and quotes)
    escapeCSV(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    },

    // Build a current-session view from either semantic extraction or live workspace curves
    getCurrentExportSession() {
        const baseSession = typeof Extraction !== 'undefined'
            ? Extraction.cloneSession(Extraction.getCurrentSession())
            : null;
        const curves = Curves.getAll();

        if (!baseSession) {
            return {
                fileName: Canvas?.imageFileName || 'current-image',
                plotBounds: null,
                axes: Calibration.isComplete ? {
                    x: {
                        min: Calibration.values.xMin,
                        max: Calibration.values.xMax,
                        tickStep: Canvas.gridSpacingX,
                        confidence: 1
                    },
                    y: {
                        min: Calibration.values.yMin,
                        max: Calibration.values.yMax,
                        tickStep: Canvas.gridSpacingY,
                        confidence: 1
                    },
                    confidence: 1
                } : null,
                curves: [],
                riskTable: null,
                warnings: [],
                confidence: 0,
                status: 'queued'
            };
        }

        if (!baseSession.axes && Calibration.isComplete) {
            baseSession.axes = {
                x: {
                    min: Calibration.values.xMin,
                    max: Calibration.values.xMax,
                    tickStep: Canvas.gridSpacingX,
                    confidence: 1,
                    source: 'manual-calibration'
                },
                y: {
                    min: Calibration.values.yMin,
                    max: Calibration.values.yMax,
                    tickStep: Canvas.gridSpacingY,
                    confidence: 1,
                    source: 'manual-calibration'
                },
                confidence: 1
            };
        }

        if (!baseSession.plotBounds && Calibration.isComplete) {
            const bounds = AutoDetect.getCalibrationBounds(Calibration);
            if (bounds) {
                baseSession.plotBounds = bounds;
            }
        }

        baseSession.curves = curves.map((curve, index) => ({
            id: curve.id || `curve-${index + 1}`,
            name: curve.name || `Curve ${index + 1}`,
            color: curve.color,
            imageColor: curve.imageColor || curve.color,
            confidence: curve.extractedConfidence || (curve.source === 'semantic' ? 0.8 : 0.65),
            warnings: [...(curve.extractionWarnings || [])],
            stepPoints: curve.points.map(point => ({
                px: point.px,
                py: point.py,
                x: point.x,
                y: point.y,
                kind: point.kind || 'step',
                source: point.source || curve.source || 'manual'
            })),
            censorMarks: [...(curve.censorMarks || [])],
            source: curve.source || 'manual'
        }));

        return baseSession;
    },

    getSessionsForWorkbook() {
        if (typeof Extraction !== 'undefined') {
            Extraction.syncCurrentCurveStateFromWorkspace();
        }

        if (typeof Extraction !== 'undefined' && Extraction.hasBatchJobs()) {
            return Extraction.getBatchJobs()
                .filter(job => job.session)
                .map(job => job.id === Extraction.activeJobId ? this.getCurrentExportSession() : Extraction.cloneSession(job.session));
        }

        const session = this.getCurrentExportSession();
        return session ? [session] : [];
    },

    buildCurveRowsForSession(session) {
        const studyMeta = this.getStudyMetadata();
        const rows = [];

        (session.curves || []).forEach(curve => {
            (curve.stepPoints || []).forEach(point => {
                rows.push([
                    session.fileName || '',
                    studyMeta.source,
                    studyMeta.study,
                    studyMeta.endpoint,
                    studyMeta.figure,
                    curve.name,
                    curve.color,
                    curve.source || 'manual',
                    curve.confidence ?? '',
                    point.kind || 'step',
                    point.source || curve.source || 'manual',
                    parseFloat(Number(point.x).toFixed(4)),
                    parseFloat(Number(point.y).toFixed(4)),
                    parseFloat(Number(point.px).toFixed(2)),
                    parseFloat(Number(point.py).toFixed(2))
                ]);
            });
        });

        return rows;
    },

    buildAxisRowsForSession(session) {
        if (!session.axes) return [];
        return [[
            session.fileName || '',
            session.axes.x.min,
            session.axes.x.max,
            session.axes.x.tickStep ?? '',
            session.axes.x.confidence ?? '',
            session.axes.x.source || '',
            session.axes.y.min,
            session.axes.y.max,
            session.axes.y.tickStep ?? '',
            session.axes.y.confidence ?? '',
            session.axes.y.source || '',
            session.plotBounds?.left ?? '',
            session.plotBounds?.top ?? '',
            session.plotBounds?.right ?? '',
            session.plotBounds?.bottom ?? ''
        ]];
    },

    buildRiskRowsForSession(session) {
        if (!session.riskTable) return [];

        const rows = [];
        const header = ['File', 'Group', ...session.riskTable.timepoints.map(value => String(value))];
        rows.push(header);

        session.riskTable.rows.forEach(row => {
            rows.push([
                session.fileName || '',
                row.label,
                ...row.values.map(value => value ?? '')
            ]);
        });

        return rows;
    },

    buildBatchSummaryRows(sessions) {
        return sessions.map(session => [
            session.fileName || '',
            session.status || '',
            session.confidence ?? '',
            (session.curves || []).length,
            session.riskTable ? session.riskTable.rows.length : 0,
            (session.warnings || []).join(' | ')
        ]);
    },

    // Generate CSV content with compatibility-focused columns
    generateCSV() {
        const curves = Curves.getAll();
        if (curves.length === 0) return '';

        const studyMeta = this.getStudyMetadata();
        const headers = ['Source', 'Study', 'Endpoint', 'Figure', 'Curve', 'Treatment', 'Population', 'Line', 'N', 'Time', 'Value'];
        const rows = [headers.join(',')];

        curves.forEach(curve => {
            curve.points.forEach(point => {
                const row = [
                    this.escapeCSV(studyMeta.source),
                    this.escapeCSV(studyMeta.study),
                    this.escapeCSV(studyMeta.endpoint),
                    this.escapeCSV(studyMeta.figure),
                    this.escapeCSV(curve.name),
                    this.escapeCSV(curve.treatment),
                    this.escapeCSV(curve.population),
                    this.escapeCSV(curve.line),
                    this.escapeCSV(curve.n),
                    Number(point.x).toFixed(4),
                    Number(point.y).toFixed(4),
                ];
                rows.push(row.join(','));
            });
        });

        return rows.join('\n');
    },

    // Download as CSV file
    downloadCSV() {
        const csv = this.generateCSV();
        if (!csv) {
            alert('No data to export. Add some points first.');
            return;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const studyMeta = this.getStudyMetadata();
        const studyName = studyMeta.study || studyMeta.source || 'digitized';
        const safeName = studyName.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
        const date = new Date().toISOString().split('T')[0];
        const filename = `${safeName}_curves_${date}.csv`;

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
    },

    // Copy to clipboard
    async copyToClipboard() {
        const csv = this.generateCSV();
        if (!csv) {
            alert('No data to copy. Add some points first.');
            return;
        }

        try {
            await navigator.clipboard.writeText(csv);
            this.showCopyFeedback('Copied to clipboard!');
        } catch (err) {
            const textarea = document.createElement('textarea');
            textarea.value = csv;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showCopyFeedback('Copied to clipboard!');
        }
    },

    // Show copy feedback
    showCopyFeedback(message) {
        const btn = document.getElementById('copyBtn');
        if (!btn) return;
        const originalText = btn.textContent;
        btn.textContent = message;
        btn.disabled = true;
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    },

    // Download as Excel workbook with curves, axes, risk tables, and optional batch summary
    downloadExcel() {
        const sessions = this.getSessionsForWorkbook();
        const hasCurveData = sessions.some(session => (session.curves || []).some(curve => (curve.stepPoints || []).length > 0));
        if (!hasCurveData) {
            alert('No data to export. Add some points first.');
            return;
        }

        const wb = XLSX.utils.book_new();
        const studyMeta = this.getStudyMetadata();

        const curveHeaders = [
            'File', 'Source', 'Study', 'Endpoint', 'Figure', 'Curve', 'Color', 'Curve Source',
            'Curve Confidence', 'Point Type', 'Point Source', 'Time', 'Value', 'Pixel X', 'Pixel Y'
        ];
        const curveRows = [curveHeaders];
        sessions.forEach(session => {
            curveRows.push(...this.buildCurveRowsForSession(session));
        });
        const curveSheet = XLSX.utils.aoa_to_sheet(curveRows);
        curveSheet['!cols'] = [
            { wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 14 },
            { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
            { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, curveSheet, 'Curves');

        const axisHeaders = [
            'File', 'X Min', 'X Max', 'X Tick Step', 'X Confidence', 'X Source',
            'Y Min', 'Y Max', 'Y Tick Step', 'Y Confidence', 'Y Source',
            'Plot Left', 'Plot Top', 'Plot Right', 'Plot Bottom'
        ];
        const axisRows = [axisHeaders];
        sessions.forEach(session => {
            axisRows.push(...this.buildAxisRowsForSession(session));
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(axisRows), 'Axes');

        const riskSheetRows = [];
        sessions.forEach((session, index) => {
            const rows = this.buildRiskRowsForSession(session);
            if (rows.length === 0) return;
            if (riskSheetRows.length > 0) {
                riskSheetRows.push([]);
            }
            rows.forEach(row => riskSheetRows.push(row));
        });
        if (riskSheetRows.length > 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskSheetRows), 'RiskTable');
        }

        if (sessions.length > 1 || (typeof Extraction !== 'undefined' && Extraction.hasBatchJobs())) {
            const batchRows = [
                ['File', 'Status', 'Confidence', 'Curves', 'Risk Rows', 'Warnings'],
                ...this.buildBatchSummaryRows(sessions)
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(batchRows), 'BatchSummary');
        }

        const canvas = document.getElementById('mainCanvas');
        if (canvas && sessions.length === 1) {
            const imageData = canvas.toDataURL('image/png').split(',')[1];
            const figureData = [
                ['KM/CIF Curve Digitization Report'],
                [''],
                ['Source:', studyMeta.source],
                ['Study:', studyMeta.study],
                ['Endpoint:', studyMeta.endpoint],
                ['Figure:', studyMeta.figure],
                [''],
                ['Curves:', sessions[0].curves.length],
                ['Status:', sessions[0].status],
                ['Confidence:', sessions[0].confidence],
                ['Export Date:', new Date().toLocaleString()],
                [''],
                ['[Digitized figure image is embedded below]'],
            ];

            const figureSheet = XLSX.utils.aoa_to_sheet(figureData);
            figureSheet['!cols'] = [{ wch: 15 }, { wch: 40 }];

            if (!figureSheet['!images']) figureSheet['!images'] = [];
            figureSheet['!images'].push({
                name: 'digitized_figure.png',
                data: imageData,
                type: 'png',
                position: {
                    type: 'twoCellAnchor',
                    from: { col: 0, row: 13 },
                    to: { col: 8, row: 35 }
                }
            });

            XLSX.utils.book_append_sheet(wb, figureSheet, 'Figure');
        }

        const studyName = studyMeta.study || studyMeta.source || (sessions.length > 1 ? 'batch_digitized' : 'digitized');
        const safeName = studyName.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
        const date = new Date().toISOString().split('T')[0];
        const filename = `${safeName}_curves_${date}.xlsx`;

        XLSX.writeFile(wb, filename);
    }
};

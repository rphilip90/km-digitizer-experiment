// Semantic extraction and batch-processing module
const Extraction = {
    currentSession: null,
    jobs: [],
    activeJobId: null,
    processingBatch: false,
    dependencyPromises: {},
    tesseractWorker: null,

    init() {
        this.renderAll();
    },

    reset() {
        this.currentSession = null;
        this.jobs = [];
        this.activeJobId = null;
        this.processingBatch = false;
        this.renderAll();
    },

    createSession(meta = {}) {
        return {
            id: meta.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: meta.fileName || '',
            imageSrc: meta.imageSrc || '',
            imageSize: meta.imageSize || null,
            plotBounds: null,
            axes: null,
            curves: [],
            riskTable: null,
            status: meta.status || 'queued',
            warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
            confidence: typeof meta.confidence === 'number' ? meta.confidence : 0,
            processedAt: meta.processedAt || null
        };
    },

    cloneSession(session) {
        return session ? JSON.parse(JSON.stringify(session)) : null;
    },

    attachCurrentImage(meta = {}) {
        const nextFileName = meta.fileName || Canvas?.imageFileName || '';
        if (
            this.currentSession &&
            this.currentSession.fileName === nextFileName &&
            this.currentSession.imageSrc === meta.imageSrc
        ) {
            this.renderAll();
            return;
        }

        this.currentSession = this.createSession({
            fileName: nextFileName,
            imageSrc: meta.imageSrc || Canvas?.imageSrc || '',
            imageSize: Canvas?.image ? { width: Canvas.image.width, height: Canvas.image.height } : null,
            status: 'queued'
        });

        if (!this.activeJobId) {
            this.renderAll();
        }
    },

    getCurrentSession() {
        return this.currentSession;
    },

    getBatchJobs() {
        return this.jobs;
    },

    hasBatchJobs() {
        return this.jobs.length > 0;
    },

    getBatchSummaryCounts() {
        const counts = {
            total: this.jobs.length,
            approved: 0,
            needs_review: 0,
            failed: 0,
            processing: 0,
            queued: 0
        };

        this.jobs.forEach(job => {
            if (counts[job.status] !== undefined) {
                counts[job.status]++;
            }
        });

        return counts;
    },

    persistCurrentSessionToActiveJob() {
        if (!this.activeJobId || !this.currentSession) return;
        const job = this.jobs.find(item => item.id === this.activeJobId);
        if (!job) return;
        job.session = this.cloneSession(this.currentSession);
        job.status = this.currentSession.status;
        job.warnings = [...(this.currentSession.warnings || [])];
        job.confidence = this.currentSession.confidence || 0;
        this.renderBatchSummary();
        this.renderBatchJobs();
    },

    async autoExtractCurrent(options = {}) {
        if (!Canvas?.image || !Canvas?.imageData) {
            alert('Please load an image first.');
            return null;
        }

        this.updateExtractionStatus('processing', 'Running semantic extraction...');

        try {
            const session = await this.buildSessionFromLoadedCanvas(options);
            if (!session) {
                throw new Error('No extraction result was generated.');
            }

            const replaceExisting = Curves.getTotalPointCount() === 0
                ? true
                : confirm('Replace the current curves with the extracted semantic overlay?');

            if (replaceExisting && session.status !== 'failed') {
                this.applySessionToWorkspace(session, {
                    replaceExisting: true,
                    prompt: false,
                    updateCurrentSession: true
                });
            } else {
                this.currentSession = this.cloneSession(session);
                this.renderAll();
            }

            return session;
        } catch (error) {
            console.error(error);
            this.updateExtractionStatus('failed', `Extraction failed: ${error.message}`);
            alert(`Semantic extraction failed: ${error.message}`);
            return null;
        }
    },

    async processFolder(fileList, options = {}) {
        const files = Array.from(fileList || []).filter(file => file.type && file.type.startsWith('image/'));
        if (files.length === 0) {
            alert('No image files were found in that folder.');
            return;
        }

        this.jobs = files.map(file => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: file.name,
            file,
            imageSrc: '',
            status: 'queued',
            confidence: 0,
            warnings: [],
            session: null
        }));
        this.activeJobId = null;
        this.processingBatch = true;
        this.renderAll();

        for (const job of this.jobs) {
            job.status = 'processing';
            this.renderBatchSummary();
            this.renderBatchJobs();

            try {
                const result = await this.extractSessionFromFile(job.file, {
                    includeRiskTable: options.includeRiskTable !== false,
                    batchMode: true
                });

                job.imageSrc = result.imageSrc;
                job.session = result;
                job.status = result.status;
                job.confidence = result.confidence || 0;
                job.warnings = [...(result.warnings || [])];

                if (!this.activeJobId) {
                    this.activeJobId = job.id;
                    await this.reviewJob(job.id, { prompt: false });
                } else {
                    this.renderBatchSummary();
                    this.renderBatchJobs();
                }
            } catch (error) {
                console.error(error);
                job.status = 'failed';
                job.confidence = 0;
                job.warnings = [error.message];
                job.session = this.createSession({
                    fileName: job.fileName,
                    imageSrc: job.imageSrc,
                    warnings: [error.message],
                    status: 'failed'
                });
                this.renderBatchSummary();
                this.renderBatchJobs();
            }
        }

        this.processingBatch = false;
        this.renderAll();
    },

    async reviewJob(jobId, options = {}) {
        const job = this.jobs.find(item => item.id === jobId);
        if (!job || !job.session) return;

        this.activeJobId = jobId;
        this.currentSession = this.cloneSession(job.session);

        if (job.imageSrc) {
            await Canvas.loadImage(job.imageSrc, {
                fileName: job.fileName
            });
            if (typeof App !== 'undefined') {
                App.showMainContent();
            }
        }

        this.applySessionToWorkspace(job.session, {
            replaceExisting: true,
            prompt: options.prompt === true,
            updateCurrentSession: true
        });
    },

    approveJob(jobId) {
        const job = this.jobs.find(item => item.id === jobId);
        if (!job || !job.session) return;
        job.status = 'approved';
        job.session.status = 'approved';
        if (this.activeJobId === jobId && this.currentSession) {
            this.currentSession.status = 'approved';
        }
        this.renderAll();
    },

    approveCleanJobs() {
        this.jobs.forEach(job => {
            if (job.status === 'needs_review' || job.status === 'failed') return;
            job.status = 'approved';
            if (job.session) {
                job.session.status = 'approved';
            }
        });

        if (this.currentSession && this.currentSession.status !== 'failed') {
            this.currentSession.status = 'approved';
            this.persistCurrentSessionToActiveJob();
        }

        this.renderAll();
    },

    async extractSessionFromFile(file, options = {}) {
        const imageSrc = await this.readFileAsDataUrl(file);
        const image = await this.loadImageElement(imageSrc);
        const imageData = this.getImageDataFromImage(image);
        return this.extractSessionFromRenderable(image, imageData, file.name, imageSrc, options, false);
    },

    async buildSessionFromLoadedCanvas(options = {}) {
        return this.extractSessionFromRenderable(
            Canvas.image,
            Canvas.imageData,
            Canvas.imageFileName || 'loaded-image',
            Canvas.imageSrc || '',
            options,
            Calibration.isComplete
        );
    },

    async extractSessionFromRenderable(image, imageData, fileName, imageSrc, options = {}, useLoadedCalibration = false) {
        if (!image || !imageData) {
            throw new Error('No image data is available for extraction.');
        }

        const session = this.createSession({
            fileName,
            imageSrc,
            imageSize: { width: image.width, height: image.height },
            status: 'processing'
        });

        const plotBounds = useLoadedCalibration && Calibration.isComplete
            ? this.expandBounds(this.boundsFromCalibration(Calibration))
            : this.detectPlotBounds(imageData, image.width, image.height);

        if (!plotBounds) {
            session.status = 'failed';
            session.warnings.push('Could not detect a plausible plot region.');
            return session;
        }

        session.plotBounds = plotBounds;

        const axes = await this.detectAxes(image, imageData, plotBounds, useLoadedCalibration);
        session.axes = axes;
        session.warnings.push(...(axes.warnings || []));

        const curveResult = this.extractSemanticCurves(imageData, image.width, image.height, plotBounds, axes);
        session.curves = curveResult.curves;
        session.warnings.push(...curveResult.warnings);

        if (options.includeRiskTable) {
            const riskResult = await this.extractRiskTable(image, imageData, plotBounds);
            session.riskTable = riskResult.table;
            session.warnings.push(...riskResult.warnings);
        }

        session.confidence = this.calculateSessionConfidence(session);
        session.status = this.resolveSessionStatus(session);
        session.processedAt = new Date().toISOString();

        return session;
    },

    boundsFromCalibration(calibration) {
        const bounds = AutoDetect.getCalibrationBounds(calibration);
        if (!bounds) return null;
        return this.normalizeBounds(bounds.left, bounds.top, bounds.right, bounds.bottom);
    },

    normalizeBounds(left, top, right, bottom) {
        const nextLeft = Math.max(0, Math.round(Math.min(left, right)));
        const nextTop = Math.max(0, Math.round(Math.min(top, bottom)));
        const nextRight = Math.max(nextLeft + 1, Math.round(Math.max(left, right)));
        const nextBottom = Math.max(nextTop + 1, Math.round(Math.max(top, bottom)));
        return {
            left: nextLeft,
            top: nextTop,
            right: nextRight,
            bottom: nextBottom,
            width: nextRight - nextLeft,
            height: nextBottom - nextTop
        };
    },

    expandBounds(bounds, padding = 2) {
        if (!bounds) return null;
        return this.normalizeBounds(
            bounds.left - padding,
            bounds.top - padding,
            bounds.right + padding,
            bounds.bottom + padding
        );
    },

    detectPlotBounds(imageData, width, height) {
        const step = width > 1400 || height > 1400 ? 2 : 1;
        const rowStats = new Array(height).fill(null).map(() => ({ count: 0, span: 0, minX: Infinity, maxX: -Infinity }));
        const colStats = new Array(width).fill(0);

        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const color = AutoDetect.getPixelColor(imageData, x, y, width);
                if (!this.isSignalPixel(color)) continue;

                rowStats[y].count++;
                rowStats[y].minX = Math.min(rowStats[y].minX, x);
                rowStats[y].maxX = Math.max(rowStats[y].maxX, x);
                colStats[x]++;
            }
        }

        rowStats.forEach(row => {
            row.span = row.maxX >= row.minX ? row.maxX - row.minX : 0;
        });

        const rowRuns = [];
        const spanThreshold = width * 0.28;
        const countThreshold = Math.max(10, width * 0.012);
        let runStart = null;

        for (let y = 0; y < height; y++) {
            const row = rowStats[y];
            const qualifies = row.span >= spanThreshold && row.count >= countThreshold;

            if (qualifies && runStart === null) {
                runStart = y;
            } else if (!qualifies && runStart !== null) {
                rowRuns.push({ start: runStart, end: y - 1 });
                runStart = null;
            }
        }

        if (runStart !== null) {
            rowRuns.push({ start: runStart, end: height - 1 });
        }

        if (rowRuns.length === 0) {
            return this.detectPlotBoundsFromSignalBBox(imageData, width, height);
        }

        const scoredRuns = rowRuns
            .map(run => {
                let totalCount = 0;
                let totalSpan = 0;
                for (let y = run.start; y <= run.end; y++) {
                    totalCount += rowStats[y].count;
                    totalSpan += rowStats[y].span;
                }
                return {
                    ...run,
                    length: run.end - run.start + 1,
                    score: totalCount + totalSpan
                };
            })
            .sort((a, b) => b.score - a.score);

        const selectedRun = scoredRuns[0];
        const top = Math.max(0, selectedRun.start - 2);
        const bottom = Math.min(height - 1, selectedRun.end + 2);

        const bandColCounts = new Array(width).fill(0);
        for (let y = top; y <= bottom; y++) {
            for (let x = 0; x < width; x += step) {
                const color = AutoDetect.getPixelColor(imageData, x, y, width);
                if (this.isSignalPixel(color)) {
                    bandColCounts[x]++;
                }
            }
        }

        const dominantLeft = this.findDominantIndex(
            bandColCounts,
            0,
            Math.max(8, Math.floor(width * 0.35))
        );
        const dominantBottom = this.findDominantRowIndex(rowStats, Math.max(0, bottom - Math.floor(selectedRun.length * 0.2)), bottom);

        const columnThreshold = Math.max(8, selectedRun.length * 0.08);
        let left = dominantLeft;
        while (left > 0 && bandColCounts[left] > columnThreshold * 0.3) {
            left--;
        }
        left = Math.max(0, left - 1);

        let right = width - 1;
        for (let x = width - 1; x >= left + 20; x--) {
            if (bandColCounts[x] >= columnThreshold) {
                right = x;
                break;
            }
        }

        const bottomRow = Math.min(height - 1, dominantBottom >= 0 ? dominantBottom : bottom);
        const refined = this.normalizeBounds(left, top, right, bottomRow);
        return refined.width < 40 || refined.height < 40
            ? this.detectPlotBoundsFromSignalBBox(imageData, width, height)
            : refined;
    },

    detectPlotBoundsFromSignalBBox(imageData, width, height) {
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = AutoDetect.getPixelColor(imageData, x, y, width);
                if (!this.isSignalPixel(color)) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }

        if (maxX <= minX || maxY <= minY) {
            return null;
        }

        return this.expandBounds(this.normalizeBounds(minX, minY, maxX, maxY), 2);
    },

    findDominantIndex(values, start, end) {
        let bestIndex = start;
        let bestValue = -Infinity;
        for (let index = start; index <= end && index < values.length; index++) {
            if (values[index] > bestValue) {
                bestValue = values[index];
                bestIndex = index;
            }
        }
        return bestIndex;
    },

    findDominantRowIndex(rowStats, start, end) {
        let bestIndex = -1;
        let bestValue = -Infinity;
        for (let index = start; index <= end && index < rowStats.length; index++) {
            const row = rowStats[index];
            if (!row) continue;
            const score = row.count + row.span * 0.2;
            if (score > bestValue) {
                bestValue = score;
                bestIndex = index;
            }
        }
        return bestIndex;
    },

    isSignalPixel(color) {
        if (!color) return false;
        const brightness = (color.r + color.g + color.b) / 3;
        const saturation = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
        return brightness < 245 && !(brightness > 220 && saturation < 10);
    },

    async detectAxes(image, imageData, plotBounds, useLoadedCalibration = false) {
        if (useLoadedCalibration && Calibration.isComplete) {
            return {
                x: {
                    min: Calibration.values.xMin,
                    max: Calibration.values.xMax,
                    tickStep: this.safePositiveStep(Canvas?.gridSpacingX),
                    confidence: 1,
                    source: 'manual-calibration'
                },
                y: {
                    min: Calibration.values.yMin,
                    max: Calibration.values.yMax,
                    tickStep: this.safePositiveStep(Canvas?.gridSpacingY),
                    confidence: 1,
                    source: 'manual-calibration'
                },
                confidence: 1,
                warnings: []
            };
        }

        const warnings = [];
        const xCrop = this.normalizeBounds(
            plotBounds.left,
            plotBounds.bottom,
            plotBounds.right,
            Math.min(image.height - 1, plotBounds.bottom + Math.max(40, Math.round(image.height * 0.12)))
        );
        const yCrop = this.normalizeBounds(
            Math.max(0, plotBounds.left - Math.max(60, Math.round(image.width * 0.14))),
            plotBounds.top,
            plotBounds.left + Math.max(12, Math.round(plotBounds.width * 0.08)),
            plotBounds.bottom
        );

        let xAxis = null;
        let yAxis = null;

        try {
            xAxis = await this.extractXAxisFromOCR(image, xCrop);
        } catch (error) {
            warnings.push(`X-axis OCR fallback used: ${error.message}`);
        }

        try {
            yAxis = await this.extractYAxisFromOCR(image, yCrop);
        } catch (error) {
            warnings.push(`Y-axis OCR fallback used: ${error.message}`);
        }

        if (!xAxis) {
            xAxis = {
                min: this.readNumericInput('xMin', 0),
                max: this.readNumericInput('xMax', 60),
                tickStep: this.safePositiveStep(Canvas?.gridSpacingX) || null,
                confidence: 0.35,
                source: 'fallback-input'
            };
            warnings.push('X-axis values were not resolved confidently from OCR; using input defaults.');
        }

        if (!yAxis) {
            yAxis = {
                min: this.readNumericInput('yMin', 0),
                max: this.readNumericInput('yMax', 1),
                tickStep: this.safePositiveStep(Canvas?.gridSpacingY) || null,
                confidence: 0.35,
                source: 'fallback-input'
            };
            warnings.push('Y-axis values were not resolved confidently from OCR; using input defaults.');
        }

        return {
            x: xAxis,
            y: yAxis,
            confidence: (xAxis.confidence + yAxis.confidence) / 2,
            warnings
        };
    },

    readNumericInput(id, fallback) {
        const value = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(value) ? value : fallback;
    },

    safePositiveStep(value) {
        return Number.isFinite(value) && value > 0 ? value : null;
    },

    async extractXAxisFromOCR(image, cropBounds) {
        const result = await this.recognizeCrop(image, cropBounds, {
            tessedit_char_whitelist: '0123456789.-'
        });
        const words = this.normalizeOcrWords(result?.data, cropBounds).filter(word => word.numericValue !== null);
        const rows = this.clusterWordsByAxis(words, 'y', 14)
            .filter(row => row.length >= 2)
            .map(row => row.sort((a, b) => a.centerX - b.centerX));

        const bestRow = rows
            .filter(row => this.isMonotonicNumeric(row.map(word => word.numericValue)))
            .sort((a, b) => this.rowSpan(b) - this.rowSpan(a))[0];

        if (!bestRow) {
            return null;
        }

        const values = bestRow.map(word => word.numericValue);
        const diffs = [];
        for (let index = 1; index < values.length; index++) {
            const diff = values[index] - values[index - 1];
            if (diff > 0) diffs.push(diff);
        }

        return {
            min: values[0],
            max: values[values.length - 1],
            tickStep: this.median(diffs),
            confidence: this.average(bestRow.map(word => word.confidence)) * Math.min(1, bestRow.length / 4),
            source: 'ocr'
        };
    },

    async extractYAxisFromOCR(image, cropBounds) {
        const result = await this.recognizeCrop(image, cropBounds, {
            tessedit_char_whitelist: '0123456789.-'
        });
        const words = this.normalizeOcrWords(result?.data, cropBounds).filter(word => word.numericValue !== null);
        const columns = this.clusterWordsByAxis(words, 'x', 18)
            .filter(column => column.length >= 2)
            .map(column => column.sort((a, b) => b.centerY - a.centerY));

        const bestColumn = columns
            .filter(column => this.isMonotonicNumeric(column.map(word => word.numericValue)))
            .sort((a, b) => this.columnSpan(b) - this.columnSpan(a))[0];

        if (!bestColumn) {
            return null;
        }

        const values = bestColumn.map(word => word.numericValue);
        const diffs = [];
        for (let index = 1; index < values.length; index++) {
            const diff = values[index] - values[index - 1];
            if (diff > 0) diffs.push(diff);
        }

        return {
            min: values[0],
            max: values[values.length - 1],
            tickStep: this.median(diffs),
            confidence: this.average(bestColumn.map(word => word.confidence)) * Math.min(1, bestColumn.length / 4),
            source: 'ocr'
        };
    },

    isMonotonicNumeric(values) {
        if (!values || values.length < 2) return false;
        for (let index = 1; index < values.length; index++) {
            if (values[index] < values[index - 1]) {
                return false;
            }
        }
        return true;
    },

    rowSpan(row) {
        return row.length === 0 ? 0 : row[row.length - 1].centerX - row[0].centerX;
    },

    columnSpan(column) {
        return column.length === 0 ? 0 : column[0].centerY - column[column.length - 1].centerY;
    },

    clusterWordsByAxis(words, axis, threshold = 14) {
        const key = axis === 'x' ? 'centerX' : 'centerY';
        const sorted = [...words].sort((a, b) => a[key] - b[key]);
        const groups = [];

        sorted.forEach(word => {
            const currentGroup = groups[groups.length - 1];
            if (!currentGroup || Math.abs(word[key] - currentGroup.anchor) > threshold) {
                groups.push({
                    anchor: word[key],
                    words: [word]
                });
                return;
            }

            currentGroup.words.push(word);
            currentGroup.anchor = this.average(currentGroup.words.map(item => item[key]));
        });

        return groups.map(group => group.words);
    },

    normalizeOcrWords(data, offset = { left: 0, top: 0 }) {
        const words = Array.isArray(data?.words) ? data.words : [];
        return words.map(word => {
            const bbox = word.bbox || {};
            const x0 = bbox.x0 ?? bbox.left ?? 0;
            const y0 = bbox.y0 ?? bbox.top ?? 0;
            const x1 = bbox.x1 ?? bbox.right ?? x0;
            const y1 = bbox.y1 ?? bbox.bottom ?? y0;
            const text = String(word.text || '').trim();
            return {
                text,
                normalizedText: text.replace(/\s+/g, ' ').trim(),
                confidence: Math.max(0, Math.min(1, (word.confidence ?? word.conf ?? 0) / 100)),
                left: offset.left + x0,
                top: offset.top + y0,
                right: offset.left + x1,
                bottom: offset.top + y1,
                centerX: offset.left + (x0 + x1) / 2,
                centerY: offset.top + (y0 + y1) / 2,
                numericValue: this.parseNumericValue(text)
            };
        }).filter(word => word.text.length > 0);
    },

    parseNumericValue(text) {
        const normalized = String(text || '')
            .replace(/[Oo]/g, '0')
            .replace(/[Il]/g, '1')
            .replace(/[^0-9.\-]/g, '');
        if (!normalized || normalized === '-' || normalized === '.') {
            return null;
        }
        const value = parseFloat(normalized);
        return Number.isFinite(value) ? value : null;
    },

    extractSemanticCurves(imageData, width, height, plotBounds, axes) {
        const warnings = [];
        const bounds = {
            left: plotBounds.left,
            right: plotBounds.right,
            top: plotBounds.top,
            bottom: plotBounds.bottom
        };

        const colorCandidates = AutoDetect.findCurveColors(imageData, width, height, bounds);
        if (colorCandidates.length === 0) {
            return {
                curves: [],
                warnings: ['No candidate curve colors were detected inside the plot bounds.']
            };
        }

        const curves = [];
        let curveIndex = 1;

        colorCandidates.forEach(candidate => {
            const pixels = AutoDetect.findPixelsOfColor(imageData, width, height, candidate.color, bounds);
            if (pixels.length < AutoDetect.minPoints) return;

            const componentGroups = this.groupPixelsByComponent(pixels, 3);
            const largeGroups = componentGroups.filter(group => this.componentSpan(group).width >= plotBounds.width * 0.14);
            const censors = componentGroups.filter(group => group.length <= 18);

            if (largeGroups.length > 1) {
                warnings.push(`Color ${AutoDetect.rgbToHex(candidate.color)} appears in multiple large components; separated into ${largeGroups.length} curve candidates.`);
            }

            const curveGroups = largeGroups.length > 0 ? largeGroups : [pixels];

            curveGroups.forEach(groupPixels => {
                const rawPoints = AutoDetect.extractCurveFromPixels(groupPixels, width);
                const stepGeometry = this.reconstructStepGeometry(rawPoints);
                const stepPoints = stepGeometry.map(point => this.pixelPointToDataPoint(point, plotBounds, axes));
                const colorHex = AutoDetect.rgbToHex(candidate.color);
                const componentBounds = this.componentSpan(groupPixels);
                const confidence = this.estimateCurveConfidence(groupPixels, stepPoints, plotBounds);

                curves.push({
                    id: `curve-${curveIndex}`,
                    name: `Extracted Curve ${curveIndex}`,
                    color: colorHex,
                    imageColor: colorHex,
                    confidence,
                    warnings: confidence < 0.65 ? ['Curve confidence is low; review step positions manually.'] : [],
                    maskPixels: this.samplePixels(groupPixels, 320),
                    stepPoints,
                    censorMarks: this.extractCensorMarks(censors, stepGeometry, plotBounds, axes),
                    rawPointCount: rawPoints.length,
                    bounds: componentBounds
                });
                curveIndex++;
            });
        });

        if (curves.length === 0) {
            warnings.push('Curve colors were found, but no curve geometry was stable enough to reconstruct.');
        }

        return {
            curves: curves.sort((a, b) => b.confidence - a.confidence),
            warnings
        };
    },

    groupPixelsByComponent(pixels, gap = 3) {
        const pointSet = new Map();
        pixels.forEach(point => {
            pointSet.set(`${point.x},${point.y}`, point);
        });

        const visited = new Set();
        const groups = [];
        const offsets = [];
        for (let dx = -gap; dx <= gap; dx++) {
            for (let dy = -gap; dy <= gap; dy++) {
                if (dx === 0 && dy === 0) continue;
                offsets.push([dx, dy]);
            }
        }

        pixels.forEach(point => {
            const key = `${point.x},${point.y}`;
            if (visited.has(key)) return;

            const queue = [point];
            visited.add(key);
            const group = [];

            while (queue.length > 0) {
                const current = queue.pop();
                group.push(current);

                offsets.forEach(([dx, dy]) => {
                    const nextKey = `${current.x + dx},${current.y + dy}`;
                    if (visited.has(nextKey)) return;
                    const nextPoint = pointSet.get(nextKey);
                    if (!nextPoint) return;
                    visited.add(nextKey);
                    queue.push(nextPoint);
                });
            }

            groups.push(group);
        });

        return groups.sort((a, b) => b.length - a.length);
    },

    componentSpan(pixels) {
        const bounds = pixels.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxX: Math.max(acc.maxX, point.x),
            maxY: Math.max(acc.maxY, point.y)
        }), {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        });

        return {
            left: bounds.minX,
            top: bounds.minY,
            right: bounds.maxX,
            bottom: bounds.maxY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY
        };
    },

    reconstructStepGeometry(rawPoints) {
        if (!rawPoints || rawPoints.length === 0) return [];

        const sorted = rawPoints
            .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
            .sort((a, b) => a.x - b.x);

        const yTolerance = 2;
        const monotonic = [];
        let runningY = sorted[0].y;
        sorted.forEach(point => {
            if (point.y < runningY - yTolerance) {
                monotonic.push({ x: point.x, y: runningY });
                return;
            }
            runningY = Math.max(runningY, point.y);
            monotonic.push({ x: point.x, y: runningY });
        });

        const geometry = [];
        let previous = monotonic[0];

        geometry.push({
            x: previous.x,
            y: previous.y,
            kind: 'plateau-start'
        });

        for (let index = 1; index < monotonic.length; index++) {
            const current = monotonic[index];
            if (Math.abs(current.y - previous.y) <= yTolerance) {
                previous = current;
                continue;
            }

            geometry.push({
                x: previous.x,
                y: previous.y,
                kind: 'plateau-end'
            });
            geometry.push({
                x: previous.x,
                y: current.y,
                kind: 'drop'
            });
            geometry.push({
                x: previous.x,
                y: current.y,
                kind: 'plateau-start'
            });

            previous = current;
        }

        geometry.push({
            x: previous.x,
            y: previous.y,
            kind: 'plateau-end'
        });

        return geometry.filter((point, index, points) => {
            const previousPoint = points[index - 1];
            return !previousPoint || previousPoint.x !== point.x || previousPoint.y !== point.y || previousPoint.kind !== point.kind;
        });
    },

    estimateCurveConfidence(pixels, stepPoints, plotBounds) {
        if (!pixels || pixels.length === 0 || !stepPoints || stepPoints.length === 0) {
            return 0;
        }

        const span = this.componentSpan(pixels);
        const widthCoverage = Math.min(1, span.width / Math.max(1, plotBounds.width));
        const pointScore = Math.min(1, stepPoints.length / 18);
        const densityScore = Math.min(1, pixels.length / 300);
        return Math.max(0.2, Math.min(0.99, widthCoverage * 0.55 + pointScore * 0.25 + densityScore * 0.2));
    },

    extractCensorMarks(groups, stepGeometry, plotBounds, axes) {
        if (!groups || groups.length === 0) return [];
        const yThreshold = Math.max(8, Math.round(plotBounds.height * 0.04));

        return groups
            .map(group => {
                const bounds = this.componentSpan(group);
                const center = {
                    x: Math.round((bounds.left + bounds.right) / 2),
                    y: Math.round((bounds.top + bounds.bottom) / 2)
                };
                const nearestStep = stepGeometry.reduce((closest, point) => {
                    const distance = Math.abs(point.x - center.x) + Math.abs(point.y - center.y);
                    if (!closest || distance < closest.distance) {
                        return { point, distance };
                    }
                    return closest;
                }, null);

                if (!nearestStep || nearestStep.distance > yThreshold * 2) {
                    return null;
                }

                const dataPoint = this.pixelPointToDataPoint(center, plotBounds, axes);
                return {
                    px: center.x,
                    py: center.y,
                    x: dataPoint.x,
                    y: dataPoint.y
                };
            })
            .filter(Boolean);
    },

    samplePixels(pixels, maxCount = 300) {
        if (!pixels || pixels.length <= maxCount) return pixels;
        const step = Math.max(1, Math.floor(pixels.length / maxCount));
        const sampled = [];
        for (let index = 0; index < pixels.length; index += step) {
            sampled.push(pixels[index]);
        }
        return sampled;
    },

    pixelPointToDataPoint(point, plotBounds, axes) {
        const clampedX = Math.max(plotBounds.left, Math.min(plotBounds.right, point.x));
        const clampedY = Math.max(plotBounds.top, Math.min(plotBounds.bottom, point.y));
        const xRatio = (clampedX - plotBounds.left) / Math.max(1, plotBounds.width);
        const yRatio = (plotBounds.bottom - clampedY) / Math.max(1, plotBounds.height);
        const dataX = axes.x.min + xRatio * (axes.x.max - axes.x.min);
        const dataY = axes.y.min + yRatio * (axes.y.max - axes.y.min);
        return {
            px: clampedX,
            py: clampedY,
            x: parseFloat(dataX.toFixed(4)),
            y: parseFloat(dataY.toFixed(4)),
            kind: point.kind || 'step'
        };
    },

    async extractRiskTable(image, imageData, plotBounds) {
        const warnings = [];
        const bounds = this.detectRiskTableBounds(imageData, image.width, image.height, plotBounds);
        if (!bounds) {
            return {
                table: null,
                warnings: ['No plausible numbers-at-risk table region was detected below the plot.']
            };
        }

        let result;
        try {
            result = await this.recognizeCrop(image, bounds, {
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-'
            });
        } catch (error) {
            return {
                table: {
                    bounds,
                    timepoints: [],
                    rows: [],
                    confidence: 0,
                    warnings: [`Risk-table OCR failed: ${error.message}`]
                },
                warnings: [`Risk-table OCR failed: ${error.message}`]
            };
        }

        const words = this.normalizeOcrWords(result?.data, bounds);
        const rows = this.clusterWordsByAxis(words, 'y', 14)
            .map(row => row.sort((a, b) => a.centerX - b.centerX))
            .filter(row => row.length > 0);

        if (rows.length === 0) {
            warnings.push('Risk-table OCR returned no readable rows.');
            return {
                table: {
                    bounds,
                    timepoints: [],
                    rows: [],
                    confidence: 0,
                    warnings
                },
                warnings
            };
        }

        const columnCenters = this.inferColumnCenters(rows);
        const grid = rows.map(row => this.rowToCells(row, columnCenters));
        const headerIndex = this.findRiskTableHeaderRow(grid);
        const header = headerIndex >= 0 ? grid[headerIndex] : [];
        const timepoints = header.map(cell => this.parseNumericValue(cell.text)).filter(value => value !== null);

        const bodyRows = grid
            .filter((row, index) => index !== headerIndex)
            .map((row, index) => {
                const cells = row.map(cell => cell.text.trim());
                const labelCell = cells.find(cell => this.parseNumericValue(cell) === null) || `Row ${index + 1}`;
                const values = cells
                    .map(cell => this.parseNumericValue(cell))
                    .filter(value => value !== null);

                return {
                    label: labelCell,
                    values,
                    cells,
                    confidence: this.average(row.map(cell => cell.confidence))
                };
            })
            .filter(row => row.values.length > 0);

        if (bodyRows.length === 0) {
            warnings.push('Risk table was detected, but OCR did not yield usable numeric rows.');
        }

        const confidence = this.average(bodyRows.map(row => row.confidence));
        if (confidence < 0.65) {
            warnings.push('Risk-table OCR confidence is low; review the extracted cells manually.');
        }

        return {
            table: {
                bounds,
                timepoints,
                rows: bodyRows,
                confidence: Number.isFinite(confidence) ? confidence : 0,
                warnings
            },
            warnings
        };
    },

    detectRiskTableBounds(imageData, width, height, plotBounds) {
        const startY = Math.min(height - 1, plotBounds.bottom + Math.max(8, Math.round(plotBounds.height * 0.03)));
        if (startY >= height - 10) return null;

        const rowCounts = [];
        for (let y = startY; y < height; y++) {
            let count = 0;
            for (let x = 0; x < width; x++) {
                const color = AutoDetect.getPixelColor(imageData, x, y, width);
                if (this.isSignalPixel(color)) {
                    count++;
                }
            }
            rowCounts.push(count);
        }

        const threshold = Math.max(8, Math.round(width * 0.015));
        let bestRun = null;
        let runStart = null;

        for (let index = 0; index < rowCounts.length; index++) {
            const qualifies = rowCounts[index] >= threshold;
            if (qualifies && runStart === null) {
                runStart = index;
            } else if (!qualifies && runStart !== null) {
                const candidate = {
                    start: runStart,
                    end: index - 1
                };
                if (!bestRun || candidate.end - candidate.start > bestRun.end - bestRun.start) {
                    bestRun = candidate;
                }
                runStart = null;
            }
        }

        if (runStart !== null) {
            const candidate = { start: runStart, end: rowCounts.length - 1 };
            if (!bestRun || candidate.end - candidate.start > bestRun.end - bestRun.start) {
                bestRun = candidate;
            }
        }

        if (!bestRun || bestRun.end - bestRun.start < 10) {
            return null;
        }

        const top = startY + bestRun.start;
        const bottom = Math.min(height - 1, startY + bestRun.end);
        let minX = width;
        let maxX = 0;

        for (let y = top; y <= bottom; y++) {
            for (let x = 0; x < width; x++) {
                const color = AutoDetect.getPixelColor(imageData, x, y, width);
                if (!this.isSignalPixel(color)) continue;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
        }

        if (maxX <= minX) {
            return null;
        }

        return this.expandBounds(this.normalizeBounds(minX, top, maxX, bottom), 4);
    },

    inferColumnCenters(rows) {
        const centers = [];
        rows.forEach(row => {
            row.forEach(word => {
                const existing = centers.find(center => Math.abs(center.value - word.centerX) <= 24);
                if (existing) {
                    existing.values.push(word.centerX);
                    existing.value = this.average(existing.values);
                } else {
                    centers.push({
                        value: word.centerX,
                        values: [word.centerX]
                    });
                }
            });
        });

        return centers
            .map(center => center.value)
            .sort((a, b) => a - b);
    },

    rowToCells(row, columnCenters) {
        const cells = columnCenters.map(center => ({
            center,
            text: '',
            confidence: 0
        }));

        row.forEach(word => {
            const closestIndex = columnCenters.reduce((bestIndex, center, index) => {
                if (bestIndex === -1) return index;
                const bestDistance = Math.abs(word.centerX - columnCenters[bestIndex]);
                const distance = Math.abs(word.centerX - center);
                return distance < bestDistance ? index : bestIndex;
            }, -1);

            if (closestIndex === -1) return;
            const cell = cells[closestIndex];
            cell.text = cell.text ? `${cell.text} ${word.text}` : word.text;
            cell.confidence = Math.max(cell.confidence, word.confidence);
        });

        return cells;
    },

    findRiskTableHeaderRow(grid) {
        let bestIndex = -1;
        let bestScore = -Infinity;

        grid.forEach((row, index) => {
            const numericCount = row.filter(cell => this.parseNumericValue(cell.text) !== null).length;
            if (numericCount < 2) return;
            const score = numericCount * 10 + row.reduce((sum, cell) => sum + cell.confidence, 0);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        });

        return bestIndex;
    },

    calculateSessionConfidence(session) {
        const scores = [];
        if (session.axes) {
            scores.push(session.axes.confidence || 0);
        }
        if (session.curves && session.curves.length > 0) {
            scores.push(this.average(session.curves.map(curve => curve.confidence || 0)));
        } else {
            scores.push(0);
        }
        if (session.riskTable) {
            scores.push(session.riskTable.confidence || 0);
        }
        return Number.isFinite(this.average(scores)) ? this.average(scores) : 0;
    },

    resolveSessionStatus(session) {
        if (!session.curves || session.curves.length === 0) {
            return 'failed';
        }
        if (session.warnings.length > 0 || (session.confidence || 0) < 0.72) {
            return 'needs_review';
        }
        return 'approved';
    },

    applySessionToWorkspace(session, options = {}) {
        if (!session) return;

        const nextSession = this.cloneSession(session);
        if (options.updateCurrentSession !== false) {
            this.currentSession = nextSession;
        }

        if (nextSession.plotBounds && nextSession.axes && typeof Calibration.applyDetectedCalibration === 'function') {
            Calibration.applyDetectedCalibration(nextSession.plotBounds, nextSession.axes);
        }

        const shouldReplace = options.replaceExisting !== false;
        const shouldPrompt = options.prompt === true;
        const hasExistingCurves = Curves.getAll().length > 0 && Curves.getTotalPointCount() > 0;
        const canImportCurves = nextSession.curves && nextSession.curves.length > 0;

        if (canImportCurves && shouldReplace) {
            if (!shouldPrompt || !hasExistingCurves || confirm('Replace the current curve list with the extracted semantic curves?')) {
                Curves.clearAll();

                nextSession.curves.forEach(curveSummary => {
                    const curve = Curves.create(curveSummary.name, curveSummary.color, {
                        imageColor: curveSummary.imageColor,
                        confidence: curveSummary.confidence
                    });

                    curve.extractedConfidence = curveSummary.confidence;
                    curve.extractionWarnings = [...(curveSummary.warnings || [])];
                    curve.maskPixels = [...(curveSummary.maskPixels || [])];
                    curve.stepPoints = [...(curveSummary.stepPoints || [])];
                    curve.censorMarks = [...(curveSummary.censorMarks || [])];
                    curve.source = 'semantic';

                    curveSummary.stepPoints.forEach(point => {
                        Curves.addPoint(point.px, point.py, point.x, point.y, {
                            source: 'semantic',
                            kind: point.kind || 'step'
                        });
                    });
                });

                if (typeof App !== 'undefined' && typeof App.saveState === 'function') {
                    App.saveState();
                }
            }
        }

        if (Canvas?.clearInteractionGuides) {
            Canvas.clearInteractionGuides();
        }
        if (Canvas?.draw) {
            Canvas.draw();
        }

        this.persistCurrentSessionToActiveJob();
        this.renderAll();
    },

    snapshotCurvesFromWorkspace() {
        return Curves.getAll().map((curve, index) => ({
            id: curve.id || `workspace-curve-${index + 1}`,
            name: curve.name || `Curve ${index + 1}`,
            color: curve.color,
            imageColor: curve.imageColor || curve.color,
            confidence: curve.extractedConfidence || (curve.source === 'semantic' ? 0.8 : 0.65),
            warnings: [...(curve.extractionWarnings || [])],
            maskPixels: [...(curve.maskPixels || [])],
            stepPoints: curve.points.map(point => ({
                px: point.px,
                py: point.py,
                x: point.x,
                y: point.y,
                kind: point.kind || 'step'
            })),
            censorMarks: [...(curve.censorMarks || [])],
            source: curve.source || 'manual'
        }));
    },

    syncCurrentCurveStateFromWorkspace() {
        if (!this.currentSession) return;
        const liveCurves = this.snapshotCurvesFromWorkspace();
        if (liveCurves.length === 0) return;
        this.currentSession.curves = liveCurves;
        this.currentSession.confidence = this.calculateSessionConfidence(this.currentSession);
        if (this.currentSession.status !== 'failed') {
            this.currentSession.status = this.resolveSessionStatus(this.currentSession);
        }
        this.persistCurrentSessionToActiveJob();
        this.renderExtractionSummary();
    },

    drawOverlay(canvasApi) {
        const session = this.currentSession;
        if (!session || !session.plotBounds || !canvasApi?.ctx || !canvasApi?.image) return;

        const ctx = canvasApi.ctx;
        const plot = session.plotBounds;
        const left = plot.left * canvasApi.scale + canvasApi.offsetX;
        const top = plot.top * canvasApi.scale + canvasApi.offsetY;
        const width = plot.width * canvasApi.scale;
        const height = plot.height * canvasApi.scale;

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 121, 107, 0.88)';
        ctx.setLineDash([8, 5]);
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 121, 107, 0.92)';
        ctx.font = '12px sans-serif';
        ctx.fillText(`Plot (${Math.round(plot.width)} x ${Math.round(plot.height)})`, left + 8, top + 16);
        ctx.restore();

        if (session.riskTable?.bounds) {
            const risk = session.riskTable.bounds;
            ctx.save();
            ctx.strokeStyle = 'rgba(123, 31, 162, 0.85)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(
                risk.left * canvasApi.scale + canvasApi.offsetX,
                risk.top * canvasApi.scale + canvasApi.offsetY,
                risk.width * canvasApi.scale,
                risk.height * canvasApi.scale
            );
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(123, 31, 162, 0.92)';
            ctx.fillText('Risk table OCR', risk.left * canvasApi.scale + canvasApi.offsetX + 8, risk.top * canvasApi.scale + canvasApi.offsetY + 16);
            ctx.restore();
        }

        session.curves.forEach(curve => {
            const stepPoints = curve.stepPoints || [];
            const censorMarks = curve.censorMarks || [];
            ctx.save();
            ctx.strokeStyle = curve.color;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;

            if (stepPoints.length > 1) {
                ctx.beginPath();
                stepPoints.forEach((point, index) => {
                    const x = point.px * canvasApi.scale + canvasApi.offsetX;
                    const y = point.py * canvasApi.scale + canvasApi.offsetY;
                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.stroke();
            }

            censorMarks.forEach(mark => {
                const x = mark.px * canvasApi.scale + canvasApi.offsetX;
                const y = mark.py * canvasApi.scale + canvasApi.offsetY;
                ctx.beginPath();
                ctx.moveTo(x - 5, y);
                ctx.lineTo(x + 5, y);
                ctx.moveTo(x, y - 5);
                ctx.lineTo(x, y + 5);
                ctx.stroke();
            });

            ctx.restore();
        });
    },

    updateExtractionStatus(status, text) {
        const statusEl = document.getElementById('extractionStatus');
        if (!statusEl) return;

        statusEl.className = `extraction-status ${status || 'idle'}`;
        statusEl.innerHTML = `
            <span class="status-dot ${status === 'approved' ? 'complete' : 'pending'}"></span>
            <span>${text}</span>
        `;
    },

    renderAll() {
        this.renderExtractionSummary();
        this.renderRiskTable();
        this.renderBatchSummary();
        this.renderBatchJobs();
    },

    renderExtractionSummary() {
        const statusEl = document.getElementById('extractionStatus');
        const summaryEl = document.getElementById('extractionSummary');
        if (!statusEl || !summaryEl) return;

        const session = this.currentSession;
        if (!session) {
            this.updateExtractionStatus('idle', 'No extraction run yet');
            summaryEl.className = 'extraction-summary empty';
            summaryEl.textContent = 'Load an image, then run semantic extraction or a folder batch.';
            return;
        }

        const label = session.status === 'processing'
            ? 'Extraction running...'
            : session.status === 'approved'
                ? 'Extraction approved'
                : session.status === 'needs_review'
                    ? 'Extraction needs review'
                    : session.status === 'failed'
                        ? 'Extraction failed'
                        : 'Ready for extraction';
        this.updateExtractionStatus(session.status, label);

        const warnings = session.warnings || [];
        const boundsText = session.plotBounds
            ? `${session.plotBounds.left},${session.plotBounds.top} to ${session.plotBounds.right},${session.plotBounds.bottom}`
            : 'Not detected';
        const axesText = session.axes
            ? `X ${session.axes.x.min} to ${session.axes.x.max} | Y ${session.axes.y.min} to ${session.axes.y.max}`
            : 'Not detected';
        const curvesText = session.curves?.length
            ? `${session.curves.length} curve(s) | ${session.curves.reduce((sum, curve) => sum + curve.stepPoints.length, 0)} step vertices`
            : 'No curves extracted';
        const riskText = session.riskTable
            ? `${session.riskTable.rows.length} row(s) | ${session.riskTable.timepoints.length} timepoint(s)`
            : 'No risk table';

        const warningMarkup = warnings.length === 0
            ? ''
            : `<div class="warning-list">${warnings.slice(0, 4).map(item => `<div class="warning-item">${item}</div>`).join('')}</div>`;

        const curvePills = session.curves?.length
            ? `<div class="curve-meta"><strong>Curves</strong><div class="curve-pill-row">${session.curves.map(curve => `
                <span class="curve-pill">
                    <span class="curve-pill-dot" style="background:${curve.color}"></span>
                    ${curve.name} ${(curve.confidence || 0).toFixed(2)}
                </span>
            `).join('')}</div></div>`
            : '';

        summaryEl.className = 'extraction-summary';
        summaryEl.innerHTML = `
            <div class="summary-grid">
                <div class="summary-chip"><strong>File</strong>${session.fileName || 'Current image'}</div>
                <div class="summary-chip"><strong>Confidence</strong>${(session.confidence || 0).toFixed(2)}</div>
                <div class="summary-chip"><strong>Plot Bounds</strong>${boundsText}</div>
                <div class="summary-chip"><strong>Axes</strong>${axesText}</div>
                <div class="summary-chip"><strong>Curves</strong>${curvesText}</div>
                <div class="summary-chip"><strong>Risk Table</strong>${riskText}</div>
            </div>
            ${curvePills}
            ${warningMarkup}
        `;
    },

    renderRiskTable() {
        const statusEl = document.getElementById('riskTableStatus');
        const warningsEl = document.getElementById('riskTableWarnings');
        const editorEl = document.getElementById('riskTableEditor');
        if (!statusEl || !warningsEl || !editorEl) return;

        const table = this.currentSession?.riskTable;
        if (!table) {
            statusEl.className = 'risk-table-status empty';
            statusEl.textContent = 'No risk table extracted.';
            warningsEl.innerHTML = '';
            editorEl.className = 'risk-table-editor empty';
            editorEl.textContent = 'Run "Auto-extract KM + Risk Table" to populate this review grid.';
            return;
        }

        const badgeClass = (table.confidence || 0) >= 0.7 ? 'good' : 'low';
        statusEl.className = 'risk-table-status';
        statusEl.innerHTML = `
            <div class="risk-table-meta">
                <span class="risk-table-badge ${badgeClass}">Confidence ${(table.confidence || 0).toFixed(2)}</span>
                <span class="risk-table-badge">${table.rows.length} rows</span>
                <span class="risk-table-badge">${table.timepoints.length} timepoints</span>
            </div>
        `;

        warningsEl.innerHTML = (table.warnings || [])
            .map(item => `<div class="warning-item">${item}</div>`)
            .join('');

        const headerCells = table.timepoints.length > 0
            ? table.timepoints.map((value, index) => `
                <th><input type="text" data-role="timepoint" data-index="${index}" value="${this.escapeAttribute(value)}"></th>
            `).join('')
            : '<th>No timepoints detected</th>';

        const bodyRows = table.rows.map((row, rowIndex) => `
            <tr>
                <th><input type="text" data-role="row-label" data-row="${rowIndex}" value="${this.escapeAttribute(row.label)}"></th>
                ${row.values.map((value, colIndex) => `
                    <td><input type="text" data-role="cell" data-row="${rowIndex}" data-col="${colIndex}" value="${this.escapeAttribute(value)}"></td>
                `).join('')}
            </tr>
        `).join('');

        editorEl.className = 'risk-table-editor';
        editorEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Group</th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        `;

        editorEl.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', event => {
                this.updateRiskTableCell(event.target);
            });
        });
    },

    updateRiskTableCell(input) {
        if (!this.currentSession?.riskTable) return;
        const table = this.currentSession.riskTable;
        const role = input.dataset.role;

        if (role === 'timepoint') {
            const index = parseInt(input.dataset.index, 10);
            table.timepoints[index] = input.value;
        } else if (role === 'row-label') {
            const rowIndex = parseInt(input.dataset.row, 10);
            if (table.rows[rowIndex]) {
                table.rows[rowIndex].label = input.value;
            }
        } else if (role === 'cell') {
            const rowIndex = parseInt(input.dataset.row, 10);
            const colIndex = parseInt(input.dataset.col, 10);
            const parsed = this.parseNumericValue(input.value);
            if (table.rows[rowIndex]) {
                table.rows[rowIndex].values[colIndex] = parsed !== null ? parsed : input.value;
            }
        }

        this.persistCurrentSessionToActiveJob();
    },

    renderBatchSummary() {
        const summaryEl = document.getElementById('batchSummary');
        const approveBtn = document.getElementById('approveCleanBtn');
        const exportBtnPanel = document.getElementById('exportWorkbookBtnPanel');
        const exportBtnFooter = document.getElementById('exportWorkbookBtn');
        if (!summaryEl) return;

        if (this.jobs.length === 0) {
            summaryEl.className = 'batch-summary empty';
            summaryEl.textContent = 'No folder loaded.';
            if (approveBtn) approveBtn.disabled = true;
            if (exportBtnPanel) exportBtnPanel.disabled = !this.currentSession;
            if (exportBtnFooter) exportBtnFooter.disabled = !this.currentSession;
            return;
        }

        const counts = this.getBatchSummaryCounts();
        summaryEl.className = 'batch-summary';
        summaryEl.innerHTML = `
            <strong>${counts.total}</strong> files |
            <strong>${counts.approved}</strong> approved |
            <strong>${counts.needs_review}</strong> needs review |
            <strong>${counts.failed}</strong> failed
            ${this.processingBatch ? ' | Processing...' : ''}
        `;

        if (approveBtn) {
            approveBtn.disabled = counts.total === 0 || (counts.approved === counts.total);
        }
        if (exportBtnPanel) {
            exportBtnPanel.disabled = counts.total === 0 && !this.currentSession;
        }
        if (exportBtnFooter) {
            exportBtnFooter.disabled = counts.total === 0 && !this.currentSession;
        }
    },

    renderBatchJobs() {
        const container = document.getElementById('batchJobs');
        if (!container) return;

        if (this.jobs.length === 0) {
            container.className = 'batch-jobs empty';
            container.textContent = 'Use "Browse Folder" or "Batch Folder Processing" to build a review queue.';
            return;
        }

        container.className = 'batch-jobs';
        container.innerHTML = this.jobs.map(job => {
            const warningCount = job.warnings?.length || 0;
            return `
                <div class="batch-job ${job.id === this.activeJobId ? 'active' : ''}">
                    <div class="batch-job-header">
                        <strong>${job.fileName}</strong>
                        <span class="job-status-badge ${job.status}">${job.status.replace('_', ' ')}</span>
                    </div>
                    <div class="batch-job-meta">
                        <span>Confidence ${(job.confidence || 0).toFixed(2)}</span>
                        <span>${warningCount} warning(s)</span>
                    </div>
                    ${warningCount > 0 ? `<div class="batch-job-warnings">${job.warnings.slice(0, 2).join(' | ')}</div>` : ''}
                    <div class="batch-job-actions">
                        <button class="btn-small" data-action="review" data-id="${job.id}" ${job.session ? '' : 'disabled'}>Review</button>
                        <button class="btn-small" data-action="approve" data-id="${job.id}" ${job.session ? '' : 'disabled'}>Approve</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('button[data-action]').forEach(button => {
            button.addEventListener('click', async event => {
                const action = event.currentTarget.dataset.action;
                const jobId = event.currentTarget.dataset.id;
                if (action === 'review') {
                    await this.reviewJob(jobId, { prompt: false });
                } else if (action === 'approve') {
                    this.approveJob(jobId);
                }
            });
        });
    },

    escapeAttribute(value) {
        return String(value ?? '').replace(/"/g, '&quot;');
    },

    average(values) {
        if (!values || values.length === 0) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    },

    median(values) {
        if (!values || values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        }
        return sorted[middle];
    },

    async recognizeCrop(image, bounds, parameters = {}) {
        const cropCanvas = this.createCropCanvas(image, bounds);
        const processedCanvas = await this.preprocessCanvasForOCR(cropCanvas);
        const worker = await this.ensureTesseractWorker();

        if (worker?.setParameters) {
            await worker.setParameters(parameters);
        }

        if (worker?.recognize) {
            return worker.recognize(processedCanvas);
        }

        if (window.Tesseract?.recognize) {
            return window.Tesseract.recognize(processedCanvas, 'eng');
        }

        throw new Error('Tesseract.js is not available.');
    },

    async ensureTesseractWorker() {
        if (this.tesseractWorker) {
            return this.tesseractWorker;
        }

        await this.ensureScript(
            'tesseract',
            'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
            () => !!window.Tesseract
        );

        if (!window.Tesseract) {
            throw new Error('Tesseract.js could not be loaded.');
        }

        if (window.Tesseract.createWorker) {
            this.tesseractWorker = await window.Tesseract.createWorker('eng');
            return this.tesseractWorker;
        }

        return window.Tesseract;
    },

    async preprocessCanvasForOCR(canvas) {
        try {
            await this.ensureScript(
                'opencv',
                'https://docs.opencv.org/4.x/opencv.js',
                () => !!(window.cv && window.cv.Mat)
            );
        } catch (error) {
            return canvas;
        }

        if (!window.cv?.Mat || !window.cv.imread || !window.cv.imshow) {
            return canvas;
        }

        const processed = document.createElement('canvas');
        processed.width = canvas.width;
        processed.height = canvas.height;

        const src = window.cv.imread(canvas);
        const gray = new window.cv.Mat();
        const thresh = new window.cv.Mat();

        try {
            window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
            window.cv.threshold(gray, thresh, 0, 255, window.cv.THRESH_BINARY + window.cv.THRESH_OTSU);
            window.cv.imshow(processed, thresh);
            return processed;
        } catch (error) {
            return canvas;
        } finally {
            src.delete();
            gray.delete();
            thresh.delete();
        }
    },

    ensureScript(key, src, readyCheck) {
        if (readyCheck()) {
            return Promise.resolve();
        }

        if (this.dependencyPromises[key]) {
            return this.dependencyPromises[key];
        }

        this.dependencyPromises[key] = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-dependency="${key}"]`);
            if (existing) {
                this.waitForCondition(readyCheck, 15000).then(resolve).catch(reject);
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.dependency = key;
            script.onload = () => {
                this.waitForCondition(readyCheck, 15000).then(resolve).catch(reject);
            };
            script.onerror = () => reject(new Error(`Could not load dependency: ${src}`));
            document.head.appendChild(script);
        });

        return this.dependencyPromises[key];
    },

    waitForCondition(check, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = () => {
                if (check()) {
                    resolve();
                    return;
                }
                if (Date.now() - started > timeoutMs) {
                    reject(new Error('Timed out waiting for browser dependency.'));
                    return;
                }
                setTimeout(poll, 100);
            };
            poll();
        });
    },

    createCropCanvas(image, bounds) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bounds.width));
        canvas.height = Math.max(1, Math.round(bounds.height));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(
            image,
            bounds.left,
            bounds.top,
            bounds.width,
            bounds.height,
            0,
            0,
            bounds.width,
            bounds.height
        );
        return canvas;
    },

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    loadImageElement(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
        });
    },

    getImageDataFromImage(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height);
    }
};

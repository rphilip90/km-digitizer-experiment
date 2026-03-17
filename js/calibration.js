// Calibration module - handles axis calibration
const Calibration = {
    // Calibration state
    isCalibrating: false,
    calibrationStep: 0,
    points: {
        xMin: null, // pixel position for x-axis minimum
        xMax: null, // pixel position for x-axis maximum
        yMin: null, // pixel position for y-axis minimum
        yMax: null, // pixel position for y-axis maximum
    },
    values: {
        xMin: 0,
        xMax: 60,
        yMin: 0,
        yMax: 1,
    },
    isComplete: false,

    // Calibration steps
    steps: [
        { key: 'xMin', label: 'Click on X-axis MINIMUM (left origin)' },
        { key: 'xMax', label: 'Click on X-axis MAXIMUM (right end)' },
        { key: 'yMin', label: 'Click on Y-axis MINIMUM (bottom origin)' },
        { key: 'yMax', label: 'Click on Y-axis MAXIMUM (top end)' },
    ],

    // Start calibration process
    start() {
        // Read values from inputs
        this.values.xMin = parseFloat(document.getElementById('xMin').value) || 0;
        this.values.xMax = parseFloat(document.getElementById('xMax').value) || 60;
        this.values.yMin = parseFloat(document.getElementById('yMin').value) || 0;
        this.values.yMax = parseFloat(document.getElementById('yMax').value) || 1;

        this.isCalibrating = true;
        this.calibrationStep = 0;
        this.isComplete = false;
        this.points = { xMin: null, xMax: null, yMin: null, yMax: null };

        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }

        this.updateUI();
        this.updateInstructions();
    },

    // Handle click during calibration
    handleClick(x, y) {
        if (!this.isCalibrating) return false;

        const step = this.steps[this.calibrationStep];
        this.points[step.key] = { x, y };

        this.calibrationStep++;

        if (this.calibrationStep >= this.steps.length) {
            this.complete();
        } else {
            this.updateInstructions();
        }

        return true;
    },

    // Complete calibration
    complete() {
        this.isCalibrating = false;
        this.isComplete = true;
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        this.updateUI();
        this.updateInstructions();
    },

    // Clear calibration
    clear() {
        this.isCalibrating = false;
        this.calibrationStep = 0;
        this.isComplete = false;
        this.points = { xMin: null, xMax: null, yMin: null, yMax: null };
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        this.updateUI();
        this.updateInstructions();
    },

    // Apply an automatically detected plot box and axis values
    applyDetectedCalibration(plotBounds, axes) {
        if (!plotBounds || !axes?.x || !axes?.y) return;

        this.isCalibrating = false;
        this.calibrationStep = 0;
        this.isComplete = true;
        this.points = {
            xMin: { x: plotBounds.left, y: plotBounds.bottom },
            xMax: { x: plotBounds.right, y: plotBounds.bottom },
            yMin: { x: plotBounds.left, y: plotBounds.bottom },
            yMax: { x: plotBounds.left, y: plotBounds.top }
        };
        this.values = {
            xMin: axes.x.min,
            xMax: axes.x.max,
            yMin: axes.y.min,
            yMax: axes.y.max
        };

        const xMinInput = document.getElementById('xMin');
        const xMaxInput = document.getElementById('xMax');
        const yMinInput = document.getElementById('yMin');
        const yMaxInput = document.getElementById('yMax');

        if (xMinInput) xMinInput.value = axes.x.min;
        if (xMaxInput) xMaxInput.value = axes.x.max;
        if (yMinInput) yMinInput.value = axes.y.min;
        if (yMaxInput) yMaxInput.value = axes.y.max;

        if (axes.x.tickStep && typeof Canvas !== 'undefined') {
            Canvas.gridSpacingX = axes.x.tickStep;
            const gridXInput = document.getElementById('gridSpacingX');
            if (gridXInput) gridXInput.value = axes.x.tickStep;
        }

        if (axes.y.tickStep && typeof Canvas !== 'undefined') {
            Canvas.gridSpacingY = axes.y.tickStep;
            const gridYInput = document.getElementById('gridSpacingY');
            if (gridYInput) gridYInput.value = axes.y.tickStep;
        }

        this.updateUI();
        this.updateInstructions();
    },

    // Convert pixel coordinates to data coordinates
    pixelToData(px, py) {
        if (!this.isComplete) return null;

        // Calculate x value
        const xPixelRange = this.points.xMax.x - this.points.xMin.x;
        const xDataRange = this.values.xMax - this.values.xMin;
        const x = this.values.xMin + ((px - this.points.xMin.x) / xPixelRange) * xDataRange;

        // Calculate y value (note: pixel y increases downward, data y increases upward)
        const yPixelRange = this.points.yMin.y - this.points.yMax.y; // yMin.y > yMax.y in pixels
        const yDataRange = this.values.yMax - this.values.yMin;
        const y = this.values.yMin + ((this.points.yMin.y - py) / yPixelRange) * yDataRange;

        return { x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)) };
    },

    // Convert data coordinates to pixel coordinates
    dataToPixel(x, y) {
        if (!this.isComplete) return null;

        const xPixelRange = this.points.xMax.x - this.points.xMin.x;
        const xDataRange = this.values.xMax - this.values.xMin;
        const px = this.points.xMin.x + ((x - this.values.xMin) / xDataRange) * xPixelRange;

        const yPixelRange = this.points.yMin.y - this.points.yMax.y;
        const yDataRange = this.values.yMax - this.values.yMin;
        const py = this.points.yMin.y - ((y - this.values.yMin) / yDataRange) * yPixelRange;

        return { x: px, y: py };
    },

    // Update UI elements
    updateUI() {
        const status = document.getElementById('calibrationStatus');
        const calibrateBtn = document.getElementById('calibrateBtn');
        const clearBtn = document.getElementById('clearCalibrationBtn');
        const gridControls = document.getElementById('gridControls');

        if (this.isComplete) {
            status.innerHTML = '<span class="status-dot complete"></span><span>Calibrated</span>';
            calibrateBtn.style.display = 'none';
            clearBtn.style.display = 'block';
            if (gridControls) gridControls.style.display = 'block';
        } else if (this.isCalibrating) {
            status.innerHTML = `<span class="status-dot pending"></span><span>Step ${this.calibrationStep + 1} of 4</span>`;
            calibrateBtn.textContent = 'Cancel';
            calibrateBtn.classList.remove('btn-primary');
            calibrateBtn.classList.add('btn-danger');
            clearBtn.style.display = 'none';
            if (gridControls) gridControls.style.display = 'none';
        } else {
            status.innerHTML = '<span class="status-dot pending"></span><span>Not calibrated</span>';
            calibrateBtn.textContent = 'Set Calibration Points';
            calibrateBtn.classList.remove('btn-danger');
            calibrateBtn.classList.add('btn-primary');
            calibrateBtn.style.display = 'block';
            clearBtn.style.display = 'none';
            if (gridControls) gridControls.style.display = 'none';
        }
    },

    // Update instructions text
    updateInstructions() {
        const instructions = document.getElementById('canvasInstructions');

        if (this.isCalibrating) {
            instructions.textContent = this.steps[this.calibrationStep].label;
            instructions.style.display = 'block';
        } else if (this.isComplete) {
            const curve = typeof Curves !== 'undefined' ? Curves.getActive() : null;
            const mode = typeof Canvas !== 'undefined' ? Canvas.digitizeMode : 'manual';

            if (curve) {
                if (mode === 'auto') {
                    instructions.innerHTML = `<strong>AUTO:</strong> Click on <strong style="color: ${curve.color}">${curve.name}</strong> to trace | Drag to pan | Pinch to zoom`;
                } else {
                    const guidedHint = curve.imageColor
                        ? `Hover near <strong style="color: ${curve.color}">${curve.name}</strong> to snap, then click to add`
                        : `Hover near <strong style="color: ${curve.color}">${curve.name}</strong> to snap, then click to add (or place the first point to learn the line color)`;
                    instructions.innerHTML = `<strong>GUIDED:</strong> ${guidedHint} | Drag existing points to refine | Drag to pan | Pinch/scroll to zoom`;
                }
            } else {
                instructions.textContent = 'Add a curve first, then hover or click to add points';
            }
            instructions.style.display = 'block';
        } else {
            instructions.textContent = 'Calibrate axes first';
            instructions.style.display = 'block';
        }
    },

    // Get calibration points for drawing
    getCalibrationPoints() {
        const points = [];
        for (const [key, point] of Object.entries(this.points)) {
            if (point) {
                points.push({ ...point, key });
            }
        }
        return points;
    }
};

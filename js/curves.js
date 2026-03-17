// Curves module - manages multiple curves and their points
const Curves = {
    curves: [],
    activeCurveId: null,
    nextId: 1,

    // Default colors for auto-assignment
    defaultColors: [
        '#2196F3', // Blue
        '#f44336', // Red
        '#4CAF50', // Green
        '#ff9800', // Orange
        '#9C27B0', // Purple
        '#00BCD4', // Cyan
        '#795548', // Brown
        '#607D8B', // Gray
    ],

    // Create a new curve
    create(name, color, metadata = {}) {
        const id = this.nextId++;
        const curve = {
            id,
            name: name || `Curve ${id}`,
            color: color || this.defaultColors[(id - 1) % this.defaultColors.length],
            imageColor: metadata.imageColor || null,
            treatment: metadata.treatment || '',
            population: metadata.population || '',
            line: metadata.line || '',
            n: metadata.n || '',
            points: [],
        };
        this.curves.push(curve);
        this.activeCurveId = id;
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        this.updateUI();
        if (typeof Calibration !== 'undefined') {
            Calibration.updateInstructions();
        }
        return curve;
    },

    // Delete a curve
    delete(id) {
        const index = this.curves.findIndex(c => c.id === id);
        if (index > -1) {
            this.curves.splice(index, 1);
            if (this.activeCurveId === id) {
                this.activeCurveId = this.curves.length > 0 ? this.curves[0].id : null;
            }
            if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
                Canvas.clearInteractionGuides();
            }
            this.updateUI();
            if (typeof Calibration !== 'undefined') {
                Calibration.updateInstructions();
            }
        }
    },

    // Get active curve
    getActive() {
        return this.curves.find(c => c.id === this.activeCurveId);
    },

    // Set active curve
    setActive(id) {
        this.activeCurveId = id;
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        this.updateUI();
        // Update instructions to show active curve
        if (typeof Calibration !== 'undefined') {
            Calibration.updateInstructions();
        }
    },

    // Store a sampled image color for snapping/highlighting
    setImageColor(id, imageColor) {
        const curve = this.curves.find(c => c.id === id);
        if (curve && imageColor) {
            curve.imageColor = imageColor;
            if (curve.id === this.activeCurveId && typeof Calibration !== 'undefined') {
                Calibration.updateInstructions();
            }
        }
    },

    // Add point to active curve
    addPoint(pixelX, pixelY, dataX, dataY) {
        const curve = this.getActive();
        if (!curve) return null;

        const point = {
            id: Date.now(),
            px: pixelX,
            py: pixelY,
            x: dataX,
            y: dataY,
        };
        curve.points.push(point);

        // Sort points by x value
        curve.points.sort((a, b) => a.x - b.x);

        this.updateUI();
        return point;
    },

    // Delete point from active curve
    deletePoint(pointId) {
        const curve = this.getActive();
        if (!curve) return;

        const index = curve.points.findIndex(p => p.id === pointId);
        if (index > -1) {
            curve.points.splice(index, 1);
            this.updateUI();
        }
    },

    // Update point position
    updatePoint(pointId, pixelX, pixelY, dataX, dataY) {
        const curve = this.getActive();
        if (!curve) return;

        const point = curve.points.find(p => p.id === pointId);
        if (point) {
            point.px = pixelX;
            point.py = pixelY;
            point.x = dataX;
            point.y = dataY;

            // Re-sort points by x value
            curve.points.sort((a, b) => a.x - b.x);

            this.updateUI();
        }
    },

    // Find point near pixel coordinates
    findPointAt(px, py, threshold = 10) {
        for (const curve of this.curves) {
            for (const point of curve.points) {
                const dist = Math.sqrt((point.px - px) ** 2 + (point.py - py) ** 2);
                if (dist <= threshold) {
                    return { curve, point };
                }
            }
        }
        return null;
    },

    // Find a point by its ID across all curves
    findPointById(pointId) {
        for (const curve of this.curves) {
            const point = curve.points.find(p => p.id === pointId);
            if (point) {
                return { curve, point };
            }
        }
        return null;
    },

    // Get all curves
    getAll() {
        return this.curves;
    },

    // Get total point count
    getTotalPointCount() {
        return this.curves.reduce((sum, c) => sum + c.points.length, 0);
    },

    // Clear all curves
    clearAll() {
        this.curves = [];
        this.activeCurveId = null;
        this.nextId = 1;
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        this.updateUI();
        if (typeof Calibration !== 'undefined') {
            Calibration.updateInstructions();
        }
    },

    // Update UI elements
    updateUI() {
        this.renderCurveList();
        this.renderPointsList();
        this.updateStatus();
    },

    // Render curve list in sidebar
    renderCurveList() {
        const container = document.getElementById('curveList');
        if (!container) return;

        container.innerHTML = this.curves.map(curve => `
            <div class="curve-item ${curve.id === this.activeCurveId ? 'active' : ''}" data-id="${curve.id}">
                <input type="radio" name="curve" ${curve.id === this.activeCurveId ? 'checked' : ''}>
                <span class="curve-color" style="background: ${curve.color}"></span>
                <span class="curve-name">${curve.name} (${curve.points.length})</span>
                <button class="curve-delete" data-id="${curve.id}">&times;</button>
            </div>
        `).join('');

        // Add click handlers
        container.querySelectorAll('.curve-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('curve-delete')) {
                    this.setActive(parseInt(item.dataset.id));
                    if (typeof Canvas !== 'undefined') Canvas.draw();
                }
            });
        });

        container.querySelectorAll('.curve-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.delete(parseInt(btn.dataset.id));
                if (typeof Canvas !== 'undefined') Canvas.draw();
            });
        });
    },

    // Render points list for active curve
    renderPointsList() {
        const container = document.getElementById('pointsList');
        const countEl = document.getElementById('pointCount');
        const curveNameEl = document.getElementById('activeCurveName');
        if (!container) return;

        const curve = this.getActive();
        if (!curve) {
            container.innerHTML = '<div style="padding: 0.5rem; color: #666;">No curve selected</div>';
            if (countEl) countEl.textContent = '(0)';
            if (curveNameEl) curveNameEl.textContent = '';
            return;
        }

        if (countEl) countEl.textContent = `(${curve.points.length})`;
        if (curveNameEl) {
            curveNameEl.innerHTML = `<span style="color: ${curve.color}; font-weight: 500;">- ${curve.name}</span>`;
        }

        if (curve.points.length === 0) {
            container.innerHTML = '<div style="padding: 0.5rem; color: #666;">Hover near the curve, then click to add points</div>';
            return;
        }

        container.innerHTML = curve.points.map(point => `
            <div class="point-row" data-id="${point.id}">
                <span>${point.x.toFixed(2)}</span>
                <span>${point.y.toFixed(4)}</span>
                <button class="point-delete" data-id="${point.id}">&times;</button>
            </div>
        `).join('');

        // Add delete handlers
        container.querySelectorAll('.point-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                this.deletePoint(parseInt(btn.dataset.id));
                if (typeof Canvas !== 'undefined') Canvas.draw();
                if (typeof App !== 'undefined') App.saveState();
            });
        });
    },

    // Update status bar
    updateStatus() {
        const statusEl = document.getElementById('statusText');
        if (statusEl) {
            statusEl.textContent = `Points: ${this.getTotalPointCount()} | Curves: ${this.curves.length}`;
        }
    },

    // Serialize for undo/redo
    serialize() {
        return JSON.stringify({
            curves: this.curves,
            activeCurveId: this.activeCurveId,
            nextId: this.nextId,
        });
    },

    // Deserialize from undo/redo
    deserialize(data) {
        const parsed = JSON.parse(data);
        this.curves = parsed.curves;
        this.activeCurveId = parsed.activeCurveId;
        this.nextId = parsed.nextId;
        this.updateUI();
        if (typeof Calibration !== 'undefined') {
            Calibration.updateInstructions();
        }
    }
};

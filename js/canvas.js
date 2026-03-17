// Canvas module - handles image display and drawing
const Canvas = {
    canvas: null,
    ctx: null,
    image: null,
    imageData: null,
    scale: 1,
    baseScale: 1,  // Scale to fit image in container
    zoomLevel: 1,  // User zoom multiplier
    offsetX: 0,
    offsetY: 0,
    panX: 0,       // Pan offset for zoomed view
    panY: 0,

    // Grid settings
    showGrid: false,
    gridSpacingX: 10,  // Grid spacing in data units (e.g., 10 months)
    gridSpacingY: 0.1, // Grid spacing in data units (e.g., 0.1 survival)

    // Digitization mode: 'manual' or 'auto'
    digitizeMode: 'manual',

    // Guided digitizing state
    hoverState: null,
    selectedGuide: null,
    hoverSnapDistance: 14,
    hoverHighlightDistance: 22,

    // Dragging state
    isDragging: false,
    isPanning: false,
    lastPanX: 0,
    lastPanY: 0,
    dragPoint: null,
    dragCurve: null,
    mouseDownX: 0,
    mouseDownY: 0,
    hasMoved: false,  // Track if mouse moved since mousedown
    wasPanning: false, // Track if user was panning (to prevent click after pan)

    // Initialize canvas
    init() {
        this.canvas = document.getElementById('mainCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Set up event listeners
        this.canvas.addEventListener('click', this.handleClick.bind(this));
        this.canvas.addEventListener('contextmenu', this.handleRightClick.bind(this));
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));

        // Mouse wheel zoom (and trackpad pinch which sends wheel events with ctrlKey)
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

        // Touch events for mobile pinch-to-zoom
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.image) this.fitImage();
        });
    },

    // Touch state for pinch-to-zoom
    touchState: {
        lastTouchDistance: 0,
        lastTouchCenter: { x: 0, y: 0 },
        isTouching: false,
        touchCount: 0
    },

    // Load image onto canvas
    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.image = img;
                this.cacheImageData();
                this.clearInteractionGuides();
                this.fitImage();
                resolve(img);
            };
            img.onerror = reject;
            img.src = src;
        });
    },

    // Cache full-resolution image data for snapping/highlighting
    cacheImageData() {
        if (!this.image) {
            this.imageData = null;
            return;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.image.width;
        tempCanvas.height = this.image.height;

        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.image, 0, 0);
        this.imageData = tempCtx.getImageData(0, 0, this.image.width, this.image.height);
    },

    // Fit image to canvas container
    fitImage() {
        if (!this.image) return;

        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const containerWidth = Math.floor(rect.width);
        const containerHeight = Math.floor(rect.height) || 500; // Fallback height

        // Calculate base scale to fit image
        const scaleX = containerWidth / this.image.width;
        const scaleY = containerHeight / this.image.height;
        this.baseScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
        this.scale = this.baseScale * this.zoomLevel;

        // Set canvas internal resolution to match display size exactly
        this.canvas.width = containerWidth;
        this.canvas.height = containerHeight;

        // Set CSS display size to match exactly (1:1 pixel mapping)
        this.canvas.style.width = containerWidth + 'px';
        this.canvas.style.height = containerHeight + 'px';

        // Calculate offset to center image (accounting for pan)
        this.offsetX = (containerWidth - this.image.width * this.scale) / 2 + this.panX;
        this.offsetY = (containerHeight - this.image.height * this.scale) / 2 + this.panY;

        this.draw();
        this.updateZoomDisplay();
    },

    // Zoom methods
    zoomIn() {
        this.setZoom(this.zoomLevel * 1.25);
    },

    zoomOut() {
        this.setZoom(this.zoomLevel / 1.25);
    },

    resetZoom() {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.fitImage();
    },

    setZoom(level, centerX = null, centerY = null) {
        if (!this.image) return;

        const oldZoom = this.zoomLevel;
        const oldScale = this.scale;

        // Clamp zoom between 0.5x and 5x
        this.zoomLevel = Math.max(0.5, Math.min(5, level));
        this.scale = this.baseScale * this.zoomLevel;

        // Reset pan if zooming back to fit or below
        if (this.zoomLevel <= 1) {
            this.panX = 0;
            this.panY = 0;
        } else if (centerX !== null && centerY !== null) {
            // Zoom centered on mouse position
            const zoomRatio = this.scale / oldScale;

            // Adjust pan to keep the point under cursor stationary
            const containerWidth = this.canvas.width;
            const containerHeight = this.canvas.height;

            const oldCenterX = (containerWidth - this.image.width * oldScale) / 2 + this.panX;
            const oldCenterY = (containerHeight - this.image.height * oldScale) / 2 + this.panY;

            // Calculate new pan to maintain mouse position
            const mouseImageX = (centerX - oldCenterX) / oldScale;
            const mouseImageY = (centerY - oldCenterY) / oldScale;

            const newCenterX = (containerWidth - this.image.width * this.scale) / 2;
            const newCenterY = (containerHeight - this.image.height * this.scale) / 2;

            this.panX = centerX - newCenterX - mouseImageX * this.scale;
            this.panY = centerY - newCenterY - mouseImageY * this.scale;
        }

        // Apply pan limits
        this.clampPan();

        // Recalculate offsets
        this.offsetX = (this.canvas.width - this.image.width * this.scale) / 2 + this.panX;
        this.offsetY = (this.canvas.height - this.image.height * this.scale) / 2 + this.panY;

        this.draw();
        this.updateZoomDisplay();
        this.updateCursor();
    },

    // Update cursor based on state
    updateCursor() {
        // Default is crosshair for precise point placement
        this.canvas.style.cursor = 'crosshair';
    },

    // Clamp pan to keep image visible
    clampPan() {
        if (!this.image) return;

        const containerWidth = this.canvas.width;
        const containerHeight = this.canvas.height;
        const imageWidth = this.image.width * this.scale;
        const imageHeight = this.image.height * this.scale;

        // Calculate max pan based on image vs container size
        let maxPanX, maxPanY;

        if (imageWidth > containerWidth) {
            // Image wider than container - can pan horizontally
            maxPanX = (imageWidth - containerWidth) / 2;
        } else {
            // Image smaller than container - allow some movement but keep centered-ish
            maxPanX = (containerWidth - imageWidth) / 4;
        }

        if (imageHeight > containerHeight) {
            // Image taller than container - can pan vertically
            maxPanY = (imageHeight - containerHeight) / 2;
        } else {
            // Image smaller - allow some movement
            maxPanY = (containerHeight - imageHeight) / 4;
        }

        this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
        this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
    },

    updateZoomDisplay() {
        const zoomEl = document.getElementById('zoomLevel');
        if (zoomEl) {
            zoomEl.textContent = Math.round(this.zoomLevel * 100) + '%';
        }
    },

    // Clear both hover and selected point guides
    clearInteractionGuides() {
        this.hoverState = null;
        this.selectedGuide = null;
    },

    // Clear only the transient hover guide
    clearHoverGuide() {
        this.hoverState = null;
    },

    // Convert a hex color to an rgba() string
    hexToRgba(hex, alpha = 1) {
        const rgb = AutoDetect.hexToRgb(hex);
        if (!rgb) {
            return `rgba(33, 150, 243, ${alpha})`;
        }
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    },

    // Convert a screen-space distance into image-space pixels
    getScaledSearchDistance(screenPixels) {
        return Math.max(4, Math.min(28, Math.round(screenPixels / Math.max(this.scale, 0.25))));
    },

    // Check whether an image-space point is within the loaded image
    isPointInsideImage(imageX, imageY) {
        return !!this.image &&
            imageX >= 0 &&
            imageY >= 0 &&
            imageX < this.image.width &&
            imageY < this.image.height;
    },

    // Build a hover/guide state by snapping to the active curve near the cursor
    getCurveGuideState(imageX, imageY) {
        if (!this.image || !this.imageData || !Calibration.isComplete || this.digitizeMode !== 'manual') {
            return null;
        }

        const curve = Curves.getActive();
        if (!curve || !this.isPointInsideImage(imageX, imageY)) {
            return null;
        }

        const targetColor = AutoDetect.hexToRgb(curve.imageColor || curve.color);
        if (!targetColor) {
            return null;
        }

        const snapRadius = this.getScaledSearchDistance(this.hoverSnapDistance);
        const snappedPoint = AutoDetect.findNearestMatchingPixel(
            this.imageData,
            this.image.width,
            this.image.height,
            targetColor,
            imageX,
            imageY,
            snapRadius
        );

        if (!snappedPoint) {
            return null;
        }

        const dataCoords = Calibration.pixelToData(snappedPoint.x, snappedPoint.y);
        if (!dataCoords) {
            return null;
        }

        const highlightRadius = Math.max(
            snapRadius + 4,
            this.getScaledSearchDistance(this.hoverHighlightDistance)
        );

        return {
            curveId: curve.id,
            curveColor: curve.imageColor || curve.color,
            x: snappedPoint.x,
            y: snappedPoint.y,
            dataX: dataCoords.x,
            dataY: dataCoords.y,
            highlightPixels: AutoDetect.collectConnectedPixels(
                this.imageData,
                this.image.width,
                this.image.height,
                targetColor,
                snappedPoint.x,
                snappedPoint.y,
                highlightRadius,
                260
            )
        };
    },

    // Learn the curve's image color from a manually placed or snapped point
    learnCurveColor(curve, imageX, imageY, allowOverwrite = false) {
        if (!curve || !this.imageData || !this.image) return;
        if (curve.imageColor && !allowOverwrite) return;

        const sampledColor = AutoDetect.getPixelColor(this.imageData, imageX, imageY, this.image.width);
        if (!sampledColor) return;

        const brightness = (sampledColor.r + sampledColor.g + sampledColor.b) / 3;
        if (brightness > 248) return;

        Curves.setImageColor(curve.id, AutoDetect.rgbToHex(sampledColor));
    },

    // Stable key for detecting hover changes without redrawing on every pixel move
    getGuideStateKey(state) {
        if (!state) return '';
        return `${state.curveId}:${state.x}:${state.y}`;
    },

    // Handle mouse wheel for zoom (also handles trackpad pinch)
    handleWheel(e) {
        if (!this.image) return;
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Trackpad pinch sends ctrlKey with wheel event
        if (e.ctrlKey) {
            // Pinch gesture - more sensitive zoom
            const delta = e.deltaY > 0 ? 0.95 : 1.05;
            this.setZoom(this.zoomLevel * delta, mouseX, mouseY);
        } else {
            // Regular scroll wheel
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.setZoom(this.zoomLevel * delta, mouseX, mouseY);
        }
    },

    // Touch event handlers for mobile pinch-to-zoom
    handleTouchStart(e) {
        if (!this.image) return;

        this.touchState.touchCount = e.touches.length;

        if (e.touches.length === 2) {
            e.preventDefault();
            // Two finger touch - prepare for pinch
            this.touchState.lastTouchDistance = this.getTouchDistance(e.touches);
            this.touchState.lastTouchCenter = this.getTouchCenter(e.touches);
            this.touchState.isTouching = true;
        } else if (e.touches.length === 1) {
            // Single touch - prepare for pan
            this.touchState.isTouching = true;
            this.lastPanX = e.touches[0].clientX;
            this.lastPanY = e.touches[0].clientY;
            this.mouseDownX = e.touches[0].clientX;
            this.mouseDownY = e.touches[0].clientY;
            this.hasMoved = false;
        }
    },

    handleTouchMove(e) {
        if (!this.image || !this.touchState.isTouching) return;

        if (e.touches.length === 2) {
            e.preventDefault();
            // Pinch to zoom
            const newDistance = this.getTouchDistance(e.touches);
            const newCenter = this.getTouchCenter(e.touches);

            if (this.touchState.lastTouchDistance > 0) {
                const scale = newDistance / this.touchState.lastTouchDistance;
                const rect = this.canvas.getBoundingClientRect();
                const centerX = newCenter.x - rect.left;
                const centerY = newCenter.y - rect.top;

                this.setZoom(this.zoomLevel * scale, centerX, centerY);
            }

            this.touchState.lastTouchDistance = newDistance;
            this.touchState.lastTouchCenter = newCenter;
        } else if (e.touches.length === 1 && this.touchState.touchCount === 1) {
            // Single finger pan
            const touch = e.touches[0];
            const dx = touch.clientX - this.lastPanX;
            const dy = touch.clientY - this.lastPanY;

            // Check if moved enough to count as pan
            if (Math.abs(touch.clientX - this.mouseDownX) > 5 ||
                Math.abs(touch.clientY - this.mouseDownY) > 5) {
                this.hasMoved = true;
            }

            if (this.hasMoved) {
                this.panX += dx;
                this.panY += dy;
                this.clampPan();

                this.offsetX = (this.canvas.width - this.image.width * this.scale) / 2 + this.panX;
                this.offsetY = (this.canvas.height - this.image.height * this.scale) / 2 + this.panY;

                this.draw();
            }

            this.lastPanX = touch.clientX;
            this.lastPanY = touch.clientY;
        }
    },

    handleTouchEnd(e) {
        if (e.touches.length === 0) {
            this.touchState.isTouching = false;
            this.touchState.lastTouchDistance = 0;
            this.touchState.touchCount = 0;
        } else if (e.touches.length === 1) {
            // Went from 2 fingers to 1
            this.touchState.touchCount = 1;
            this.lastPanX = e.touches[0].clientX;
            this.lastPanY = e.touches[0].clientY;
        }
    },

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    getTouchCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    },

    // Draw everything
    draw() {
        if (!this.ctx) return;

        // Clear canvas with background
        this.ctx.fillStyle = '#e0e0e0';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw image
        if (this.image) {
            // Draw white background for image area
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(
                this.offsetX,
                this.offsetY,
                this.image.width * this.scale,
                this.image.height * this.scale
            );

            this.ctx.drawImage(
                this.image,
                this.offsetX,
                this.offsetY,
                this.image.width * this.scale,
                this.image.height * this.scale
            );
        }

        // Draw grid (if enabled and calibrated)
        if (this.showGrid && Calibration.isComplete) {
            this.drawGrid();
        }

        // Draw calibration points
        this.drawCalibrationPoints();

        // Draw curve points
        this.drawCurvePoints();

        // Draw guided hover/selection overlays
        this.drawInteractionGuides();
    },

    // Draw grid overlay
    drawGrid() {
        if (!Calibration.isComplete) return;

        const ctx = this.ctx;
        ctx.save();

        // Grid style
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.3)';
        ctx.lineWidth = 1;

        // Get calibration bounds
        const xMin = Calibration.values.xMin;
        const xMax = Calibration.values.xMax;
        const yMin = Calibration.values.yMin;
        const yMax = Calibration.values.yMax;

        // Draw vertical lines (X axis grid)
        ctx.beginPath();
        for (let x = xMin; x <= xMax; x += this.gridSpacingX) {
            const pixelPos = Calibration.dataToPixel(x, yMin);
            const pixelPosTop = Calibration.dataToPixel(x, yMax);
            if (pixelPos && pixelPosTop) {
                const canvasX = pixelPos.x * this.scale + this.offsetX;
                const canvasYBottom = pixelPos.y * this.scale + this.offsetY;
                const canvasYTop = pixelPosTop.y * this.scale + this.offsetY;
                ctx.moveTo(canvasX, canvasYTop);
                ctx.lineTo(canvasX, canvasYBottom);
            }
        }
        ctx.stroke();

        // Draw horizontal lines (Y axis grid)
        ctx.beginPath();
        for (let y = yMin; y <= yMax; y += this.gridSpacingY) {
            const pixelPos = Calibration.dataToPixel(xMin, y);
            const pixelPosRight = Calibration.dataToPixel(xMax, y);
            if (pixelPos && pixelPosRight) {
                const canvasY = pixelPos.y * this.scale + this.offsetY;
                const canvasXLeft = pixelPos.x * this.scale + this.offsetX;
                const canvasXRight = pixelPosRight.x * this.scale + this.offsetX;
                ctx.moveTo(canvasXLeft, canvasY);
                ctx.lineTo(canvasXRight, canvasY);
            }
        }
        ctx.stroke();

        // Draw grid labels
        ctx.fillStyle = 'rgba(0, 100, 200, 0.7)';
        ctx.font = '10px sans-serif';

        // X axis labels
        for (let x = xMin; x <= xMax; x += this.gridSpacingX) {
            const pixelPos = Calibration.dataToPixel(x, yMin);
            if (pixelPos) {
                const canvasX = pixelPos.x * this.scale + this.offsetX;
                const canvasY = pixelPos.y * this.scale + this.offsetY;
                ctx.fillText(x.toString(), canvasX - 5, canvasY + 12);
            }
        }

        // Y axis labels
        for (let y = yMin; y <= yMax; y += this.gridSpacingY) {
            const pixelPos = Calibration.dataToPixel(xMin, y);
            if (pixelPos) {
                const canvasX = pixelPos.x * this.scale + this.offsetX;
                const canvasY = pixelPos.y * this.scale + this.offsetY;
                ctx.fillText(y.toFixed(1), canvasX - 25, canvasY + 3);
            }
        }

        ctx.restore();
    },

    // Toggle grid visibility
    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.draw();
        return this.showGrid;
    },

    // Set grid spacing
    setGridSpacing(spacingX, spacingY) {
        this.gridSpacingX = spacingX;
        this.gridSpacingY = spacingY;
        if (this.showGrid) this.draw();
    },

    // Draw calibration reference points
    drawCalibrationPoints() {
        const points = Calibration.getCalibrationPoints();

        points.forEach(point => {
            const x = point.x * this.scale + this.offsetX;
            const y = point.y * this.scale + this.offsetY;

            // Draw crosshair
            this.ctx.strokeStyle = '#ff00ff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x - 10, y);
            this.ctx.lineTo(x + 10, y);
            this.ctx.moveTo(x, y - 10);
            this.ctx.lineTo(x, y + 10);
            this.ctx.stroke();

            // Draw label
            this.ctx.fillStyle = '#ff00ff';
            this.ctx.font = '12px sans-serif';
            this.ctx.fillText(point.key, x + 12, y - 5);
        });
    },

    // Draw all curve points
    drawCurvePoints() {
        const curves = Curves.getAll();

        curves.forEach(curve => {
            const isActive = curve.id === Curves.activeCurveId;

            // Draw points
            curve.points.forEach(point => {
                const x = point.px * this.scale + this.offsetX;
                const y = point.py * this.scale + this.offsetY;

                // Outer circle
                this.ctx.beginPath();
                this.ctx.arc(x, y, isActive ? 7 : 5, 0, Math.PI * 2);
                this.ctx.fillStyle = curve.color;
                this.ctx.fill();

                // Inner dot for active curve
                if (isActive) {
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, 3, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'white';
                    this.ctx.fill();
                }
            });

            // Draw connecting lines (optional, for visualization)
            if (curve.points.length > 1) {
                this.ctx.beginPath();
                this.ctx.strokeStyle = curve.color;
                this.ctx.lineWidth = isActive ? 2 : 1;
                this.ctx.globalAlpha = 0.5;

                curve.points.forEach((point, i) => {
                    const x = point.px * this.scale + this.offsetX;
                    const y = point.py * this.scale + this.offsetY;
                    if (i === 0) {
                        this.ctx.moveTo(x, y);
                    } else {
                        this.ctx.lineTo(x, y);
                    }
                });
                this.ctx.stroke();
                this.ctx.globalAlpha = 1;
            }
        });
    },

    // Draw either the live hover guide or the last selected point guide
    drawInteractionGuides() {
        if (!Calibration.isComplete) return;

        if (this.hoverState) {
            this.drawGuideOverlay(this.hoverState, false);
            return;
        }

        if (!this.selectedGuide) return;

        const locatedPoint = Curves.findPointById(this.selectedGuide.pointId);
        if (!locatedPoint) {
            this.selectedGuide = null;
            return;
        }

        this.drawGuideOverlay({
            curveId: locatedPoint.curve.id,
            curveColor: locatedPoint.curve.imageColor || locatedPoint.curve.color,
            x: locatedPoint.point.px,
            y: locatedPoint.point.py,
            dataX: locatedPoint.point.x,
            dataY: locatedPoint.point.y,
            highlightPixels: this.selectedGuide.highlightPixels || []
        }, true);
    },

    // Draw the local curve highlight, axis guides, labels, and point focus marker
    drawGuideOverlay(guideState, persistent = false) {
        if (!guideState) return;

        const bounds = AutoDetect.getCalibrationBounds(Calibration);
        if (!bounds) return;

        if (guideState.highlightPixels && guideState.highlightPixels.length > 0) {
            this.drawHighlightedPixels(guideState.highlightPixels, guideState.curveColor, persistent);
        }

        const pointCanvasX = guideState.x * this.scale + this.offsetX;
        const pointCanvasY = guideState.y * this.scale + this.offsetY;
        const leftCanvasX = bounds.left * this.scale + this.offsetX;
        const rightCanvasX = bounds.right * this.scale + this.offsetX;
        const topCanvasY = bounds.top * this.scale + this.offsetY;
        const bottomCanvasY = bounds.bottom * this.scale + this.offsetY;

        const guideColor = persistent ? 'rgba(255, 152, 0, 0.78)' : 'rgba(255, 193, 7, 0.94)';
        const labelColor = persistent ? 'rgba(255, 152, 0, 0.95)' : 'rgba(33, 33, 33, 0.92)';

        this.ctx.save();
        this.ctx.strokeStyle = guideColor;
        this.ctx.lineWidth = persistent ? 2 : 2.5;
        this.ctx.setLineDash(persistent ? [8, 4] : []);
        this.ctx.beginPath();
        this.ctx.moveTo(pointCanvasX, topCanvasY);
        this.ctx.lineTo(pointCanvasX, bottomCanvasY);
        this.ctx.moveTo(leftCanvasX, pointCanvasY);
        this.ctx.lineTo(rightCanvasX, pointCanvasY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.drawGuideHandle(pointCanvasX, bottomCanvasY, guideColor, persistent ? 5 : 6);
        this.drawGuideHandle(leftCanvasX, pointCanvasY, guideColor, persistent ? 5 : 6);

        this.ctx.beginPath();
        this.ctx.arc(pointCanvasX, pointCanvasY, persistent ? 8 : 9, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = guideState.curveColor || '#2196F3';
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(pointCanvasX, pointCanvasY, persistent ? 13 : 15, 0, Math.PI * 2);
        this.ctx.lineWidth = persistent ? 2 : 3;
        this.ctx.strokeStyle = this.hexToRgba(guideState.curveColor, persistent ? 0.35 : 0.6);
        this.ctx.stroke();
        this.ctx.restore();

        this.drawGuideLabel(
            pointCanvasX,
            Math.min(this.canvas.height - 12, bottomCanvasY + 20),
            guideState.dataX.toFixed(2),
            labelColor,
            'center'
        );

        this.drawGuideLabel(
            Math.max(12, leftCanvasX - 10),
            pointCanvasY,
            guideState.dataY.toFixed(3),
            labelColor,
            'right'
        );
    },

    // Draw the highlighted cluster of curve pixels near the snapped point
    drawHighlightedPixels(pixels, curveColor, persistent = false) {
        if (!pixels || pixels.length === 0) return;

        const pixelSize = Math.max(3, Math.min(7, this.scale * (persistent ? 3 : 2.5)));
        const halfSize = pixelSize / 2;

        this.ctx.save();
        this.ctx.fillStyle = this.hexToRgba(curveColor, persistent ? 0.18 : 0.34);
        this.ctx.shadowColor = this.hexToRgba(curveColor, persistent ? 0.35 : 0.7);
        this.ctx.shadowBlur = persistent ? 4 : 8;

        pixels.forEach(pixel => {
            const canvasX = pixel.x * this.scale + this.offsetX;
            const canvasY = pixel.y * this.scale + this.offsetY;
            this.ctx.fillRect(canvasX - halfSize, canvasY - halfSize, pixelSize, pixelSize);
        });

        this.ctx.restore();
    },

    // Draw a small highlighted intercept marker on an axis
    drawGuideHandle(x, y, color, radius) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(x, y, Math.max(2, radius - 2), 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();
        this.ctx.restore();
    },

    // Draw a compact guide label near an axis intercept
    drawGuideLabel(anchorX, anchorY, text, backgroundColor, align = 'center') {
        this.ctx.save();
        this.ctx.font = '12px sans-serif';
        this.ctx.textBaseline = 'middle';

        const paddingX = 6;
        const paddingY = 4;
        const textWidth = this.ctx.measureText(text).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 20;

        let boxX = anchorX - boxWidth / 2;
        if (align === 'right') {
            boxX = anchorX - boxWidth;
        } else if (align === 'left') {
            boxX = anchorX;
        }

        boxX = Math.max(4, Math.min(this.canvas.width - boxWidth - 4, boxX));
        const boxY = Math.max(4, Math.min(this.canvas.height - boxHeight - 4, anchorY - boxHeight / 2));

        this.ctx.fillStyle = backgroundColor;
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(text, boxX + paddingX, boxY + boxHeight / 2 + 0.5);
        this.ctx.restore();
    },

    // Convert screen coordinates to image coordinates
    screenToImage(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();

        // Get canvas position relative to click
        const canvasX = screenX - rect.left;
        const canvasY = screenY - rect.top;

        // Convert to image coordinates (accounting for scale and offset)
        const imageX = (canvasX - this.offsetX) / this.scale;
        const imageY = (canvasY - this.offsetY) / this.scale;

        return { x: imageX, y: imageY };
    },

    // Handle click
    handleClick(e) {
        // Don't process click if we were dragging or panning
        if (this.isDragging || this.wasPanning) return;

        const { x, y } = this.screenToImage(e.clientX, e.clientY);

        // Check if calibrating
        if (Calibration.isCalibrating) {
            Calibration.handleClick(x, y);
            this.draw();
            return;
        }

        // Check if calibration is complete
        if (!Calibration.isComplete) {
            return;
        }

        // Check if clicking on existing point (in manual mode)
        if (this.digitizeMode === 'manual') {
            const found = Curves.findPointAt(x, y, 10 / this.scale);
            if (found) {
                Curves.setActive(found.curve.id);
                this.selectedGuide = {
                    pointId: found.point.id,
                    highlightPixels: []
                };
                this.draw();
                return;
            }
        }

        // Add new point(s) to active curve
        const curve = Curves.getActive();
        if (!curve) {
            alert('Please add a curve first');
            return;
        }

        if (this.digitizeMode === 'auto') {
            // Auto-detect curve
            this.autoDetectCurve(x, y);
        } else {
            // Guided mode - snap to the curve when possible, otherwise keep the raw click
            const guideState = this.getCurveGuideState(x, y);
            const pointX = guideState ? guideState.x : x;
            const pointY = guideState ? guideState.y : y;
            const dataCoords = guideState
                ? { x: guideState.dataX, y: guideState.dataY }
                : Calibration.pixelToData(pointX, pointY);

            if (dataCoords) {
                const newPoint = Curves.addPoint(pointX, pointY, dataCoords.x, dataCoords.y);
                this.learnCurveColor(curve, pointX, pointY, !!guideState);
                if (guideState) {
                    guideState.curveColor = curve.imageColor || curve.color;
                }
                this.hoverState = guideState;
                this.selectedGuide = newPoint ? {
                    pointId: newPoint.id,
                    highlightPixels: guideState?.highlightPixels || []
                } : null;
                App.saveState();
                this.draw();
            }
        }
    },

    // Auto-detect and trace curve from clicked point
    autoDetectCurve(clickX, clickY) {
        if (!this.image || !this.imageData) return;
        const imageData = this.imageData;

        // Detect curve points
        const detectedPoints = AutoDetect.detectCurve(
            clickX, clickY,
            imageData,
            this.image.width,
            this.image.height
        );

        if (detectedPoints.length === 0) {
            alert('Could not detect curve. Try adjusting color tolerance or click directly on the curve line.');
            return;
        }

        // Simplify to reasonable number of points
        const simplified = AutoDetect.simplifyPoints(detectedPoints, 40);

        // Add all detected points to the active curve
        let addedCount = 0;
        simplified.forEach(point => {
            const dataCoords = Calibration.pixelToData(point.x, point.y);
            if (dataCoords) {
                // Only add points within calibrated range
                if (dataCoords.x >= Calibration.values.xMin &&
                    dataCoords.x <= Calibration.values.xMax &&
                    dataCoords.y >= Calibration.values.yMin &&
                    dataCoords.y <= Calibration.values.yMax) {
                    Curves.addPoint(point.x, point.y, dataCoords.x, dataCoords.y);
                    addedCount++;
                }
            }
        });

        if (addedCount > 0) {
            App.saveState();
            this.draw();
        } else {
            alert('No valid points detected within the calibrated area.');
        }
    },

    // Automatically detect ALL curves in the image
    detectAllCurvesAuto() {
        if (!this.image) {
            alert('Please load an image first.');
            return;
        }

        if (!Calibration.isComplete) {
            alert('Please calibrate the axes first.');
            return;
        }

        if (!this.imageData) {
            alert('Image data is not available yet. Please reload the image.');
            return;
        }

        const imageData = this.imageData;

        // Detect all curves
        const detectedCurves = AutoDetect.detectAllCurves(
            imageData,
            this.image.width,
            this.image.height,
            Calibration
        );

        if (detectedCurves.length === 0) {
            alert('No curves detected. Try adjusting the color tolerance or use manual mode.');
            return;
        }

        // Clear existing curves and add detected ones
        const addCurves = confirm(`Detected ${detectedCurves.length} curve(s). Add them? (This will create new curves)`);

        if (!addCurves) return;

        // Add each detected curve
        detectedCurves.forEach((detected, index) => {
            // Create new curve with detected color
            Curves.create(`Curve ${index + 1}`, detected.hexColor, {
                imageColor: detected.hexColor
            });

            // Add points to this curve
            detected.points.forEach(point => {
                const dataCoords = Calibration.pixelToData(point.x, point.y);
                if (dataCoords) {
                    if (dataCoords.x >= Calibration.values.xMin &&
                        dataCoords.x <= Calibration.values.xMax &&
                        dataCoords.y >= Calibration.values.yMin &&
                        dataCoords.y <= Calibration.values.yMax) {
                        Curves.addPoint(point.x, point.y, dataCoords.x, dataCoords.y);
                    }
                }
            });
        });

        App.saveState();
        this.draw();

        alert(`Added ${detectedCurves.length} curve(s) with their data points.`);
    },

    // Handle right click (delete point)
    handleRightClick(e) {
        e.preventDefault();

        const { x, y } = this.screenToImage(e.clientX, e.clientY);
        const found = Curves.findPointAt(x, y, 10 / this.scale);

        if (found) {
            // Switch to that curve and delete the point
            Curves.setActive(found.curve.id);
            Curves.deletePoint(found.point.id);
            if (this.selectedGuide?.pointId === found.point.id) {
                this.selectedGuide = null;
            }
            App.saveState();
            this.draw();
        }
    },

    // Handle mouse down (start drag)
    handleMouseDown(e) {
        if (e.button !== 0) return; // Left click only

        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;
        this.hasMoved = false;

        const { x, y } = this.screenToImage(e.clientX, e.clientY);
        const found = Curves.findPointAt(x, y, 10 / this.scale);
        const hadHoverGuide = !!this.hoverState;
        this.clearHoverGuide();

        if (found && Calibration.isComplete && this.digitizeMode === 'manual') {
            // Start dragging an existing point
            this.isDragging = true;
            this.dragPoint = found.point;
            this.dragCurve = found.curve;
            Curves.setActive(found.curve.id);
            this.selectedGuide = {
                pointId: found.point.id,
                highlightPixels: []
            };
            this.canvas.style.cursor = 'grabbing';
        } else {
            // Prepare for potential pan (at any zoom level)
            this.isPanning = true;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            this.canvas.style.cursor = 'grabbing';
        }

        if (hadHoverGuide) {
            this.draw();
        }
    },

    // Handle mouse move (drag)
    handleMouseMove(e) {
        const { x, y } = this.screenToImage(e.clientX, e.clientY);
        const previousHoverKey = this.getGuideStateKey(this.hoverState);

        if (!this.isPanning && !this.isDragging) {
            this.hoverState = this.getCurveGuideState(x, y);
        }

        // Update coordinate display
        const coordsSource = this.hoverState || { x, y };
        this.updateCoordsDisplay(coordsSource.x, coordsSource.y);

        // Update cursor - crosshair when idle, grabbing when panning
        if (!this.isPanning && !this.isDragging) {
            this.canvas.style.cursor = 'crosshair';
        }

        // Check if mouse has moved significantly (for distinguishing click vs drag)
        const moveThreshold = 5;
        if (Math.abs(e.clientX - this.mouseDownX) > moveThreshold ||
            Math.abs(e.clientY - this.mouseDownY) > moveThreshold) {
            this.hasMoved = true;
        }

        // Handle panning
        if (this.isPanning && this.hasMoved) {
            const dx = e.clientX - this.lastPanX;
            const dy = e.clientY - this.lastPanY;
            this.panX += dx;
            this.panY += dy;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;

            // Apply pan limits
            this.clampPan();

            this.offsetX = (this.canvas.width - this.image.width * this.scale) / 2 + this.panX;
            this.offsetY = (this.canvas.height - this.image.height * this.scale) / 2 + this.panY;

            this.draw();
            return;
        }

        // Redraw only if the hover snap actually moved
        if (!this.isDragging || !this.dragPoint) {
            const nextHoverKey = this.getGuideStateKey(this.hoverState);
            if (previousHoverKey !== nextHoverKey) {
                this.draw();
            }
            return;
        }

        this.hasMoved = true;
        const dataCoords = Calibration.pixelToData(x, y);

        if (dataCoords) {
            Curves.updatePoint(this.dragPoint.id, x, y, dataCoords.x, dataCoords.y);
            this.draw();
        }
    },

    // Update coordinates display
    updateCoordsDisplay(imageX, imageY) {
        const coordsEl = document.getElementById('cursorCoords');
        if (!coordsEl) return;

        if (Calibration.isComplete) {
            const data = Calibration.pixelToData(imageX, imageY);
            if (data) {
                coordsEl.textContent = `X: ${data.x.toFixed(2)} Y: ${data.y.toFixed(3)}`;
            }
        } else {
            coordsEl.textContent = `X: ${Math.round(imageX)} Y: ${Math.round(imageY)}`;
        }
    },

    // Handle mouse up (end drag)
    handleMouseUp(e) {
        // Track if we were panning to prevent click from adding point
        this.wasPanning = this.isPanning && this.hasMoved;

        if (this.isDragging) {
            this.isDragging = false;
            this.dragPoint = null;
            this.dragCurve = null;
            App.saveState();
        }

        if (this.isPanning) {
            this.isPanning = false;
        }

        // Reset cursor to crosshair
        this.canvas.style.cursor = 'crosshair';

        this.hasMoved = false;

        // Reset wasPanning after a short delay (so click event can check it)
        setTimeout(() => { this.wasPanning = false; }, 50);
    },

    // Clear transient hover guides when the cursor leaves the canvas
    handleMouseLeave(e) {
        this.handleMouseUp(e);
        if (this.hoverState) {
            this.hoverState = null;
            this.draw();
        }
    },

    // Clear canvas
    clear() {
        this.image = null;
        this.imageData = null;
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.clearInteractionGuides();
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.updateZoomDisplay();
    }
};

// Main App module
const App = {
    // Undo/redo state
    undoStack: [],
    redoStack: [],
    maxUndoSteps: 50,

    // Initialize application
    init() {
        Canvas.init();
        this.setupEventListeners();
        this.setupDropZone();
        this.setupPasteHandler();
    },

    // Set up event listeners
    setupEventListeners() {
        // File input
        document.getElementById('browseBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadImageFile(e.target.files[0]);
            }
        });

        // Paste button - uses modern Clipboard API
        document.getElementById('pasteBtn').addEventListener('click', async () => {
            try {
                const clipboardItems = await navigator.clipboard.read();
                for (const item of clipboardItems) {
                    for (const type of item.types) {
                        if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            this.loadImageFile(blob);
                            return;
                        }
                    }
                }
                alert('No image found in clipboard. Copy an image first (e.g., screenshot or right-click > Copy Image)');
            } catch (err) {
                // Fallback message if clipboard API fails
                alert('Clipboard access denied. Please use Ctrl+V to paste, or drag & drop the image.');
            }
        });

        // Calibration buttons
        document.getElementById('calibrateBtn').addEventListener('click', () => {
            if (Calibration.isCalibrating) {
                Calibration.clear();
                Canvas.draw();
            } else {
                Calibration.start();
                Canvas.draw();
            }
        });

        document.getElementById('clearCalibrationBtn').addEventListener('click', () => {
            Calibration.clear();
            document.getElementById('gridControls').style.display = 'none';
            Canvas.draw();
        });

        // Grid controls
        document.getElementById('gridToggle').addEventListener('change', (e) => {
            Canvas.showGrid = e.target.checked;
            Canvas.draw();
        });

        document.getElementById('gridSpacingX').addEventListener('change', (e) => {
            const value = parseFloat(e.target.value) || 10;
            Canvas.gridSpacingX = value;
            if (Canvas.showGrid) Canvas.draw();
        });

        document.getElementById('gridSpacingY').addEventListener('change', (e) => {
            const value = parseFloat(e.target.value) || 0.1;
            Canvas.gridSpacingY = value;
            if (Canvas.showGrid) Canvas.draw();
        });

        // Curve buttons
        document.getElementById('addCurveBtn').addEventListener('click', () => {
            this.showCurveModal();
        });

        document.getElementById('saveCurveBtn').addEventListener('click', () => {
            this.addCurve();
        });

        // Export buttons
        document.getElementById('exportBtn').addEventListener('click', () => {
            Export.downloadCSV();
        });

        document.getElementById('copyBtn').addEventListener('click', () => {
            Export.copyToClipboard();
        });

        // Report button
        document.getElementById('reportBtn').addEventListener('click', () => {
            Report.downloadReport();
        });

        // Undo/redo buttons (footer)
        document.getElementById('undoBtn').addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('redoBtn').addEventListener('click', () => {
            this.redo();
        });

        // Undo/redo buttons (top toolbar)
        document.getElementById('undoBtnTop').addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('redoBtnTop').addEventListener('click', () => {
            this.redo();
        });

        // Zoom buttons
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            Canvas.zoomIn();
        });

        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            Canvas.zoomOut();
        });

        document.getElementById('zoomResetBtn').addEventListener('click', () => {
            Canvas.resetZoom();
        });

        // Digitize mode toggle
        document.querySelectorAll('input[name="digitizeMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                Canvas.digitizeMode = e.target.value;
                const autoSettings = document.getElementById('autoSettings');
                autoSettings.style.display = e.target.value === 'auto' ? 'block' : 'none';
                Calibration.updateInstructions();
            });
        });

        // Color tolerance slider
        document.getElementById('colorTolerance').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('toleranceValue').textContent = value;
            AutoDetect.colorTolerance = value;
        });

        // Detect all curves button
        document.getElementById('detectAllBtn').addEventListener('click', () => {
            Canvas.detectAllCurvesAuto();
        });

        // Reset button
        document.getElementById('resetBtn').addEventListener('click', () => {
            if (confirm('Reset everything? This will clear all data.')) {
                this.reset();
            }
        });

        // Help modal
        document.getElementById('helpBtn').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'flex';
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal').style.display = 'none';
            });
        });

        // Close modal on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.redo();
                    } else {
                        this.undo();
                    }
                } else if (e.key === 'y') {
                    e.preventDefault();
                    this.redo();
                }
            }
        });
    },

    // Set up drop zone
    setupDropZone() {
        const dropZone = document.getElementById('dropZone');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('dragover');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                this.loadImageFile(files[0]);
            }
        });
    },

    // Set up paste handler
    setupPasteHandler() {
        // Make drop zone focusable for paste to work
        const dropZone = document.getElementById('dropZone');
        dropZone.setAttribute('tabindex', '0');
        dropZone.addEventListener('click', () => dropZone.focus());

        // Listen on both window and document for maximum compatibility
        const handlePaste = (e) => {
            e.preventDefault();

            // Try clipboardData first (standard)
            let items = e.clipboardData?.items;

            if (items) {
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) {
                            this.loadImageFile(file);
                            return;
                        }
                    }
                }

                // Also check for files directly
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                    for (const file of files) {
                        if (file.type.startsWith('image/')) {
                            this.loadImageFile(file);
                            return;
                        }
                    }
                }
            }
        };

        document.addEventListener('paste', handlePaste);
        window.addEventListener('paste', handlePaste);

        // Focus the drop zone on page load so paste works immediately
        setTimeout(() => dropZone.focus(), 100);
    },

    // Load image from file
    loadImageFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            Canvas.loadImage(e.target.result).then(() => {
                this.showMainContent();
            });
        };
        reader.readAsDataURL(file);
    },

    // Show main content (hide drop zone)
    showMainContent() {
        document.getElementById('dropZone').style.display = 'none';
        document.getElementById('mainContent').style.display = 'grid';
        document.getElementById('footer').style.display = 'flex';

        // Trigger resize to fit canvas properly
        setTimeout(() => Canvas.fitImage(), 100);
    },

    // Show curve modal
    showCurveModal() {
        const modal = document.getElementById('curveModal');
        const nameInput = document.getElementById('curveName');
        const colorInput = document.getElementById('curveColor');

        // Set defaults
        const curveNum = Curves.curves.length + 1;
        nameInput.value = `Curve ${curveNum}`;
        colorInput.value = Curves.defaultColors[(curveNum - 1) % Curves.defaultColors.length];

        modal.style.display = 'flex';
        nameInput.focus();
        nameInput.select();
    },

    // Add curve from modal
    addCurve() {
        const name = document.getElementById('curveName').value.trim();
        const color = document.getElementById('curveColor').value;

        if (!name) {
            alert('Please enter a curve name');
            return;
        }

        // Collect curve-level metadata
        const metadata = {
            treatment: document.getElementById('curveTreatment').value.trim(),
            population: document.getElementById('curvePopulation').value.trim(),
            line: document.getElementById('curveLine').value.trim(),
            n: document.getElementById('curveN').value.trim(),
        };

        Curves.create(name, color, metadata);

        // Clear the metadata fields for next curve
        document.getElementById('curveTreatment').value = '';
        document.getElementById('curvePopulation').value = '';
        document.getElementById('curveLine').value = '';
        document.getElementById('curveN').value = '';

        document.getElementById('curveModal').style.display = 'none';
        Canvas.draw();
    },

    // Save state for undo
    saveState() {
        const state = Curves.serialize();

        // Don't save duplicate states
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === state) {
            return;
        }

        this.undoStack.push(state);

        // Limit stack size
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }

        // Clear redo stack on new action
        this.redoStack = [];

        this.updateUndoRedoButtons();
    },

    // Undo
    undo() {
        if (this.undoStack.length === 0) return;

        // Save current state to redo stack
        this.redoStack.push(Curves.serialize());

        // Restore previous state
        const state = this.undoStack.pop();
        Curves.deserialize(state);
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        Canvas.draw();

        this.updateUndoRedoButtons();
    },

    // Redo
    redo() {
        if (this.redoStack.length === 0) return;

        // Save current state to undo stack
        this.undoStack.push(Curves.serialize());

        // Restore redo state
        const state = this.redoStack.pop();
        Curves.deserialize(state);
        if (typeof Canvas !== 'undefined' && typeof Canvas.clearInteractionGuides === 'function') {
            Canvas.clearInteractionGuides();
        }
        Canvas.draw();

        this.updateUndoRedoButtons();
    },

    // Update undo/redo button states
    updateUndoRedoButtons() {
        const undoDisabled = this.undoStack.length === 0;
        const redoDisabled = this.redoStack.length === 0;

        // Footer buttons
        document.getElementById('undoBtn').disabled = undoDisabled;
        document.getElementById('redoBtn').disabled = redoDisabled;

        // Top toolbar buttons
        document.getElementById('undoBtnTop').disabled = undoDisabled;
        document.getElementById('redoBtnTop').disabled = redoDisabled;
    },

    // Reset everything
    reset() {
        Canvas.clear();
        Curves.clearAll();
        Calibration.clear();
        this.undoStack = [];
        this.redoStack = [];
        this.updateUndoRedoButtons();

        document.getElementById('dropZone').style.display = 'flex';
        document.getElementById('mainContent').style.display = 'none';
        document.getElementById('footer').style.display = 'none';
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

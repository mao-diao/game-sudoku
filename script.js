/**
 * 数独游戏 - Sudoku Game
 * 完整游戏逻辑，包含 Generator、Validator、Storage、Timer、UI、Game 六大模块
 */
(function () {
    'use strict';

    // ============================================================
    //  Constants & Config
    // ============================================================
    const N = 9;
    const CELLS = N * N;

    const DIFFICULTY = {
        easy: { cellsToRemove: 36, maxMistakes: 5, label: '简单', cls: 'easy' },
        medium: { cellsToRemove: 46, maxMistakes: 3, label: '中级', cls: 'medium' },
        hard: { cellsToRemove: 54, maxMistakes: 2, label: '高级', cls: 'hard' },
    };

    const STORAGE_KEYS = {
        PROGRESS: 'sudoku_progress',
        RECORDS: 'sudoku_records',
        SETTINGS: 'sudoku_settings',
    };

    const MAX_HISTORY = 30;
    const GENERATION_TIMEOUT = 2000; // ms
    const MAX_RETRIES = 3;
    const SAVE_DEBOUNCE = 500;

    // ============================================================
    //  Utility Helpers
    // ============================================================
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function getRow(index) { return Math.floor(index / N); }
    function getCol(index) { return index % N; }
    function getBox(index) {
        const r = getRow(index), c = getCol(index);
        return 3 * Math.floor(r / 3) + Math.floor(c / 3);
    }

    function getPeers(index) {
        const peers = new Set();
        const r = getRow(index), c = getCol(index), b = getBox(index);
        for (let i = 0; i < CELLS; i++) {
            if (i === index) continue;
            if (getRow(i) === r || getCol(i) === c || getBox(i) === b) {
                peers.add(i);
            }
        }
        return peers;
    }

    // Precompute peers for all cells
    const PEERS = Array.from({ length: CELLS }, (_, i) => getPeers(i));

    function deepClone(arr) {
        return arr.map(v => Array.isArray(v) ? deepClone(v) : v);
    }

    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // ============================================================
    //  Generator Module
    // ============================================================
    const Generator = {
        /**
         * Generate a complete valid Sudoku grid using randomized backtracking.
         * Strategy: fill diagonal 3x3 boxes first (they are independent), then solve the rest.
         */
        _generateComplete() {
            const grid = new Array(CELLS).fill(0);

            // Fill diagonal boxes (0, 4, 8) — they don't constrain each other
            for (let box = 0; box < 9; box += 4) {
                const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
                const startRow = 3 * Math.floor(box / 3);
                const startCol = 3 * (box % 3);
                let idx = 0;
                for (let r = startRow; r < startRow + 3; r++) {
                    for (let c = startCol; c < startCol + 3; c++) {
                        grid[r * N + c] = nums[idx++];
                    }
                }
            }

            // Solve remaining cells with randomized backtracking
            if (!this._solve(grid)) {
                throw new Error('Failed to generate complete grid');
            }
            return grid;
        },

        _solve(grid) {
            const emptyIdx = grid.indexOf(0);
            if (emptyIdx === -1) return true;

            const candidates = shuffle(this._getCandidates(grid, emptyIdx));
            for (const val of candidates) {
                grid[emptyIdx] = val;
                if (this._solve(grid)) return true;
                grid[emptyIdx] = 0;
            }
            return false;
        },

        _getCandidates(grid, index) {
            const used = new Set();
            const r = getRow(index), c = getCol(index), b = getBox(index);
            for (let i = 0; i < CELLS; i++) {
                if (getRow(i) === r || getCol(i) === c || getBox(i) === b) {
                    if (grid[i] !== 0) used.add(grid[i]);
                }
            }
            const result = [];
            for (let v = 1; v <= N; v++) {
                if (!used.has(v)) result.push(v);
            }
            return result;
        },

        /**
         * Count solutions up to `limit`. Returns early when limit is reached.
         */
        _countSolutions(grid, limit) {
            let count = 0;
            const copy = [...grid];

            function solve() {
                const idx = copy.indexOf(0);
                if (idx === -1) {
                    count++;
                    return count >= limit;
                }

                const candidates = Generator._getCandidates(copy, idx);
                for (const val of candidates) {
                    copy[idx] = val;
                    if (solve()) return true;
                    copy[idx] = 0;
                }
                return false;
            }

            solve();
            return count;
        },

        /**
         * Remove cells from a complete grid to create a puzzle, ensuring a unique solution.
         */
        _createPuzzle(completeGrid, cellsToRemove) {
            const puzzle = [...completeGrid];
            const indices = shuffle(Array.from({ length: CELLS }, (_, i) => i));
            let removed = 0;

            for (const idx of indices) {
                if (removed >= cellsToRemove) break;
                const backup = puzzle[idx];
                puzzle[idx] = 0;

                // Check uniqueness: count solutions up to 2
                if (this._countSolutions(puzzle, 2) === 1) {
                    removed++;
                } else {
                    puzzle[idx] = backup; // restore
                }
            }

            // If we couldn't remove enough cells, the puzzle is still playable
            return puzzle;
        },

        /**
         * Public API: generate a puzzle at the given difficulty.
         * Returns { puzzle: number[], solution: number[] }
         */
        generate(difficulty) {
            const config = DIFFICULTY[difficulty];
            if (!config) throw new Error('Unknown difficulty: ' + difficulty);

            const startTime = performance.now();

            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                const solution = this._generateComplete();

                // Check timeout across attempts
                if (performance.now() - startTime > GENERATION_TIMEOUT) {
                    throw new Error('Generation timed out');
                }

                const puzzle = this._createPuzzle(solution, config.cellsToRemove);
                return { puzzle, solution };
            }

            throw new Error('Failed to generate puzzle after ' + MAX_RETRIES + ' attempts');
        },
    };

    // ============================================================
    //  Validator Module
    // ============================================================
    const Validator = {
        /**
         * Find all cells that have duplicate values in their row, column, or box.
         * Returns a Set of cell indices.
         */
        findConflicts(grid) {
            const conflicts = new Set();

            // Check rows
            for (let r = 0; r < N; r++) {
                const seen = {};
                for (let c = 0; c < N; c++) {
                    const idx = r * N + c;
                    const val = grid[idx];
                    if (val === 0) continue;
                    if (seen[val] !== undefined) {
                        conflicts.add(idx);
                        conflicts.add(seen[val]);
                    } else {
                        seen[val] = idx;
                    }
                }
            }

            // Check columns
            for (let c = 0; c < N; c++) {
                const seen = {};
                for (let r = 0; r < N; r++) {
                    const idx = r * N + c;
                    const val = grid[idx];
                    if (val === 0) continue;
                    if (seen[val] !== undefined) {
                        conflicts.add(idx);
                        conflicts.add(seen[val]);
                    } else {
                        seen[val] = idx;
                    }
                }
            }

            // Check boxes
            for (let b = 0; b < N; b++) {
                const seen = {};
                const startR = 3 * Math.floor(b / 3);
                const startC = 3 * (b % 3);
                for (let dr = 0; dr < 3; dr++) {
                    for (let dc = 0; dc < 3; dc++) {
                        const idx = (startR + dr) * N + (startC + dc);
                        const val = grid[idx];
                        if (val === 0) continue;
                        if (seen[val] !== undefined) {
                            conflicts.add(idx);
                            conflicts.add(seen[val]);
                        } else {
                            seen[val] = idx;
                        }
                    }
                }
            }

            return conflicts;
        },

        /**
         * Check if grid is completely and correctly solved.
         */
        isSolved(grid, solution) {
            for (let i = 0; i < CELLS; i++) {
                if (grid[i] !== solution[i]) return false;
            }
            return true;
        },

        /**
         * Check if placing `value` at `index` violates row/col/box constraints.
         */
        isValidPlacement(grid, index, value) {
            if (value === 0) return true;
            for (const peer of PEERS[index]) {
                if (grid[peer] === value) return false;
            }
            return true;
        },
    };

    // ============================================================
    //  Storage Module
    // ============================================================
    const Storage = {
        isAvailable() {
            try {
                const key = '__storage_test__';
                localStorage.setItem(key, '1');
                localStorage.removeItem(key);
                return true;
            } catch {
                return false;
            }
        },

        _available: null,

        _check() {
            if (this._available === null) {
                this._available = this.isAvailable();
            }
            return this._available;
        },

        saveProgress(state) {
            if (!this._check()) return false;
            try {
                const data = {
                    puzzle: state.puzzle,
                    userGrid: state.userGrid,
                    pencilMarks: state.pencilMarks,
                    solution: state.solution,
                    difficulty: state.difficulty,
                    mistakes: state.mistakes,
                    hintsUsed: state.hintsUsed,
                    cellsRevealed: Array.from(state.cellsRevealed),
                    elapsedBeforePause: Timer.getElapsed(),
                    maxMistakes: state.maxMistakes,
                    savedAt: new Date().toISOString(),
                    version: 1,
                };
                localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(data));
                return true;
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    // Try clearing old progress
                    try {
                        localStorage.removeItem(STORAGE_KEYS.PROGRESS);
                        localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(data));
                        return true;
                    } catch { /* ignore */ }
                }
                return false;
            }
        },

        loadProgress() {
            if (!this._check()) return null;
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.PROGRESS);
                if (!raw) return null;
                const data = JSON.parse(raw);
                // Basic validation
                if (!data.puzzle || !data.userGrid || !data.solution || !data.difficulty) {
                    this.clearProgress();
                    return null;
                }
                // Convert cellsRevealed back to Set
                data.cellsRevealed = new Set(data.cellsRevealed || []);
                return data;
            } catch {
                this.clearProgress();
                return null;
            }
        },

        clearProgress() {
            if (!this._check()) return;
            try {
                localStorage.removeItem(STORAGE_KEYS.PROGRESS);
            } catch { /* ignore */ }
        },

        hasSavedGame() {
            if (!this._check()) return false;
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.PROGRESS);
                if (!raw) return false;
                const data = JSON.parse(raw);
                return !!(data.puzzle && data.userGrid && data.difficulty);
            } catch {
                return false;
            }
        },

        saveRecord(record) {
            if (!this._check()) return false;
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.RECORDS);
                const records = raw ? JSON.parse(raw) : [];
                const diff = record.difficulty;
                const existing = records.find(r => r.difficulty === diff);

                if (existing) {
                    existing.totalGames = (existing.totalGames || 0) + 1;
                    existing.totalWins = (existing.totalWins || 0) + 1;
                    existing.lastPlayed = new Date().toISOString();
                    existing.recentTimes = (existing.recentTimes || []).concat(record.time).slice(-10);
                    if (existing.bestTime === null || record.time < existing.bestTime) {
                        existing.bestTime = record.time;
                    }
                    existing.currentStreak = (existing.currentStreak || 0) + 1;
                    if (existing.currentStreak > (existing.longestStreak || 0)) {
                        existing.longestStreak = existing.currentStreak;
                    }
                } else {
                    records.push({
                        difficulty: diff,
                        bestTime: record.time,
                        totalGames: 1,
                        totalWins: 1,
                        currentStreak: 1,
                        longestStreak: 1,
                        lastPlayed: new Date().toISOString(),
                        recentTimes: [record.time],
                    });
                }

                localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
                return true;
            } catch {
                return false;
            }
        },

        getRecords() {
            if (!this._check()) return [];
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.RECORDS);
                return raw ? JSON.parse(raw) : [];
            } catch {
                return [];
            }
        },

        saveSettings(settings) {
            if (!this._check()) return;
            try {
                localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
            } catch { /* ignore */ }
        },

        loadSettings() {
            if (!this._check()) return {};
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
                return raw ? JSON.parse(raw) : {};
            } catch {
                return {};
            }
        },
    };

    // ============================================================
    //  Timer Module
    // ============================================================
    const Timer = {
        _intervalId: null,
        _startTime: null,
        _elapsedBeforePause: 0,

        start() {
            if (this._startTime !== null) return;
            this._startTime = Date.now();
            this._intervalId = setInterval(() => this._tick(), 100);
        },

        stop() {
            if (this._intervalId !== null) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
            if (this._startTime !== null) {
                this._elapsedBeforePause += Date.now() - this._startTime;
                this._startTime = null;
            }
        },

        getElapsed() {
            let total = this._elapsedBeforePause;
            if (this._startTime !== null) {
                total += Date.now() - this._startTime;
            }
            return total;
        },

        setElapsed(ms) {
            this._elapsedBeforePause = ms;
            if (this._startTime !== null) {
                this._startTime = Date.now();
            }
        },

        reset() {
            this.stop();
            this._startTime = null;
            this._elapsedBeforePause = 0;
        },

        _tick() {
            UI.updateTimerDisplay(this.getElapsed());
        },

        format(ms) {
            return formatTime(ms);
        },
    };

    // ============================================================
    //  PrintGenerator Module — generate multi-puzzle printable pages
    // ============================================================
    const PrintGenerator = {
        /** Generate 1 puzzle and print with solution on the same page */
        doPrint(difficulty) {
            const content = document.getElementById('print-content');

            try {
                const p = Generator.generate(difficulty);
                const uid = String(Math.floor(1000 + Math.random() * 9000));

                let html = '<div class="print-page">';

                // Puzzle section
                html += '<div class="print-section-top">';
                html += `<div class="print-puzzle-title">数独（${DIFFICULTY[difficulty] ? DIFFICULTY[difficulty].label : difficulty} #${uid}）</div>`;
                html += '<div class="print-board">';
                for (let i = 0; i < CELLS; i++) {
                    const val = p.puzzle[i];
                    html += `<div class="print-cell ${val !== 0 ? 'prefilled' : 'empty'}">${val !== 0 ? val : ''}</div>`;
                }
                html += '</div></div>';

                // Gap between puzzle and solution
                html += '<div class="print-gap"></div>';

                // Solution section
                html += '<div class="print-section-bottom">';
                html += `<div class="print-solution-title">答案（#${uid}）</div>`;
                html += '<div class="print-board solution">';
                for (let i = 0; i < CELLS; i++) {
                    html += `<div class="print-cell prefilled">${p.solution[i]}</div>`;
                }
                html += '</div></div>';

                html += '</div>';

                content.innerHTML = html;

                // Trigger print
                setTimeout(() => window.print(), 100);

                // Cleanup after print dialog closes
                const onPrint = () => {
                    content.innerHTML = '';
                    window.removeEventListener('focus', onPrint);
                };
                window.addEventListener('focus', onPrint);
            } catch (err) {
                alert('生成谜题失败：' + err.message);
            }
        },
    };

    // ============================================================
    //  Solver Module — independent puzzle solver page
    // ============================================================
    const Solver = {
        grid: new Array(CELLS).fill(0),
        solution: null,
        selectedCell: null,
        selectedNumber: 1,
        isSolving: false,

        init() {
            const board = document.getElementById('solve-board');
            if (!board) return; // not on solve page

            board.innerHTML = '';
            for (let i = 0; i < CELLS; i++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.index = i;
                cell.setAttribute('role', 'gridcell');
                cell.setAttribute('tabindex', '-1');
                if (getCol(i) % 3 === 2 && getCol(i) !== 8) cell.classList.add('box-right');
                if (getRow(i) % 3 === 2 && getRow(i) !== 8) cell.classList.add('box-bottom');
                board.appendChild(cell);
            }

            this._bindEvents();
            this._render();
        },

        _bindEvents() {
            // Board click
            document.getElementById('solve-board').addEventListener('click', (e) => {
                const cell = e.target.closest('.cell');
                if (!cell || this.isSolving) return;
                const idx = parseInt(cell.dataset.index, 10);
                this.selectedCell = idx;
                // Place selected number
                if (this.selectedNumber > 0) {
                    this._inputNumber(idx, this.selectedNumber);
                } else {
                    this._inputNumber(idx, 0);
                }
                this._render();
            });

            // Numpad
            document.querySelectorAll('.numpad .num-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.isSolving) return;
                    const val = parseInt(btn.dataset.value, 10);
                    this.selectedNumber = val;
                    this._render();
                });
            });

            // Keyboard
            document.addEventListener('keydown', (e) => {
                if (this.isSolving) return;
                if (e.key >= '1' && e.key <= '9') {
                    this.selectedNumber = parseInt(e.key, 10);
                    if (this.selectedCell !== null) {
                        this._inputNumber(this.selectedCell, this.selectedNumber);
                        this._render();
                    } else {
                        this._render();
                    }
                    e.preventDefault();
                }
                if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
                    if (this.selectedCell !== null) {
                        this._inputNumber(this.selectedCell, 0);
                        this._render();
                    }
                    e.preventDefault();
                }
                // Arrow keys
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    if (this.selectedCell === null) { this.selectedCell = 0; }
                    else {
                        let r = getRow(this.selectedCell), c = getCol(this.selectedCell);
                        if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
                        if (e.key === 'ArrowDown') r = Math.min(8, r + 1);
                        if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
                        if (e.key === 'ArrowRight') c = Math.min(8, c + 1);
                        this.selectedCell = r * 9 + c;
                    }
                    this._render();
                }
            });

            // Solve button
            document.getElementById('solve-btn').addEventListener('click', () => this.solve());

            // Clear button
            document.getElementById('clear-btn').addEventListener('click', () => {
                if (this.isSolving) return;
                this.grid.fill(0);
                this.solution = null;
                this.selectedCell = null;
                this._setStatus('等待输入', '');
                this._setMessage('');
                this._render();
            });
        },

        _inputNumber(idx, val) {
            if (val === 0) {
                this.grid[idx] = 0;
                return;
            }
            // Validate: check for conflicts in row/col/box
            const peers = PEERS[idx];
            for (const p of peers) {
                if (this.grid[p] === val) {
                    return; // conflict — reject
                }
            }
            this.grid[idx] = val;
        },

        _getConflicts() {
            return Validator.findConflicts(this.grid);
        },

        _render() {
            const board = document.getElementById('solve-board');
            if (!board) return;

            const conflicts = this._getConflicts();

            for (let i = 0; i < CELLS; i++) {
                const cell = board.children[i];
                if (!cell) continue;
                const val = this.grid[i];

                cell.className = 'cell';
                if (getCol(i) % 3 === 2 && getCol(i) !== 8) cell.classList.add('box-right');
                if (getRow(i) % 3 === 2 && getRow(i) !== 8) cell.classList.add('box-bottom');

                cell.textContent = val !== 0 ? val : '';

                if (val !== 0) {
                    cell.classList.add('user-value');
                }

                if (this.selectedCell === i) {
                    cell.classList.add('selected');
                }
                if (this.selectedCell !== null && this.selectedCell !== i) {
                    if (PEERS[this.selectedCell].has(i)) {
                        cell.classList.add('peer');
                    }
                    if (this.grid[this.selectedCell] !== 0 && this.grid[i] !== 0 &&
                        this.grid[i] === this.grid[this.selectedCell]) {
                        cell.classList.add('same-value');
                    }
                }
                if (conflicts.has(i) && val !== 0) {
                    cell.classList.add('conflict');
                }
                if (this.selectedNumber > 0 && val === this.selectedNumber && !conflicts.has(i)) {
                    cell.classList.add('number-match');
                }
            }

            // Update numpad
            document.querySelectorAll('.numpad .num-btn').forEach(btn => {
                const val = parseInt(btn.dataset.value, 10);
                btn.classList.remove('selected', 'completed');
                // Remove existing badge
                const badge = btn.querySelector('.remaining-badge');
                if (badge) badge.remove();

                if (val === 0) {
                    if (this.selectedNumber === 0) btn.classList.add('selected');
                    return;
                }
                if (this.selectedNumber === val) btn.classList.add('selected');
            });

            // Update undo
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.disabled = true;
        },

        _setStatus(text, cls) {
            const el = document.getElementById('solve-status');
            if (el) {
                el.textContent = text;
                el.className = 'solve-status' + (cls ? ' ' + cls : '');
            }
        },

        _setMessage(text, cls) {
            const el = document.getElementById('solve-message');
            if (el) {
                el.textContent = text;
                el.className = 'solve-message' + (cls ? ' ' + cls : '');
            }
        },

        /**
         * Backtracking solver — solves from current grid state.
         */
        _solveGrid(grid) {
            this._solveAttempts = 0;
            const copy = [...grid];
            const emptyCount = copy.filter(v => v === 0).length;
            console.log(`🔍 解题器开始求解，共 ${emptyCount} 个空格`);
            console.log('📋 初始盘面（0=空格）：');
            this._logGrid(copy);

            if (this._backtrack(copy)) {
                console.log(`✅ 解题成功！共尝试 ${this._solveAttempts} 步`);
                this._logGrid(copy);
                return copy;
            }
            console.log(`❌ 解题失败（共尝试 ${this._solveAttempts} 步）—— 当前盘面无解`);
            return null;
        },

        /**
         * 在控制台以 9×9 网格形式打印盘面
         */
        _logGrid(grid) {
            const rows = [];
            for (let r = 0; r < 9; r++) {
                const row = grid.slice(r * 9, r * 9 + 9)
                    .map(v => v === 0 ? '.' : String(v))
                    .join(' ');
                rows.push(row);
            }
            console.log(rows.join('\n'));
        },

        _backtrack(grid, depth = 0) {
            const idx = grid.indexOf(0);
            if (idx === -1) {
                console.log(`🎯 回溯完成，深度 ${depth}`);
                return true;
            }

            const candidates = Generator._getCandidates(grid, idx);
            const r = Math.floor(idx / 9), c = idx % 9;

            console.log(`  ${'  '.repeat(depth)}▶ 尝试填 [${r + 1},${c + 1}]（索引 ${idx}），候选: [${candidates.join(', ')}]`);

            for (const val of candidates) {
                this._solveAttempts++;
                grid[idx] = val;
                console.log(`  ${'  '.repeat(depth)}  ├─ 填入 ${val}，递归...`);
                if (this._backtrack(grid, depth + 1)) return true;
                grid[idx] = 0;
                console.log(`  ${'  '.repeat(depth)}  └─ 回溯 [${r + 1},${c + 1}]（${val} 不成立）`);
            }

            if (depth === 0) {
                console.log(`  ⚠️  第一层无候选可填，无解`);
            }
            return false;
        },

        async solve() {
            if (this.isSolving) return;

            // Check for conflicts
            const conflicts = this._getConflicts();
            if (conflicts.size > 0) {
                this._setStatus('输入有冲突', 'error');
                this._setMessage('请先消除红色冲突格', 'error');
                return;
            }

            // Check if already solved
            const emptyCount = this.grid.filter(v => v === 0).length;
            if (emptyCount === 0) {
                this._setStatus('已完成', 'done');
                this._setMessage('棋盘已填满');
                return;
            }

            this.isSolving = true;
            this._setStatus('解题中...', 'solving');
            this._setMessage('');
            document.getElementById('solve-btn').disabled = true;

            // Run solver (synchronous, but wrapped in setTimeout to let UI update)
            await new Promise(r => setTimeout(r, 50));

            const solution = this._solveGrid(this.grid);
            if (!solution) {
                this._setStatus('无解', 'error');
                this._setMessage('当前输入无解，请检查', 'error');
                this.isSolving = false;
                document.getElementById('solve-btn').disabled = false;
                return;
            }

            this.solution = solution;

            // Find cells to fill (empty or wrong)
            const toFill = [];
            for (let i = 0; i < CELLS; i++) {
                if (this.grid[i] !== solution[i]) {
                    toFill.push({ index: i, value: solution[i] });
                }
            }
            console.log(`📦 共找到 ${toFill.length} 个待填入单元格（计算总步数：${this._solveAttempts}），开始动画填充...`);

            // Animate filling one by one
            const board = document.getElementById('solve-board');
            for (let i = 0; i < toFill.length; i++) {
                await new Promise(r => setTimeout(r, 20));
                const { index, value } = toFill[i];
                this.grid[index] = value;

                // Update cell with animation
                const cell = board.children[index];
                if (cell) {
                    cell.textContent = value;
                    cell.className = 'cell user-value solved solving-anim';
                    if (getCol(index) % 3 === 2 && getCol(index) !== 8) cell.classList.add('box-right');
                    if (getRow(index) % 3 === 2 && getRow(index) !== 8) cell.classList.add('box-bottom');
                }
            }

            this._setStatus('解题完成', 'done');
            this._setMessage(`共填入 ${toFill.length} 个数字`, 'success');
            this.isSolving = false;
            document.getElementById('solve-btn').disabled = false;
            this._render();
        },
    };

    // ============================================================
    //  Game State (shared between Game and UI modules)
    // ============================================================
    const state = {
        status: 'idle', // 'idle' | 'generating' | 'playing' | 'paused' | 'won'
        difficulty: null,
        solution: [],
        puzzle: [],
        userGrid: [],
        pencilMarks: [],
        mistakes: 0,
        maxMistakes: 3,
        hintsUsed: 0,
        cellsRevealed: new Set(),
        selectedCell: null,
        selectedNumber: 1, // 0 = erase mode, 1-9 = number to place
        selectedMode: 'value', // 'value' | 'pencil'
        conflicts: new Set(),
        autoCheck: false,
        history: [],
    };

    // ============================================================
    //  UI Module
    // ============================================================
    const UI = {
        els: {},

        init() {
            // Cache DOM elements
            this.els = {
                startScreen: document.getElementById('start-screen'),
                gameScreen: document.getElementById('game-screen'),
                winScreen: document.getElementById('win-screen'),
                board: document.getElementById('board'),
                timerDisplay: document.getElementById('timer-display'),
                mistakesDisplay: document.getElementById('mistakes-display'),
                diffLabel: document.getElementById('diff-label'),
                resumeBtn: document.getElementById('resume-btn'),
                resumeInfo: document.getElementById('resume-info'),
                recordsContent: document.getElementById('records-content'),
                storageWarning: document.getElementById('storage-warning'),
                pauseOverlay: document.getElementById('pause-overlay'),
                generatingOverlay: document.getElementById('generating-overlay'),
                errorOverlay: document.getElementById('error-overlay'),
                errorMessage: document.getElementById('error-message'),
                winDifficulty: document.getElementById('win-difficulty'),
                winTime: document.getElementById('win-time'),
                winMistakes: document.getElementById('win-mistakes'),
                winHints: document.getElementById('win-hints'),
                newRecordBadge: document.getElementById('new-record-badge'),
                undoBtn: document.getElementById('undo-btn'),
                hintBtn: document.getElementById('hint-btn'),
                autoCheckBtn: document.getElementById('auto-check-btn'),
                pencilBtn: document.getElementById('pencil-btn'),
                numpadBtns: document.querySelectorAll('.num-btn'),
            };

            this._bindEvents();
        },

        _bindEvents() {
            // Difficulty buttons
            document.querySelectorAll('.diff-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const diff = btn.dataset.difficulty;
                    Game.startNewGame(diff);
                });
            });

            // Resume button
            this.els.resumeBtn.addEventListener('click', () => Game.resumeSavedGame());

            // Back button
            document.getElementById('back-btn').addEventListener('click', () => Game.quitToMenu());

            // Board click (delegation) — click cell to place selected number
            this.els.board.addEventListener('click', (e) => {
                const cell = e.target.closest('.cell');
                if (!cell) return;
                const index = parseInt(cell.dataset.index, 10);
                if (state.status !== 'playing') {
                    Game.selectCell(index);
                    return;
                }
                // Set the selected cell for context
                state.selectedCell = index;
                // Place selected number or erase into modifiable cells
                if (state.puzzle[index] === 0) {
                    if (state.selectedNumber > 0) {
                        Game.placeNumber(state.selectedNumber);
                    } else {
                        Game.placeNumber(0); // erase mode
                    }
                }
                UI.updateBoard();
            });

            // Keyboard input
            document.addEventListener('keydown', (e) => this._onKeyDown(e));

            // Numpad — click to select a number (not place it)
            this.els.numpadBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const val = parseInt(btn.dataset.value, 10);
                    Game.selectNumber(val);
                });
            });

            // Action buttons
            document.getElementById('undo-btn').addEventListener('click', () => Game.undo());
            document.getElementById('hint-btn').addEventListener('click', () => Game.useHint());
            document.getElementById('auto-check-btn').addEventListener('click', () => Game.toggleAutoCheck());
            document.getElementById('pencil-btn').addEventListener('click', () => Game.togglePencilMode());

            // Footer buttons
            document.getElementById('pause-btn').addEventListener('click', () => Game.pauseGame());
            document.getElementById('save-btn').addEventListener('click', () => Game.saveAndQuit());
            document.getElementById('restart-btn').addEventListener('click', () => Game.restartGame());

            // Overlay buttons
            document.getElementById('resume-game-btn').addEventListener('click', () => Game.resumeGame());
            document.getElementById('quit-btn').addEventListener('click', () => Game.quitToMenu());
            document.getElementById('error-retry-btn').addEventListener('click', () => {
                this.hideOverlay('error');
                Game.startNewGame(state.difficulty);
            });
            document.getElementById('error-back-btn').addEventListener('click', () => {
                this.hideOverlay('error');
                Game.quitToMenu();
            });

            // Win screen buttons
            document.getElementById('play-again-btn').addEventListener('click', () => {
                Game.startNewGame(state.difficulty);
            });
            document.getElementById('win-menu-btn').addEventListener('click', () => Game.quitToMenu());

            // Print / PDF buttons
            // Print button — generate 2 puzzles and call system print
            // Print button -- show difficulty dialog
            document.getElementById("print-btn").addEventListener("click", () => {
                UI.showOverlay("print-diff-dialog");
            });
            document.querySelectorAll(".print-diff-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const diff = btn.dataset.diff;
                    UI.hideOverlay("print-diff-dialog");
                    PrintGenerator.doPrint(diff);
                });
            });
            document.getElementById("print-diff-cancel").addEventListener("click", () => {
                UI.hideOverlay("print-diff-dialog");
            });

            // Storage event for cross-tab sync
            window.addEventListener('storage', (e) => {
                if (e.key === STORAGE_KEYS.PROGRESS && e.newValue === null && state.status === 'playing') {
                    Game.quitToMenu();
                }
            });

            // Auto-save on page hide
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && state.status === 'playing') {
                    Game._saveState();
                }
            });

            // Before unload save
            window.addEventListener('beforeunload', () => {
                if (state.status === 'playing') {
                    Game._saveState();
                }
            });
        },

        _onKeyDown(e) {
            if (state.status !== 'playing') return;

            // Number keys 1-9 — select the number (same as clicking numpad)
            if (e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                Game.selectNumber(parseInt(e.key, 10));
                return;
            }

            // Enter or Space — place selected number into selected cell
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (state.selectedCell !== null) {
                    Game.placeNumber(state.selectedNumber);
                    UI.updateBoard();
                }
                return;
            }

            // Erase mode
            if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
                e.preventDefault();
                Game.selectNumber(0);
                return;
            }

            // Arrow keys for navigation
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this._navigateByArrow(e.key);
                return;
            }

            // Toggle pencil mode
            if (e.key === 'p' || e.key === 'P') {
                Game.togglePencilMode();
                return;
            }

            // Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                Game.undo();
                return;
            }

            // Hint
            if (e.key === 'h' || e.key === 'H') {
                Game.useHint();
                return;
            }
        },

        _navigateByArrow(key) {
            if (state.selectedCell === null) {
                Game.selectCell(0);
                return;
            }

            let row = getRow(state.selectedCell);
            let col = getCol(state.selectedCell);

            switch (key) {
                case 'ArrowUp': row = Math.max(0, row - 1); break;
                case 'ArrowDown': row = Math.min(N - 1, row + 1); break;
                case 'ArrowLeft': col = Math.max(0, col - 1); break;
                case 'ArrowRight': col = Math.min(N - 1, col + 1); break;
            }

            Game.selectCell(row * N + col);
        },

        // ===== Screen Management =====
        showScreen(screenId) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(screenId).classList.add('active');
        },

        // ===== Board Rendering =====
        renderBoard() {
            const board = this.els.board;
            board.innerHTML = '';
            for (let i = 0; i < CELLS; i++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.index = i;
                cell.setAttribute('role', 'gridcell');
                cell.setAttribute('tabindex', '-1');

                // 3x3 box borders
                if (getCol(i) % 3 === 2 && getCol(i) !== 8) cell.classList.add('box-right');
                if (getRow(i) % 3 === 2 && getRow(i) !== 8) cell.classList.add('box-bottom');

                board.appendChild(cell);
            }
            this.updateBoard();
        },

        updateBoard() {
            for (let i = 0; i < CELLS; i++) {
                this._updateCell(i);
            }
            this.updateNumpad();
            this.els.undoBtn.disabled = state.history.length === 0;
        },

        _updateCell(index) {
            const cell = this.els.board.children[index];
            if (!cell) return;
            const val = state.userGrid[index];

            // Reset classes
            cell.className = 'cell';
            if (getCol(index) % 3 === 2 && getCol(index) !== 8) cell.classList.add('box-right');
            if (getRow(index) % 3 === 2 && getRow(index) !== 8) cell.classList.add('box-bottom');

            // Value
            cell.textContent = val !== 0 ? val : '';

            // State classes
            if (state.puzzle[index] !== 0) {
                cell.classList.add('prefilled');
            } else if (state.cellsRevealed.has(index)) {
                cell.classList.add('hint-revealed');
            } else if (val !== 0) {
                cell.classList.add('user-value');
            }

            // Selected
            if (state.selectedCell === index) {
                cell.classList.add('selected');
            }

            // Peer & same value highlighting
            if (state.selectedCell !== null && state.selectedCell !== index) {
                if (PEERS[state.selectedCell].has(index)) {
                    cell.classList.add('peer');
                }
                if (state.userGrid[state.selectedCell] !== 0 &&
                    state.userGrid[index] !== 0 &&
                    state.userGrid[index] === state.userGrid[state.selectedCell]) {
                    cell.classList.add('same-value');
                }
            }

            // Conflicts
            if (state.conflicts.has(index) && val !== 0) {
                cell.classList.add('conflict');
            }

            // Numpad number highlight: when a number is selected, highlight all matching cells
            if (state.selectedNumber > 0 && val === state.selectedNumber &&
                !state.conflicts.has(index)) {
                cell.classList.add('number-match');
            }

            // Pencil marks
            const existingPencil = cell.querySelector('.pencil-container');
            if (existingPencil) existingPencil.remove();

            if (val === 0 && state.pencilMarks[index] && state.pencilMarks[index].length > 0) {
                const container = document.createElement('div');
                container.className = 'pencil-container';
                for (let n = 1; n <= N; n++) {
                    const mark = document.createElement('span');
                    mark.className = 'pencil-mark';
                    mark.textContent = state.pencilMarks[index].includes(n) ? n : '';
                    container.appendChild(mark);
                }
                cell.appendChild(container);
            }
        },

        // ===== Numpad =====
        updateNumpad() {
            // Calculate remaining count per number
            const remaining = {};
            for (let n = 1; n <= 9; n++) {
                let placed = 0;
                for (let i = 0; i < CELLS; i++) {
                    if (state.userGrid[i] === n && state.solution[i] === n) placed++;
                }
                remaining[n] = 9 - placed;
            }

            this.els.numpadBtns.forEach(btn => {
                const val = parseInt(btn.dataset.value, 10);

                // Clear previous states
                btn.classList.remove('selected', 'completed');
                let badge = btn.querySelector('.remaining-badge');
                if (badge) badge.remove();

                if (val === 0) {
                    // Erase button
                    if (state.selectedNumber === 0) btn.classList.add('selected');
                    return;
                }

                // Selected state
                if (state.selectedNumber === val) {
                    btn.classList.add('selected');
                }

                // Remaining count badge
                if (remaining[val] > 0) {
                    badge = document.createElement('span');
                    badge.className = 'remaining-badge';
                    badge.textContent = remaining[val];
                    btn.appendChild(badge);
                }

                // Completed (all placed)
                if (remaining[val] === 0) {
                    btn.classList.add('completed');
                }
            });
        },

        // ===== Timer =====
        updateTimerDisplay(ms) {
            this.els.timerDisplay.textContent = formatTime(ms);
        },

        // ===== Mistakes =====
        updateMistakes() {
            const max = state.maxMistakes;
            const text = `失误: ${state.mistakes}/${max}`;
            this.els.mistakesDisplay.textContent = text;

            this.els.mistakesDisplay.classList.remove('warning', 'danger');
            if (state.mistakes >= max) {
                this.els.mistakesDisplay.classList.add('danger');
            } else if (state.mistakes >= max - 1) {
                this.els.mistakesDisplay.classList.add('warning');
            }
        },

        // ===== Pencil Mode Toggle =====
        updatePencilMode() {
            this.els.pencilBtn.classList.toggle('active', state.selectedMode === 'pencil');
        },

        // ===== Auto Check =====
        updateAutoCheck() {
            this.els.autoCheckBtn.classList.toggle('active', state.autoCheck);
        },

        // ===== Start Screen =====
        renderStartScreen() {
            this.showScreen('start-screen');

            // Check for saved game
            if (Storage.hasSavedGame()) {
                const saved = Storage.loadProgress();
                if (saved) {
                    // 检查存档是否已完成（填满且正确）——已完成则清除存档，不显示继续入口
                    const isCompleted = saved.userGrid && saved.solution &&
                        saved.userGrid.every((v, i) => v === saved.solution[i]);
                    if (isCompleted) {
                        Storage.clearProgress();
                        this.els.resumeBtn.classList.add('hidden');
                    } else {
                        const diff = DIFFICULTY[saved.difficulty];
                        this.els.resumeBtn.classList.remove('hidden');
                        this.els.resumeInfo.textContent =
                            `${diff ? diff.label : saved.difficulty} · ${formatTime(saved.elapsedBeforePause || 0)}`;
                    }
                } else {
                    this.els.resumeBtn.classList.add('hidden');
                }
            } else {
                this.els.resumeBtn.classList.add('hidden');
            }

            // Storage warning
            if (!Storage.isAvailable()) {
                this.els.storageWarning.classList.remove('hidden');
            } else {
                this.els.storageWarning.classList.add('hidden');
            }

            // Records
            this.renderRecords();
        },

        renderRecords() {
            const records = Storage.getRecords();
            const container = this.els.recordsContent;

            if (records.length === 0) {
                container.innerHTML = '<p class="records-empty">暂无记录</p>';
                return;
            }

            container.innerHTML = '';
            records.forEach(rec => {
                const item = document.createElement('div');
                item.className = 'record-item';
                const diff = DIFFICULTY[rec.difficulty] || { label: rec.difficulty, cls: '' };

                item.innerHTML = `
                    <div>
                        <div class="record-difficulty ${diff.cls}">${diff.label}</div>
                        <div class="record-detail">${rec.totalWins || 0} 胜 / ${rec.totalGames || 0} 局</div>
                    </div>
                    <div class="record-best">
                        <div class="record-time">${rec.bestTime ? formatTime(rec.bestTime) : '--:--'}</div>
                        <div class="record-games">连胜 ${rec.currentStreak || 0}</div>
                    </div>
                `;
                container.appendChild(item);
            });
        },

        // ===== Game Screen =====
        renderGameScreen() {
            this.showScreen('game-screen');
            const diff = DIFFICULTY[state.difficulty];
            this.els.diffLabel.textContent = diff ? diff.label : state.difficulty;

            this.updateMistakes();
            this.updatePencilMode();
            this.updateAutoCheck();
            this.updateTimerDisplay(Timer.getElapsed());
            this.renderBoard();
        },

        // ===== Win Screen =====
        renderWinScreen(record) {
            this.showScreen('win-screen');
            const diff = DIFFICULTY[state.difficulty];
            this.els.winDifficulty.textContent = diff ? diff.label : state.difficulty;
            this.els.winTime.textContent = formatTime(record.time);
            this.els.winMistakes.textContent = state.mistakes;
            this.els.winHints.textContent = state.hintsUsed;

            // Check if new record
            const records = Storage.getRecords();
            const existing = records.find(r => r.difficulty === state.difficulty);
            const isNewRecord = existing && record.time === existing.bestTime;
            this.els.newRecordBadge.classList.toggle('hidden', !isNewRecord);
        },

        // ===== Overlays =====
        showOverlay(id) {
            document.getElementById(id).classList.remove('hidden');
        },

        hideOverlay(id) {
            document.getElementById(id).classList.add('hidden');
        },

        showGenerating() {
            this.showOverlay('generating-overlay');
        },

        hideGenerating() {
            this.hideOverlay('generating-overlay');
        },

        showError(msg) {
            this.els.errorMessage.textContent = msg || '无法生成有效的谜题';
            this.showOverlay('error-overlay');
        },
    };

    // ============================================================
    //  Game Controller Module
    // ============================================================
    const Game = {
        _saveTimer: null,

        init() {
            UI.init();
            // Load settings
            const settings = Storage.loadSettings();
            state.autoCheck = settings.autoCheck || false;

            // Check for saved game
            UI.renderStartScreen();
        },

        startNewGame(difficulty) {
            state.status = 'generating';
            state.difficulty = difficulty;
            const config = DIFFICULTY[difficulty];
            state.maxMistakes = config.maxMistakes;

            UI.showGenerating();

            // Use setTimeout to allow spinner to render before blocking generation
            setTimeout(() => {
                try {
                    const result = Generator.generate(difficulty);
                    this._initNewGame(result.puzzle, result.solution, difficulty);
                    UI.hideGenerating();
                    UI.renderGameScreen();
                    Timer.start();
                    state.status = 'playing';
                } catch (err) {
                    UI.hideGenerating();
                    UI.showError(err.message || '生成谜题失败，请重试');
                    state.status = 'idle';
                }
            }, 50);
        },

        _initNewGame(puzzle, solution, difficulty) {
            state.puzzle = puzzle;
            state.solution = solution;
            state.userGrid = [...puzzle];
            state.pencilMarks = Array.from({ length: CELLS }, () => []);
            state.mistakes = 0;
            state.hintsUsed = 0;
            state.cellsRevealed = new Set();
            state.selectedCell = null;
            state.selectedNumber = this._findFirstUnfilledNumber();
            state.selectedMode = 'value';
            state.conflicts = new Set();
            state.history = [];
            state.difficulty = difficulty;
            state.maxMistakes = DIFFICULTY[difficulty].maxMistakes;
            Timer.reset();
        },

        resumeSavedGame() {
            const saved = Storage.loadProgress();
            if (!saved) {
                UI.renderStartScreen();
                return;
            }

            state.puzzle = saved.puzzle;
            state.userGrid = saved.userGrid;
            state.pencilMarks = saved.pencilMarks || Array.from({ length: CELLS }, () => []);
            state.solution = saved.solution;
            state.difficulty = saved.difficulty;
            state.mistakes = saved.mistakes || 0;
            state.hintsUsed = saved.hintsUsed || 0;
            state.cellsRevealed = saved.cellsRevealed || new Set();
            state.maxMistakes = saved.maxMistakes || DIFFICULTY[saved.difficulty].maxMistakes;
            state.selectedCell = null;
            state.selectedNumber = this._findFirstUnfilledNumber();
            state.selectedMode = 'value';
            state.conflicts = Validator.findConflicts(state.userGrid);
            state.history = [];

            Timer.reset();
            Timer.setElapsed(saved.elapsedBeforePause || 0);

            UI.renderGameScreen();
            Timer.start();
            state.status = 'playing';
        },

        quitToMenu() {
            if (state.status === 'playing') {
                this._saveState();
            }
            Timer.stop();
            state.status = 'idle';
            UI.renderStartScreen();
        },

        /**
         * Select a number on the numpad (or erase mode with 0).
         * This sets the active number to place on cell click.
         */
        selectNumber(n) {
            if (state.status !== 'playing' && state.status !== 'paused') return;
            state.selectedNumber = n;
            UI.updateNumpad();
            UI.updateBoard();
        },

        /**
         * Find the first number (1-9) that still has unfilled cells.
         */
        _findFirstUnfilledNumber() {
            for (let n = 1; n <= 9; n++) {
                let placed = 0;
                for (let i = 0; i < CELLS; i++) {
                    if (state.userGrid[i] === n && state.solution[i] === n) placed++;
                }
                if (placed < 9) return n;
            }
            return 1;
        },

        /**
         * Check if a number 1-9 has all 9 cells correctly placed.
         */
        _isNumberComplete(n) {
            let placed = 0;
            for (let i = 0; i < CELLS; i++) {
                if (state.userGrid[i] === n && state.solution[i] === n) placed++;
            }
            return placed === 9;
        },

        selectCell(index) {
            if (state.status !== 'playing') return;

            if (state.selectedCell === index) {
                state.selectedCell = null;
            } else {
                state.selectedCell = index;
            }
            UI.updateBoard();
        },

        placeNumber(n) {
            if (state.status !== 'playing') return;
            if (state.selectedCell === null) return;

            const idx = state.selectedCell;

            // Cannot modify pre-filled cells
            if (state.puzzle[idx] !== 0) return;

            if (state.selectedMode === 'pencil') {
                this._togglePencilMark(idx, n);
                UI._updateCell(idx);
                this._debounceSave();
                return;
            }

            // Save to history for undo
            this._pushHistory(idx);

            if (n === 0) {
                // Erase
                state.userGrid[idx] = 0;
                state.pencilMarks[idx] = [];
                state.conflicts = Validator.findConflicts(state.userGrid);
                UI.updateBoard();
                this._debounceSave();
                return;
            }

            // Check if correct
            if (n !== state.solution[idx]) {
                state.mistakes++;
                UI.updateMistakes();

                if (state.mistakes >= state.maxMistakes) {
                    // Allow continuing, but show max mistakes
                }
            }

            state.userGrid[idx] = n;
            state.pencilMarks[idx] = [];

            // Auto-switch: if current number is now fully placed, skip completed numbers and jump to next unfilled
            if (this._isNumberComplete(n) && state.selectedNumber === n) {
                let next = (n % 9) + 1;
                while (next !== n && this._isNumberComplete(next)) {
                    next = (next % 9) + 1;
                }
                state.selectedNumber = next;
            }

            // Auto-check: highlight wrong values
            state.conflicts = Validator.findConflicts(state.userGrid);
            if (state.autoCheck && n !== state.solution[idx]) {
                state.conflicts.add(idx);
            }

            // Add completed animation class
            const cellEl = UI.els.board.children[idx];
            if (cellEl && n === state.solution[idx]) {
                cellEl.classList.add('completed');
                setTimeout(() => cellEl.classList.remove('completed'), 300);
            }

            UI.updateBoard();
            this._debounceSave();
            this._checkWinCondition();
        },

        _togglePencilMark(idx, n) {
            if (n === 0) {
                // Clear all pencil marks for this cell
                state.pencilMarks[idx] = [];
                return;
            }
            if (state.userGrid[idx] !== 0) return;

            const marks = state.pencilMarks[idx];
            const pos = marks.indexOf(n);
            if (pos === -1) {
                marks.push(n);
                marks.sort((a, b) => a - b);
            } else {
                marks.splice(pos, 1);
            }
        },

        _pushHistory(idx) {
            state.history.push({
                index: idx,
                previousValue: state.userGrid[idx],
                previousPencilMarks: [...state.pencilMarks[idx]],
            });
            if (state.history.length > MAX_HISTORY) {
                state.history.shift();
            }
        },

        undo() {
            if (state.status !== 'playing') return;
            if (state.history.length === 0) return;

            const entry = state.history.pop();
            const idx = entry.index;

            // Cannot undo pre-filled cells
            if (state.puzzle[idx] !== 0) return;

            state.userGrid[idx] = entry.previousValue;
            state.pencilMarks[idx] = entry.previousPencilMarks;
            state.conflicts = Validator.findConflicts(state.userGrid);

            // Reselect the cell
            state.selectedCell = idx;

            UI.updateBoard();
            this._debounceSave();
        },

        useHint() {
            if (state.status !== 'playing') return;

            // Find all empty or wrong cells
            const candidates = [];
            for (let i = 0; i < CELLS; i++) {
                if (state.userGrid[i] !== state.solution[i] && state.puzzle[i] === 0) {
                    candidates.push(i);
                }
            }
            if (candidates.length === 0) return;

            // Prefer cells with fewest pencil marks
            candidates.sort((a, b) => {
                const aMarks = state.pencilMarks[a] ? state.pencilMarks[a].length : 0;
                const bMarks = state.pencilMarks[b] ? state.pencilMarks[b].length : 0;
                return aMarks - bMarks;
            });

            const idx = candidates[0];

            // Save to history
            this._pushHistory(idx);

            state.userGrid[idx] = state.solution[idx];
            state.cellsRevealed.add(idx);
            state.hintsUsed++;
            state.pencilMarks[idx] = [];
            state.conflicts = Validator.findConflicts(state.userGrid);
            state.selectedCell = idx;

            UI.updateBoard();
            this._debounceSave();
            this._checkWinCondition();
        },

        togglePencilMode() {
            if (state.status !== 'playing') return;
            state.selectedMode = state.selectedMode === 'value' ? 'pencil' : 'value';
            UI.updatePencilMode();
        },

        toggleAutoCheck() {
            state.autoCheck = !state.autoCheck;
            UI.updateAutoCheck();
            Storage.saveSettings({ autoCheck: state.autoCheck });
        },

        pauseGame() {
            if (state.status !== 'playing') return;
            state.status = 'paused';
            Timer.stop();
            UI.showOverlay('pause-overlay');
        },

        resumeGame() {
            if (state.status !== 'paused') return;
            state.status = 'playing';
            UI.hideOverlay('pause-overlay');
            Timer.start();
        },

        restartGame() {
            if (state.status === 'paused') {
                UI.hideOverlay('pause-overlay');
            }
            this.startNewGame(state.difficulty);
        },

        saveAndQuit() {
            if (state.status === 'playing' || state.status === 'paused') {
                this._saveState();
            }
            Timer.stop();
            state.status = 'idle';
            UI.renderStartScreen();
        },

        _checkWinCondition() {
            if (Validator.isSolved(state.userGrid, state.solution)) {
                state.status = 'won';
                Timer.stop();

                const elapsed = Timer.getElapsed();
                const record = {
                    difficulty: state.difficulty,
                    time: elapsed,
                    mistakes: state.mistakes,
                    hintsUsed: state.hintsUsed,
                };

                Storage.saveRecord(record);
                Storage.clearProgress();

                UI.renderWinScreen(record);
            }
        },

        _saveState() {
            Storage.saveProgress(state);
        },

        _debounceSave() {
            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
            }
            this._saveTimer = setTimeout(() => {
                this._saveState();
                this._saveTimer = null;
            }, SAVE_DEBOUNCE);
        },
    };

    // ============================================================
    //  Initialize on DOM ready
    // ============================================================
    function initApp() {
        if (document.getElementById('solve-board')) {
            Solver.init();
        } else {
            Game.init();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();

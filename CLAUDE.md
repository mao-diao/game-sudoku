# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

纯前端数独游戏网页应用（Sudoku），零外部依赖。包含主游戏页面和解題器页面。

## Quick Start

```bash
# 直接打开 HTML 文件即可，无需构建工具或服务器
# 主游戏
start index.html
# 解题器
start solve.html
```

## Project Structure

```
sudoku/
├── index.html        # 主游戏页面
├── solve.html        # 解题器页面（独立）
├── style.css         # 全部样式
└── script.js         # 全部游戏逻辑（IIFE 模块，~1800 行）
```

## Architecture (script.js)

所有逻辑在 `script.js` 的一个 IIFE 中，分为八大模块，通过 `Game` 模块协调：

| Module | Responsibility |
|--------|---------------|
| **Generator** | 随机生成有效数独谜题（唯一解）。对角线预填 → 回溯填充 → 剪枝挖空 |
| **Validator** | 冲突检测（行列宫）、终局判定。预计算 peer 关系加速 |
| **Storage** | `localStorage` 持久化（存档/设置/记录），跨标签页同步 |
| **Timer** | 计时器，支持暂停/恢复/累积计时 |
| **UI** | DOM 渲染、事件绑定、棋盘/键盘/状态更新、动画 |
| **Game** | 游戏状态机，协调各模块 |
| **Solver** | 回溯求解器，用于 `solve.html` 页面 |
| **PrintGenerator** | 生成可打印的含答案数独 |

### Game State Machine

```
idle → generating → playing ⇄ paused
                        ↓
                      won → idle
```

### 关键数据

- 棋盘：两个 `9×9` 数组（`board` = 初始+用户填入, `solution` = 完整解）
- 笔记：`9×9×9` 布尔数组（`notes[row][col][num]`）
- 难度：easy(36空), medium(46空), hard(54空)
- 撤销栈：最多 30 步

### 键盘快捷键

| Key | Action |
|-----|--------|
| `1-9` | 选择数字 |
| `Enter/Space` | 填入选中数字 |
| `Backspace/Delete/0` | 擦除 |
| `↑↓←→` | 方向键导航 |
| `P` | 切换笔记模式 |
| `H` | 使用提示 |
| `Ctrl+Z` | 撤销 |

## No Tests

项目当前无测试框架或测试文件。

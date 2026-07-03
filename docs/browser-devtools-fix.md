# 浏览器窗口 DevTools 显示不全修复

> 日期：2026-07-03
> 涉及项目：openhanako
> 修改文件：desktop/main.cjs、desktop/preload.cjs、desktop/src/react/browser-viewer/BrowserViewerApp.tsx

## 问题描述

在 openhanako 浏览器窗口中打开 DevTools 时，DevTools 被页面内容遮挡，只露出顶部两行（Elements 标签栏），下方全部被 WebContentsView 的渲染层覆盖。

## 根因分析

openhanako 的浏览器窗口使用 `WebContentsView`（Electron 30+ 替代 `BrowserView` 的新 API）来嵌入网页。`WebContentsView` 的渲染走 Chromium 合成器（compositor），其渲染层优先级高于 docked DevTools。导致无论用 `detach` 还是 `right`/`bottom` docked 模式，DevTools 的内容区域都会被 WebContentsView 的页面渲染覆盖。

关键发现：如果先打开 DevTools（被遮挡），再触发一次 toggle（关闭再打开），DevTools 的渲染层级会被刷新，第二次打开时不再被遮挡。这就是修复方案的核心思路。

## 尝试过的方案

### 方案 1：setTimeout 延迟设置窗口属性（❌ 无效）

将 `openDevTools({ mode: "detach" })` 后的 `setTimeout(200ms)` 改为 `once("devtools-opened", ...)` 事件回调，在 DevTools 完全打开后再 `setAlwaysOnTop` + `center`。

**结果**：无效。DevTools 窗口创建成功但仍然被遮挡。`setAlwaysOnTop` 对 WebContentsView 的合成层遮挡无效，因为这不是 OS 级 z-order 问题。

### 方案 2：docked right 模式（❌ 无效）

将 `mode: "detach"` 改为 `mode: "right"`，让 DevTools docked 在 WebContentsView 内部。

**结果**：无效。docked DevTools 同样被 WebContentsView 的渲染层覆盖。

### 方案 3：setDevToolsWebContents 独立窗口（⚠️ 部分有效）

用 `setDevToolsWebContents()` 把 DevTools 重定向到一个完全独立的 `BrowserWindow`，绕开合成层遮挡。

**结果**：DevTools 完整显示了，但引入两个新问题：
1. **inspect 元素的 hover 高亮不工作**：DevTools 的 inspect 功能需要在目标页面上捕获鼠标移动事件，但 DevTools 和 WebContentsView 在不同窗口里，鼠标事件不跨窗口传递
2. **关闭时连带退出应用**：DevTools 窗口关闭触发了 `window-all-closed` 事件

### 方案 4：docked right + 缩小 bounds（⚠️ 空间浪费）

回到 docked right 模式，但在 `devtools-opened` 事件中手动缩小 WebContentsView 的 bounds（减去 480px / 360px），给 DevTools 腾出右侧空间。

**结果**：DevTools 显示了，但多留了一大块空白。原因是 Chromium docked DevTools **自己已经会从 view 内部分配空间**，手动再缩 bounds 导致双倍预留。

### 方案 5：docked right + toggle 刷新渲染层级（✅ 最终方案）

不缩 bounds（让 Chromium 自己分配空间），但在 `devtools-opened` 事件中先 `closeDevTools`，延迟 100ms 后重新 `openDevTools`。toggle 操作刷新了 DevTools 的渲染层级，第二次打开时不再被遮挡。

**结果**：完美。DevTools 完整显示，inspect 的 hover 高亮正常工作，无多余空白。

## 最终方案详解

### 核心函数 `_toggleBrowserDevTools`

```javascript
function _toggleBrowserDevTools(targetWebContents) {
  if (!targetWebContents || targetWebContents.isDestroyed()) return;
  if (targetWebContents.isDevToolsOpened()) {
    targetWebContents.closeDevTools();
  } else {
    // docked right 模式：Chromium 自动从 view 内部分配 DevTools 空间
    // 但 WebContentsView 渲染层会遮挡 DevTools，打开后需要 toggle 刷新渲染层级
    targetWebContents.openDevTools({ mode: "right" });
    targetWebContents.once("devtools-opened", () => {
      // 关闭再打开，刷新渲染层级让 DevTools 不被遮挡
      targetWebContents.closeDevTools();
      setTimeout(() => {
        if (!targetWebContents.isDestroyed()) {
          targetWebContents.openDevTools({ mode: "right" });
        }
      }, 100);
    });
  }
}
```

### 触发方式：标题栏 DevTools 按钮

macOS 上 `Cmd+Option+I` 快捷键被 Electron 内置行为拦截，`before-input-event` 无法拦截（即使加了 `preventDefault()`）。因此在浏览器标题栏增加了一个 DevTools 按钮，通过 IPC 触发 `_toggleBrowserDevTools`。

### 修改文件清单

| 文件 | 改动 |
|------|------|
| `desktop/main.cjs` | 新增 `_toggleBrowserDevTools` 函数、IPC handler `browser-toggle-devtools` |
| `desktop/preload.cjs` | 新增 `browserToggleDevTools` IPC 桥接 |
| `desktop/src/react/browser-viewer/BrowserViewerApp.tsx` | 标题栏 Reload 按钮后新增 DevTools 按钮 |

### 构建步骤

```bash
npm run build:preload    # 构建 preload.bundle.cjs
npm run build:renderer   # 构建 dist-renderer/（包含 BrowserViewerApp 的 React 组件）
```

> 注意：`build:renderer` 需要 Node.js 20.19+ 或 22.12+。如果 `crypto.hash is not a function` 报错，升级 Node 版本。

## 遗留问题

**地址栏不能输入**：`browserViewerWindow.on("focus")` 会无条件把焦点转给 WebContentsView，导致点击标题栏的地址栏后焦点被抢走。暂不处理。

## 相关 Electron Issue

- [#42061: WebContentsView has no ability to set which view is "on top"](https://github.com/electron/electron/issues/42061)
- [#44867: WebContentView container priority is too high](https://github.com/electron/electron/issues/44867)
- [#32880: Devtools opened at bottom for browserView webcontents is not fully visible](https://github.com/electron/electron/issues/32880)

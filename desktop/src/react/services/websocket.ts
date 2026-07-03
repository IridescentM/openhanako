/**
 * websocket.ts — WebSocket 连接管理（从 app-ws-shim.ts 迁移）
 *
 * 模块级 singleton，管理 WS 连接生命周期、重连逻辑。
 * 不依赖 ctx 注入，不依赖 React 组件生命周期。
 */


import { handleServerMessage, applyStreamingStatus } from './ws-message-handler';
import { requestStreamResume, injectHandlers } from './stream-resume';
import { useStore } from '../stores';
import { setStatus } from '../utils/ui-helpers';
import {
  buildConnectionWsUrl,
  createLocalServerConnection,
  resolveServerConnection,
} from './server-connection';
// @ts-expect-error -- shared JS module, no type declarations
import { AppError } from '../../../../shared/errors.js';
// @ts-expect-error -- shared JS module, no type declarations
import { errorBus } from '../../../../shared/error-bus.js';

// ── 模块级 WS 实例 ──
let _ws: WebSocket | null = null;

// ── WS 重连状态 ──
let _wsRetryDelay = 1000;
const WS_RETRY_MAX = 30000;
let _wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _wsResumeVersion = 0;
let _wsRetryCount = 0;

// ── 心跳保活 ──
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL = 25000; // 每 25 秒发一次 ping

// 注入循环依赖的 handlers
injectHandlers(handleServerMessage, applyStreamingStatus);

/** 获取当前 WebSocket 实例 */
export function getWebSocket(): WebSocket | null {
  return _ws;
}

/** 发起 WebSocket 连接 */
export function connectWebSocket(port?: string, token?: string): void {
  // 如果没有传参，从 Zustand store 获取
  const storeState = useStore.getState();
  const connection = port !== undefined || token !== undefined
    ? createLocalServerConnection({
        serverPort: port || storeState.serverPort,
        serverToken: token ?? storeState.serverToken,
      })
    : resolveServerConnection(storeState);

  if (!connection) return;

  if (_wsRetryTimer) { clearTimeout(_wsRetryTimer); _wsRetryTimer = null; }
  if (_ws) {
    try { _ws.onclose = null; _ws.close(); } catch { /* silent */ }
  }

  const url = buildConnectionWsUrl(connection, '/ws');
  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _wsRetryDelay = 1000;
    _wsRetryCount = 0;
    setStatus('status.connected', true);
    useStore.setState({ wsState: 'connected', wsReconnectAttempt: 0, compactingSessions: [] });

    // 启动心跳
    startHeartbeat();

    const s = useStore.getState();
    if (s.currentSessionPath && s.streamingSessions.includes(s.currentSessionPath)) {
      const myVersion = ++_wsResumeVersion;
      const targetPath = s.currentSessionPath;
      Promise.resolve().then(async () => {
        if (myVersion !== _wsResumeVersion) return;
        if (useStore.getState().currentSessionPath !== targetPath) return;
        requestStreamResume(targetPath);
      }).catch((err) => {
        console.error('[ws] reconnect resume failed:', err);
      });
    }

    // 重连后无条件刷新 ContextRing：覆盖 models-changed IPC 在 WS 关闭窗口
    // 期内到达、服务端重启、长时间挂起后唤醒等所有可能造成 context 数据
    // 与后端实际状态偏离的场景。不依赖 _pendingContextRefresh 队列。
    if (s.currentSessionPath && _ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'context_usage', sessionPath: s.currentSessionPath }));
    }
  };

  _ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('[ws] message parse error:', err);
    }
  };

  _ws.onclose = () => {
    stopHeartbeat();
    setStatus('status.disconnected', false);
    _wsRetryCount++;

    // 无限重连，指数退避最高 30 秒
    useStore.setState({ wsState: 'reconnecting', wsReconnectAttempt: _wsRetryCount });
    _wsRetryTimer = setTimeout(() => connectWebSocket(), _wsRetryDelay);
    _wsRetryDelay = Math.min(_wsRetryDelay * 2, WS_RETRY_MAX);
  };

  _ws.onerror = () => {
    errorBus.report(new AppError('WS_DISCONNECTED'));
  };
}

/** 手动重连（由 StatusBar 重连按钮调用），重置重试计数 */
export function manualReconnect(): void {
  _wsRetryCount = 0;
  connectWebSocket();
}

// ── 心跳保活 ──
function startHeartbeat(): void {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      try { _ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

/** 主动重连（由 powerMonitor 唤醒时调用），立即重连并重置退避 */
export function forceReconnect(): void {
  stopHeartbeat();
  if (_wsRetryTimer) { clearTimeout(_wsRetryTimer); _wsRetryTimer = null; }
  _wsRetryDelay = 1000;
  _wsRetryCount = 0;
  if (_ws) {
    try { _ws.onclose = null; _ws.close(); } catch { /* silent */ }
    _ws = null;
  }
  connectWebSocket();
}
